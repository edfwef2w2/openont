/* SPDX-License-Identifier: GPL-2.0-only */
#define _GNU_SOURCE
#include "dns_proto.h"
#include "sni.h"

#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <stdint.h>
#include <time.h>
#include <unistd.h>

#include <mbedtls/asn1.h>
#include <mbedtls/bignum.h>
#include <mbedtls/ecp.h>
#include <mbedtls/oid.h>
#include <mbedtls/pk.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>

#define MAX_ACCEL 256
#define CA_SUBJECT "CN=OpenONT Local CA,O=OpenONT"

struct front_cfg {
	char ca_key[256];
	char ca_crt[256];
	char cert_dir[256];
	char backend_host[64];
	int backend_port;
	char sni_mode[16];
	char sni_name[256];
	char trust_file[256];
	int listen_port;
	char accel[MAX_ACCEL][256];
	int naccel;
};

static struct front_cfg g_cfg;
static int g_inflight;
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;

static int rng(void *ctx, unsigned char *out, size_t len)
{
	ssize_t n = getrandom(out, len, 0);
	(void)ctx;
	if (n < 0 || (size_t)n != len)
		return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
	return 0;
}

static int bio_send(void *ctx, const unsigned char *buf, size_t len)
{
	int fd = *(int *)ctx;
	ssize_t n = send(fd, buf, len, MSG_NOSIGNAL);
	if (n < 0 && (errno == EAGAIN || errno == EINTR))
		return MBEDTLS_ERR_SSL_WANT_WRITE;
	if (n <= 0)
		return MBEDTLS_ERR_NET_SEND_FAILED;
	return (int)n;
}

static int bio_recv(void *ctx, unsigned char *buf, size_t len)
{
	int fd = *(int *)ctx;
	ssize_t n = recv(fd, buf, len, 0);
	if (n < 0 && (errno == EAGAIN || errno == EINTR))
		return MBEDTLS_ERR_SSL_WANT_READ;
	if (n < 0)
		return MBEDTLS_ERR_NET_RECV_FAILED;
	if (n == 0)
		return MBEDTLS_ERR_NET_CONN_RESET;
	return (int)n;
}

static int ignore_cn(void *ctx, mbedtls_x509_crt *crt, int depth, uint32_t *flags)
{
	(void)ctx;
	(void)crt;
	(void)depth;
	if (flags)
		*flags &= ~(uint32_t)MBEDTLS_X509_BADCERT_CN_MISMATCH;
	return 0;
}

static int write_file(const char *path, const char *data, int secret)
{
	int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, secret ? 0600 : 0644);
	size_t len;
	ssize_t n;
	if (fd < 0)
		return -1;
	len = strlen(data);
	n = write(fd, data, len);
	close(fd);
	return n == (ssize_t)len ? 0 : -1;
}

static int gen_key(mbedtls_pk_context *key)
{
	int rc;
	mbedtls_pk_init(key);
	rc = mbedtls_pk_setup(key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY));
	if (rc != 0)
		return rc;
	return mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(*key), rng, NULL);
}

static void stamp_time(char *out, size_t outlen, time_t t)
{
	struct tm tm;
	gmtime_r(&t, &tm);
	strftime(out, outlen, "%Y%m%d%H%M%S", &tm);
}

static int write_cert(mbedtls_x509write_cert *crt, const char *path)
{
	unsigned char buf[8192];
	int rc = mbedtls_x509write_crt_pem(crt, buf, sizeof(buf), rng, NULL);
	if (rc != 0)
		return rc;
	return write_file(path, (char *)buf, 0);
}

static int write_key(mbedtls_pk_context *key, const char *path)
{
	unsigned char buf[4096];
	int rc = mbedtls_pk_write_key_pem(key, buf, sizeof(buf));
	if (rc != 0)
		return rc;
	return write_file(path, (char *)buf, 1);
}

