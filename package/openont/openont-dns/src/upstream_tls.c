/* SPDX-License-Identifier: GPL-2.0-only */
#include "upstream.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/random.h>

#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include <mbedtls/error.h>
#include <mbedtls/net_sockets.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>

int upstream_tls_exchange(const struct upstream_srv *u, const uint8_t *q, int qlen,
			  uint8_t *resp, int respmax, int timeout_ms, int *rtt_ms);

static int rng(void *ctx, unsigned char *out, size_t len)
{
	ssize_t n = getrandom(out, len, 0);
	(void)ctx;
	if (n < 0 || (size_t)n != len)
		return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
	return 0;
}

static int tls_setup(mbedtls_ssl_context *ssl, mbedtls_ssl_config *conf,
		     mbedtls_x509_crt *cacert, mbedtls_net_context *net,
		     const char *sni, int timeout_ms)
{
	int rc;

	mbedtls_ssl_init(ssl);
	mbedtls_ssl_config_init(conf);
	mbedtls_x509_crt_init(cacert);
	mbedtls_net_init(net);
	rc = mbedtls_ssl_config_defaults(conf, MBEDTLS_SSL_IS_CLIENT,
					 MBEDTLS_SSL_TRANSPORT_STREAM,
					 MBEDTLS_SSL_PRESET_DEFAULT);
	if (rc != 0)
		return rc;
	mbedtls_ssl_conf_authmode(conf, MBEDTLS_SSL_VERIFY_REQUIRED);
	mbedtls_ssl_conf_rng(conf, rng, NULL);
	mbedtls_ssl_conf_read_timeout(conf, (uint32_t)timeout_ms);
	if (mbedtls_x509_crt_parse_path(cacert, "/etc/ssl/certs") < 0 &&
	    mbedtls_x509_crt_parse_file(cacert, "/etc/ssl/certs/ca-certificates.crt") < 0)
		return -1;
	mbedtls_ssl_conf_ca_chain(conf, cacert, NULL);
	rc = mbedtls_ssl_setup(ssl, conf);
	if (rc != 0)
		return rc;
	if (sni && sni[0])
		mbedtls_ssl_set_hostname(ssl, sni);
	return 0;
}

static void tls_free(mbedtls_ssl_context *ssl, mbedtls_ssl_config *conf,
		     mbedtls_x509_crt *cacert, mbedtls_net_context *net)
{
	mbedtls_ssl_free(ssl);
	mbedtls_ssl_config_free(conf);
	mbedtls_x509_crt_free(cacert);
	mbedtls_net_free(net);
}

static int ssl_write_all(mbedtls_ssl_context *ssl, const uint8_t *buf, int len)
{
	int off = 0;
	while (off < len) {
		int n = mbedtls_ssl_write(ssl, buf + off, (size_t)(len - off));
		if (n == MBEDTLS_ERR_SSL_WANT_READ || n == MBEDTLS_ERR_SSL_WANT_WRITE)
			continue;
		if (n <= 0)
			return -1;
		off += n;
	}
	return 0;
}

static int ssl_read_full(mbedtls_ssl_context *ssl, uint8_t *buf, int len)
{
	int off = 0;
	while (off < len) {
		int n = mbedtls_ssl_read(ssl, buf + off, (size_t)(len - off));
		if (n == MBEDTLS_ERR_SSL_WANT_READ || n == MBEDTLS_ERR_SSL_WANT_WRITE)
			continue;
		if (n <= 0)
			return -1;
		off += n;
	}
	return 0;
}

static int connect_tls(const struct upstream_srv *u, int timeout_ms,
		       mbedtls_ssl_context *ssl, mbedtls_ssl_config *conf,
		       mbedtls_x509_crt *cacert, mbedtls_net_context *net)
{
	char port[16];
	const char *sni;
	int rc;

	sni = u->tls_host[0] ? u->tls_host : u->host;
	snprintf(port, sizeof(port), "%d", u->port > 0 ? u->port : 853);
	rc = tls_setup(ssl, conf, cacert, net, sni, timeout_ms);
	if (rc != 0)
		return rc;
	rc = mbedtls_net_connect(net, u->host, port, MBEDTLS_NET_PROTO_TCP);
	if (rc != 0)
		return rc;
	mbedtls_ssl_set_bio(ssl, net, mbedtls_net_send, mbedtls_net_recv, mbedtls_net_recv_timeout);
	while ((rc = mbedtls_ssl_handshake(ssl)) != 0) {
		if (rc == MBEDTLS_ERR_SSL_WANT_READ || rc == MBEDTLS_ERR_SSL_WANT_WRITE)
			continue;
		return rc;
	}
	if (mbedtls_ssl_get_verify_result(ssl) != 0)
		return -1;
	return 0;
}