static int generate_ca(const char *key_path, const char *crt_path)
{
	mbedtls_pk_context key;
	mbedtls_x509write_cert crt;
	mbedtls_mpi serial;
	char from[20];
	char to[20];
	unsigned char serial_raw[8];
	char serial_hex[20];
	int i;
	int rc;
	time_t now = time(NULL);

	if (gen_key(&key) != 0)
		return -1;
	if (write_key(&key, key_path) != 0) {
		mbedtls_pk_free(&key);
		return -1;
	}
	mbedtls_x509write_crt_init(&crt);
	mbedtls_x509write_crt_set_md_alg(&crt, MBEDTLS_MD_SHA256);
	mbedtls_x509write_crt_set_issuer_key(&crt, &key);
	mbedtls_x509write_crt_set_subject_key(&crt, &key);
	mbedtls_x509write_crt_set_subject_name(&crt, CA_SUBJECT);
	mbedtls_x509write_crt_set_issuer_name(&crt, CA_SUBJECT);
	stamp_time(from, sizeof(from), now > 0 ? now - 86400 : 1700000000);
	stamp_time(to, sizeof(to), (now > 0 ? now : 1700000000) + 86400L * 3650);
	mbedtls_x509write_crt_set_validity(&crt, from, to);
	mbedtls_x509write_crt_set_basic_constraints(&crt, 1, -1);
	mbedtls_x509write_crt_set_subject_key_identifier(&crt);
	mbedtls_x509write_crt_set_authority_key_identifier(&crt);
	mbedtls_x509write_crt_set_key_usage(&crt, MBEDTLS_X509_KU_KEY_CERT_SIGN | MBEDTLS_X509_KU_CRL_SIGN);
	rng(NULL, serial_raw, sizeof(serial_raw));
	for (i = 0; i < 8; i++)
		sprintf(serial_hex + i * 2, "%02x", serial_raw[i]);
	mbedtls_mpi_init(&serial);
	mbedtls_mpi_read_string(&serial, 16, serial_hex);
	mbedtls_x509write_crt_set_serial(&crt, &serial);
	rc = write_cert(&crt, crt_path);
	mbedtls_mpi_free(&serial);
	mbedtls_x509write_crt_free(&crt);
	mbedtls_pk_free(&key);
	return rc;
}

static void leaf_paths(const struct front_cfg *cfg, const char *host, char *crt, size_t crtlen, char *key, size_t keylen)
{
	char safe[256];
	size_t i;
	snprintf(safe, sizeof(safe), "%s", host);
	for (i = 0; safe[i]; i++) {
		unsigned char c = (unsigned char)safe[i];
		if (!isalnum(c) && c != '.' && c != '-')
			safe[i] = '_';
	}
	snprintf(crt, crtlen, "%s/%s.crt", cfg->cert_dir, safe);
	snprintf(key, keylen, "%s/%s.key", cfg->cert_dir, safe);
}

static int generate_leaf(const struct front_cfg *cfg, const char *host, const char *crt_path, const char *key_path)
{
	mbedtls_pk_context ca_key;
	mbedtls_pk_context leaf;
	mbedtls_x509write_cert crt;
	mbedtls_x509_san_list san;
	mbedtls_asn1_sequence eku;
	mbedtls_mpi serial;
	char subject[300];
	char from[20];
	char to[20];
	unsigned char serial_raw[8];
	char serial_hex[20];
	int i;
	int rc;
	time_t now = time(NULL);

	mbedtls_pk_init(&ca_key);
	if (mbedtls_pk_parse_keyfile(&ca_key, cfg->ca_key, NULL, rng, NULL) != 0) {
		mbedtls_pk_free(&ca_key);
		return -1;
	}
	if (gen_key(&leaf) != 0) {
		mbedtls_pk_free(&ca_key);
		return -1;
	}
	if (write_key(&leaf, key_path) != 0) {
		mbedtls_pk_free(&leaf);
		mbedtls_pk_free(&ca_key);
		return -1;
	}
	if (strlen(host) > 60)
		snprintf(subject, sizeof(subject), "CN=OpenONT");
	else
		snprintf(subject, sizeof(subject), "CN=%s", host);
	mbedtls_x509write_crt_init(&crt);
	mbedtls_x509write_crt_set_md_alg(&crt, MBEDTLS_MD_SHA256);
	mbedtls_x509write_crt_set_issuer_key(&crt, &ca_key);
	mbedtls_x509write_crt_set_subject_key(&crt, &leaf);
	mbedtls_x509write_crt_set_subject_name(&crt, subject);
	mbedtls_x509write_crt_set_issuer_name(&crt, CA_SUBJECT);
	stamp_time(from, sizeof(from), now > 0 ? now - 3600 : 1700000000);
	stamp_time(to, sizeof(to), (now > 0 ? now : 1700000000) + 86400L * 825);
	mbedtls_x509write_crt_set_validity(&crt, from, to);
	mbedtls_x509write_crt_set_basic_constraints(&crt, 0, -1);
	mbedtls_x509write_crt_set_key_usage(&crt, MBEDTLS_X509_KU_DIGITAL_SIGNATURE | MBEDTLS_X509_KU_KEY_AGREEMENT);
	memset(&eku, 0, sizeof(eku));
	eku.buf.tag = MBEDTLS_ASN1_OID;
	eku.buf.len = MBEDTLS_OID_SIZE(MBEDTLS_OID_SERVER_AUTH);
	eku.buf.p = (unsigned char *)MBEDTLS_OID_SERVER_AUTH;
	mbedtls_x509write_crt_set_ext_key_usage(&crt, &eku);
	memset(&san, 0, sizeof(san));
	san.node.type = MBEDTLS_X509_SAN_DNS_NAME;
	san.node.san.unstructured_name.p = (unsigned char *)host;
	san.node.san.unstructured_name.len = strlen(host);
	mbedtls_x509write_crt_set_subject_alternative_name(&crt, &san);
	mbedtls_x509write_crt_set_subject_key_identifier(&crt);
	mbedtls_x509write_crt_set_authority_key_identifier(&crt);
	rng(NULL, serial_raw, sizeof(serial_raw));
	for (i = 0; i < 8; i++)
		sprintf(serial_hex + i * 2, "%02x", serial_raw[i]);
	mbedtls_mpi_init(&serial);
	mbedtls_mpi_read_string(&serial, 16, serial_hex);
	mbedtls_x509write_crt_set_serial(&crt, &serial);
	rc = write_cert(&crt, crt_path);
	mbedtls_mpi_free(&serial);
	mbedtls_x509write_crt_free(&crt);
	mbedtls_pk_free(&leaf);
	mbedtls_pk_free(&ca_key);
	return rc;
}

static int ensure_leaf(const struct front_cfg *cfg, const char *host, char *crt_path, size_t crtlen, char *key_path, size_t keylen)
{
	leaf_paths(cfg, host, crt_path, crtlen, key_path, keylen);
	if (access(crt_path, R_OK) == 0 && access(key_path, R_OK) == 0)
		return 0;
	return generate_leaf(cfg, host, crt_path, key_path);
}

static int tcp_connect_ip(const char *ip, int port)
{
	uint8_t addr[16];
	int fd;
	int fam;
	if (dns_parse_ipv4(ip, addr) == 0) {
		struct sockaddr_in sa;
		memset(&sa, 0, sizeof(sa));
		sa.sin_family = AF_INET;
		sa.sin_port = htons((uint16_t)port);
		memcpy(&sa.sin_addr, addr, 4);
		fd = socket(AF_INET, SOCK_STREAM, 0);
		fam = AF_INET;
		if (fd < 0)
			return -1;
		if (connect(fd, (struct sockaddr *)&sa, sizeof(sa)) != 0) {
			close(fd);
			return -1;
		}
		(void)fam;
		return fd;
	}
	if (dns_parse_ipv6(ip, addr) == 0) {
		struct sockaddr_in6 sa;
		memset(&sa, 0, sizeof(sa));
		sa.sin6_family = AF_INET6;
		sa.sin6_port = htons((uint16_t)port);
		memcpy(&sa.sin6_addr, addr, 16);
		fd = socket(AF_INET6, SOCK_STREAM, 0);
		if (fd < 0)
			return -1;
		if (connect(fd, (struct sockaddr *)&sa, sizeof(sa)) != 0) {
			close(fd);
			return -1;
		}
		return fd;
	}
	return -1;
}

static int is_self_loop(const char *ip)
{
	return !strcmp(ip, "127.0.0.1") || !strcmp(ip, "0.0.0.0");
}