static int exchange_dot(const struct upstream_srv *u, const uint8_t *q, int qlen,
			uint8_t *resp, int respmax, int timeout_ms)
{
	mbedtls_ssl_context ssl;
	mbedtls_ssl_config conf;
	mbedtls_x509_crt cacert;
	mbedtls_net_context net;
	uint8_t lenb[2];
	int body;
	int rc;

	rc = connect_tls(u, timeout_ms, &ssl, &conf, &cacert, &net);
	if (rc != 0) {
		tls_free(&ssl, &conf, &cacert, &net);
		return -1;
	}
	lenb[0] = (uint8_t)(qlen >> 8);
	lenb[1] = (uint8_t)qlen;
	if (ssl_write_all(&ssl, lenb, 2) != 0 || ssl_write_all(&ssl, q, qlen) != 0 ||
	    ssl_read_full(&ssl, lenb, 2) != 0) {
		tls_free(&ssl, &conf, &cacert, &net);
		return -1;
	}
	body = (lenb[0] << 8) | lenb[1];
	if (body < 12 || body > respmax) {
		tls_free(&ssl, &conf, &cacert, &net);
		return -1;
	}
	rc = ssl_read_full(&ssl, resp, body);
	tls_free(&ssl, &conf, &cacert, &net);
	return rc == 0 ? body : -1;
}

static int exchange_doh(const struct upstream_srv *u, const uint8_t *q, int qlen,
			uint8_t *resp, int respmax, int timeout_ms)
{
	mbedtls_ssl_context ssl;
	mbedtls_ssl_config conf;
	mbedtls_x509_crt cacert;
	mbedtls_net_context net;
	char header[1024];
	const char *host;
	const char *path;
	char raw[8192];
	int rawlen = 0;
	int rc;
	char *sep;
	int content_len = -1;
	int header_len;

	host = u->tls_host[0] ? u->tls_host : u->host;
	path = u->path[0] ? u->path : "/dns-query";
	rc = connect_tls(u, timeout_ms, &ssl, &conf, &cacert, &net);
	if (rc != 0) {
		tls_free(&ssl, &conf, &cacert, &net);
		return -1;
	}
	snprintf(header, sizeof(header),
		 "POST %s HTTP/1.1\r\n"
		 "Host: %s\r\n"
		 "Content-Type: application/dns-message\r\n"
		 "Accept: application/dns-message\r\n"
		 "Content-Length: %d\r\n"
		 "Connection: close\r\n\r\n",
		 path, host, qlen);
	if (ssl_write_all(&ssl, (const uint8_t *)header, (int)strlen(header)) != 0 ||
	    ssl_write_all(&ssl, q, qlen) != 0) {
		tls_free(&ssl, &conf, &cacert, &net);
		return -1;
	}
	while (rawlen < (int)sizeof(raw) - 1) {
		int n = mbedtls_ssl_read(&ssl, (unsigned char *)raw + rawlen, (size_t)(sizeof(raw) - 1 - rawlen));
		if (n == MBEDTLS_ERR_SSL_WANT_READ || n == MBEDTLS_ERR_SSL_WANT_WRITE)
			continue;
		if (n == MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY || n == 0)
			break;
		if (n < 0)
			break;
		rawlen += n;
		raw[rawlen] = '\0';
		if (strstr(raw, "\r\n\r\n"))
			break;
	}
	raw[rawlen] = '\0';
	sep = strstr(raw, "\r\n\r\n");
	if (!sep || strncmp(raw, "HTTP/1.1 200", 12) != 0) {
		tls_free(&ssl, &conf, &cacert, &net);
		return -1;
	}
	header_len = (int)(sep + 4 - raw);
	{
		char *p = raw;
		while (p < sep) {
			if (!strncasecmp(p, "Content-Length:", 15)) {
				content_len = atoi(p + 15);
				break;
			}
			p = strchr(p, '\n');
			if (!p)
				break;
			p++;
		}
	}
	if (content_len < 12 || content_len > respmax) {
		tls_free(&ssl, &conf, &cacert, &net);
		return -1;
	}
	if (rawlen - header_len < content_len) {
		int have = rawlen - header_len;
		memcpy(resp, raw + header_len, (size_t)have);
		if (ssl_read_full(&ssl, resp + have, content_len - have) != 0) {
			tls_free(&ssl, &conf, &cacert, &net);
			return -1;
		}
	} else {
		memcpy(resp, raw + header_len, (size_t)content_len);
	}
	tls_free(&ssl, &conf, &cacert, &net);
	return content_len;
}

int upstream_tls_exchange(const struct upstream_srv *u, const uint8_t *q, int qlen,
			  uint8_t *resp, int respmax, int timeout_ms, int *rtt_ms)
{
	(void)rtt_ms;
	if (!strcmp(u->proto, "doh"))
		return exchange_doh(u, q, qlen, resp, respmax, timeout_ms);
	return exchange_dot(u, q, qlen, resp, respmax, timeout_ms);
}