static int resolve_a(const char *name, char out[][64], int max)
{
	uint8_t q[512];
	uint8_t resp[1024];
	struct dns_rr rr[8];
	int fd;
	int qlen;
	int n;
	int i;
	int found = 0;
	struct sockaddr_in sa;
	struct timeval tv;

	qlen = dns_build_query(q, sizeof(q), 7, name, DNS_T_A);
	if (qlen < 0)
		return 0;
	fd = socket(AF_INET, SOCK_DGRAM, 0);
	if (fd < 0)
		return 0;
	tv.tv_sec = 2;
	tv.tv_usec = 0;
	setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
	memset(&sa, 0, sizeof(sa));
	sa.sin_family = AF_INET;
	sa.sin_port = htons(53);
	sa.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	if (sendto(fd, q, (size_t)qlen, 0, (struct sockaddr *)&sa, sizeof(sa)) != qlen) {
		close(fd);
		return 0;
	}
	n = (int)recv(fd, resp, sizeof(resp), 0);
	close(fd);
	if (n < 12)
		return 0;
	n = dns_parse_answers(resp, n, rr, 8);
	for (i = 0; i < n && found < max; i++) {
		if (rr[i].type == DNS_T_A && rr[i].text[0] && !is_self_loop(rr[i].text))
			snprintf(out[found++], 64, "%s", rr[i].text);
	}
	return found;
}

static int send_all(int fd, const char *buf, int len)
{
	int off = 0;
	while (off < len) {
		int n = (int)send(fd, buf + off, (size_t)(len - off), MSG_NOSIGNAL);
		if (n <= 0)
			return -1;
		off += n;
	}
	return 0;
}

static void splice_fds(int a, int b)
{
	for (;;) {
		struct pollfd p[2];
		char buf[8192];
		int i;
		p[0].fd = a;
		p[0].events = POLLIN;
		p[1].fd = b;
		p[1].events = POLLIN;
		if (poll(p, 2, 120000) <= 0)
			break;
		for (i = 0; i < 2; i++) {
			int src = i == 0 ? a : b;
			int dst = i == 0 ? b : a;
			int n;
			if (!(p[i].revents & POLLIN))
				continue;
			n = (int)recv(src, buf, sizeof(buf), 0);
			if (n <= 0)
				return;
			if (send_all(dst, buf, n) != 0)
				return;
		}
	}
}

static int accel_match(const struct front_cfg *cfg, const char *sni)
{
	int i;
	if (!sni || !sni[0])
		return 0;
	for (i = 0; i < cfg->naccel; i++) {
		if (sni_name_matches(sni, cfg->accel[i]))
			return 1;
	}
	return 0;
}

struct relay_arg {
	mbedtls_ssl_context *from;
	mbedtls_ssl_context *to;
	volatile int *dead;
};

static void *relay_fn(void *arg)
{
	struct relay_arg *r = arg;
	unsigned char buf[8192];
	while (!*r->dead) {
		int n = mbedtls_ssl_read(r->from, buf, sizeof(buf));
		int off = 0;
		if (n == MBEDTLS_ERR_SSL_WANT_READ || n == MBEDTLS_ERR_SSL_WANT_WRITE)
			continue;
		if (n <= 0) {
			*r->dead = 1;
			break;
		}
		while (off < n) {
			int w = mbedtls_ssl_write(r->to, buf + off, (size_t)(n - off));
			if (w == MBEDTLS_ERR_SSL_WANT_READ || w == MBEDTLS_ERR_SSL_WANT_WRITE)
				continue;
			if (w <= 0) {
				*r->dead = 1;
				return NULL;
			}
			off += w;
		}
	}
	return NULL;
}

static int mitm(int cfd, const struct front_cfg *cfg, const struct client_hello_info *hello)
{
	char ips[4][64];
	int nips;
	int ufd = -1;
	int i;
	char crt_path[512];
	char key_path[512];
	mbedtls_ssl_context ussl;
	mbedtls_ssl_config uconf;
	mbedtls_x509_crt trust;
	mbedtls_ssl_context cssl;
	mbedtls_ssl_config cconf;
	mbedtls_x509_crt leaf;
	mbedtls_pk_context leaf_key;
	const char *alpn_list[9];
	const char *chosen = NULL;
	const char *only[2];
	int rc;
	volatile int dead = 0;
	pthread_t t1;
	pthread_t t2;
	struct relay_arg a1;
	struct relay_arg a2;
	int strict = strcmp(cfg->sni_mode, "keep") == 0;
	const char *sni_out = hello->sni;

	nips = resolve_a(hello->sni, ips, 4);
	if (nips <= 0)
		return -1;
	for (i = 0; i < nips; i++) {
		ufd = tcp_connect_ip(ips[i], 443);
		if (ufd >= 0)
			break;
	}
	if (ufd < 0)
		return -1;

	mbedtls_ssl_init(&ussl);
	mbedtls_ssl_config_init(&uconf);
	mbedtls_x509_crt_init(&trust);
	mbedtls_ssl_config_defaults(&uconf, MBEDTLS_SSL_IS_CLIENT, MBEDTLS_SSL_TRANSPORT_STREAM,
				    MBEDTLS_SSL_PRESET_DEFAULT);
	mbedtls_ssl_conf_authmode(&uconf, MBEDTLS_SSL_VERIFY_REQUIRED);
	mbedtls_ssl_conf_rng(&uconf, rng, NULL);
	if (mbedtls_x509_crt_parse_file(&trust, cfg->trust_file) < 0)
		mbedtls_x509_crt_parse_path(&trust, "/etc/ssl/certs");
	mbedtls_ssl_conf_ca_chain(&uconf, &trust, NULL);
	if (!strict)
		mbedtls_ssl_conf_verify(&uconf, ignore_cn, NULL);
	if (hello->nalpn > 0) {
		int n = hello->nalpn > 8 ? 8 : hello->nalpn;
		for (i = 0; i < n; i++)
			alpn_list[i] = hello->alpn[i];
		alpn_list[n] = NULL;
		mbedtls_ssl_conf_alpn_protocols(&uconf, alpn_list);
	}
	mbedtls_ssl_setup(&ussl, &uconf);
	if (!strcmp(cfg->sni_mode, "replace") && cfg->sni_name[0])
		sni_out = cfg->sni_name;
	if (strcmp(cfg->sni_mode, "omit") != 0)
		mbedtls_ssl_set_hostname(&ussl, sni_out);
	mbedtls_ssl_set_bio(&ussl, &ufd, bio_send, bio_recv, NULL);
	while ((rc = mbedtls_ssl_handshake(&ussl)) != 0) {
		if (rc == MBEDTLS_ERR_SSL_WANT_READ || rc == MBEDTLS_ERR_SSL_WANT_WRITE)
			continue;
		goto fail_up;
	}
	if (mbedtls_ssl_get_verify_result(&ussl) != 0)
		goto fail_up;
	chosen = mbedtls_ssl_get_alpn_protocol(&ussl);

	if (ensure_leaf(cfg, hello->sni, crt_path, sizeof(crt_path), key_path, sizeof(key_path)) != 0)
		goto fail_up;
	mbedtls_ssl_init(&cssl);
	mbedtls_ssl_config_init(&cconf);
	mbedtls_x509_crt_init(&leaf);
	mbedtls_pk_init(&leaf_key);
	if (mbedtls_x509_crt_parse_file(&leaf, crt_path) != 0 ||
	    mbedtls_pk_parse_keyfile(&leaf_key, key_path, NULL, rng, NULL) != 0)
		goto fail_both;
	mbedtls_ssl_config_defaults(&cconf, MBEDTLS_SSL_IS_SERVER, MBEDTLS_SSL_TRANSPORT_STREAM,
				    MBEDTLS_SSL_PRESET_DEFAULT);
	mbedtls_ssl_conf_rng(&cconf, rng, NULL);
	mbedtls_ssl_conf_own_cert(&cconf, &leaf, &leaf_key);
	if (chosen) {
		only[0] = chosen;
		only[1] = NULL;
		mbedtls_ssl_conf_alpn_protocols(&cconf, only);
	}
	mbedtls_ssl_setup(&cssl, &cconf);
	mbedtls_ssl_set_bio(&cssl, &cfd, bio_send, bio_recv, NULL);
	while ((rc = mbedtls_ssl_handshake(&cssl)) != 0) {
		if (rc == MBEDTLS_ERR_SSL_WANT_READ || rc == MBEDTLS_ERR_SSL_WANT_WRITE)
			continue;
		goto fail_both;
	}

	a1.from = &cssl;
	a1.to = &ussl;
	a1.dead = &dead;
	a2.from = &ussl;
	a2.to = &cssl;
	a2.dead = &dead;
	if (pthread_create(&t1, NULL, relay_fn, &a1) == 0 &&
	    pthread_create(&t2, NULL, relay_fn, &a2) == 0) {
		pthread_join(t1, NULL);
		pthread_join(t2, NULL);
	} else {
		dead = 1;
	}

fail_both:
	mbedtls_ssl_free(&cssl);
	mbedtls_ssl_config_free(&cconf);
	mbedtls_x509_crt_free(&leaf);
	mbedtls_pk_free(&leaf_key);
fail_up:
	mbedtls_ssl_free(&ussl);
	mbedtls_ssl_config_free(&uconf);
	mbedtls_x509_crt_free(&trust);
	close(ufd);
	return 0;
}

static void *conn_thread(void *arg)
{
	int fd = (int)(intptr_t)arg;
	struct timeval tv;
	uint8_t buf[16384];
	struct client_hello_info hello;
	int st = 0;
	long long deadline;
	struct timespec ts;
	int backend;

	tv.tv_sec = 3;
	tv.tv_usec = 0;
	setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
	clock_gettime(CLOCK_MONOTONIC, &ts);
	deadline = (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000 + 3000;
	memset(&hello, 0, sizeof(hello));
	for (;;) {
		struct pollfd p = { .fd = fd, .events = POLLIN };
		int n;
		long long now;
		clock_gettime(CLOCK_MONOTONIC, &ts);
		now = (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
		if (now > deadline)
			break;
		n = (int)recv(fd, buf, sizeof(buf), MSG_PEEK);
		if (n < 0 && (errno == EAGAIN || errno == EINTR)) {
			poll(&p, 1, 200);
			continue;
		}
		if (n <= 0)
			break;
		st = sni_parse_client_hello(buf, n, &hello);
		if (st != 0)
			break;
		poll(&p, 1, 200);
	}
	if (st == 1 && accel_match(&g_cfg, hello.sni)) {
		mitm(fd, &g_cfg, &hello);
		close(fd);
	} else {
		backend = tcp_connect_ip(g_cfg.backend_host, g_cfg.backend_port);
		if (backend >= 0) {
			splice_fds(fd, backend);
			close(backend);
		}
		close(fd);
	}
	pthread_mutex_lock(&g_lock);
	g_inflight--;
	pthread_mutex_unlock(&g_lock);
	return NULL;
}

static int listen_on(int family, int port)
{
	int fd;
	int on = 1;
	fd = socket(family, SOCK_STREAM, 0);
	if (fd < 0)
		return -1;
	setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
	if (family == AF_INET) {
		struct sockaddr_in sa;
		memset(&sa, 0, sizeof(sa));
		sa.sin_family = AF_INET;
		sa.sin_port = htons((uint16_t)port);
		sa.sin_addr.s_addr = htonl(INADDR_ANY);
		if (bind(fd, (struct sockaddr *)&sa, sizeof(sa)) != 0) {
			close(fd);
			return -1;
		}
	} else {
		struct sockaddr_in6 sa;
		memset(&sa, 0, sizeof(sa));
		sa.sin6_family = AF_INET6;
		sa.sin6_port = htons((uint16_t)port);
		setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &on, sizeof(on));
		if (bind(fd, (struct sockaddr *)&sa, sizeof(sa)) != 0) {
			close(fd);
			return -1;
		}
	}
	if (listen(fd, 64) != 0) {
		close(fd);
		return -1;
	}
	return fd;
}

static char *trim(char *s)
{
	char *e;
	while (*s && isspace((unsigned char)*s))
		s++;
	e = s + strlen(s);
	while (e > s && isspace((unsigned char)e[-1]))
		*--e = '\0';
	return s;
}

static int load_cfg(const char *path)
{
	FILE *fp;
	char line[512];

	memset(&g_cfg, 0, sizeof(g_cfg));
	snprintf(g_cfg.backend_host, sizeof(g_cfg.backend_host), "127.0.0.1");
	g_cfg.backend_port = 8443;
	snprintf(g_cfg.sni_mode, sizeof(g_cfg.sni_mode), "omit");
	snprintf(g_cfg.trust_file, sizeof(g_cfg.trust_file), "/etc/ssl/certs/ca-certificates.crt");
	snprintf(g_cfg.cert_dir, sizeof(g_cfg.cert_dir), "/tmp/openont-dns/certs");
	g_cfg.listen_port = 443;
	fp = fopen(path, "r");
	if (!fp)
		return -1;
	while (fgets(line, sizeof(line), fp)) {
		char *s = trim(line);
		char *sp;
		if (!*s || *s == '#')
			continue;
		sp = strchr(s, ' ');
		if (!sp)
			continue;
		*sp = '\0';
		sp = trim(sp + 1);
		if (!strcmp(s, "ca_key"))
			snprintf(g_cfg.ca_key, sizeof(g_cfg.ca_key), "%s", sp);
		else if (!strcmp(s, "ca_crt"))
			snprintf(g_cfg.ca_crt, sizeof(g_cfg.ca_crt), "%s", sp);
		else if (!strcmp(s, "cert_dir"))
			snprintf(g_cfg.cert_dir, sizeof(g_cfg.cert_dir), "%s", sp);
		else if (!strcmp(s, "backend_host"))
			snprintf(g_cfg.backend_host, sizeof(g_cfg.backend_host), "%s", sp);
		else if (!strcmp(s, "backend_port"))
			g_cfg.backend_port = atoi(sp);
		else if (!strcmp(s, "sni_mode"))
			snprintf(g_cfg.sni_mode, sizeof(g_cfg.sni_mode), "%s", sp);
		else if (!strcmp(s, "sni_name") && strcmp(sp, "-") != 0)
			snprintf(g_cfg.sni_name, sizeof(g_cfg.sni_name), "%s", sp);
		else if (!strcmp(s, "trust_file"))
			snprintf(g_cfg.trust_file, sizeof(g_cfg.trust_file), "%s", sp);
		else if (!strcmp(s, "listen_port"))
			g_cfg.listen_port = atoi(sp);
		else if (!strcmp(s, "accel") && g_cfg.naccel < MAX_ACCEL)
			snprintf(g_cfg.accel[g_cfg.naccel++], 256, "%s", sp);
	}
	fclose(fp);
	return 0;
}

int main(int argc, char **argv)
{
	int v4;
	int v6;

	signal(SIGPIPE, SIG_IGN);
	if (argc >= 4 && !strcmp(argv[1], "--gen-ca")) {
		mkdir("/etc/openont", 0755);
		mkdir("/etc/openont/dns", 0700);
		return generate_ca(argv[2], argv[3]) == 0 ? 0 : 1;
	}
	if (argc < 2) {
		fprintf(stderr, "usage: openont-tlsfront <config>\n");
		return 1;
	}
	if (load_cfg(argv[1]) != 0)
		return 1;
	mkdir(g_cfg.cert_dir, 0700);
	if (g_cfg.ca_key[0] && access(g_cfg.ca_crt, R_OK) != 0)
		generate_ca(g_cfg.ca_key, g_cfg.ca_crt);
	v4 = listen_on(AF_INET, g_cfg.listen_port);
	v6 = listen_on(AF_INET6, g_cfg.listen_port);
	if (v4 < 0 && v6 < 0) {
		fprintf(stderr, "openont-tlsfront: bind %d failed\n", g_cfg.listen_port);
		return 1;
	}
	fprintf(stderr, "openont-tlsfront: listening on %d\n", g_cfg.listen_port);
	for (;;) {
		struct pollfd p[2];
		int np = 0;
		int i;
		if (v4 >= 0) {
			p[np].fd = v4;
			p[np].events = POLLIN;
			np++;
		}
		if (v6 >= 0) {
			p[np].fd = v6;
			p[np].events = POLLIN;
			np++;
		}
		if (poll(p, (nfds_t)np, 1000) < 0) {
			if (errno == EINTR)
				continue;
			break;
		}
		for (i = 0; i < np; i++) {
			struct sockaddr_storage ss;
			socklen_t sl = sizeof(ss);
			int fd;
			pthread_t th;
			if (!(p[i].revents & POLLIN))
				continue;
			fd = accept(p[i].fd, (struct sockaddr *)&ss, &sl);
			if (fd < 0)
				continue;
			pthread_mutex_lock(&g_lock);
			if (g_inflight >= 64) {
				pthread_mutex_unlock(&g_lock);
				close(fd);
				continue;
			}
			g_inflight++;
			pthread_mutex_unlock(&g_lock);
			if (pthread_create(&th, NULL, conn_thread, (void *)(intptr_t)fd) != 0) {
				close(fd);
				pthread_mutex_lock(&g_lock);
				g_inflight--;
				pthread_mutex_unlock(&g_lock);
				continue;
			}
			pthread_detach(th);
		}
	}
	return 0;
}
