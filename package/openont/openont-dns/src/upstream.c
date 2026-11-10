/* SPDX-License-Identifier: GPL-2.0-only */
#define _GNU_SOURCE
#include "upstream.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/ip_icmp.h>
#include <poll.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

int upstream_tls_exchange(const struct upstream_srv *u, const uint8_t *q, int qlen,
			  uint8_t *resp, int respmax, int timeout_ms, int *rtt_ms);

static long long now_ms(void)
{
	struct timespec ts;

	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static int set_nonblock(int fd)
{
	int fl = fcntl(fd, F_GETFL, 0);
	if (fl < 0)
		return -1;
	return fcntl(fd, F_SETFL, fl | O_NONBLOCK);
}

static int addr_of(struct sockaddr_storage *ss, socklen_t *len, const char *host, int port)
{
	uint8_t b[16];

	memset(ss, 0, sizeof(*ss));
	if (dns_parse_ipv4(host, b) == 0) {
		struct sockaddr_in *in = (struct sockaddr_in *)ss;
		in->sin_family = AF_INET;
		in->sin_port = htons((uint16_t)port);
		memcpy(&in->sin_addr, b, 4);
		*len = sizeof(*in);
		return AF_INET;
	}
	if (dns_parse_ipv6(host, b) == 0) {
		struct sockaddr_in6 *in6 = (struct sockaddr_in6 *)ss;
		in6->sin6_family = AF_INET6;
		in6->sin6_port = htons((uint16_t)port);
		memcpy(&in6->sin6_addr, b, 16);
		*len = sizeof(*in6);
		return AF_INET6;
	}
	return -1;
}

static int wait_fd(int fd, short ev, int timeout_ms)
{
	struct pollfd p = { .fd = fd, .events = ev };
	int rc = poll(&p, 1, timeout_ms);
	if (rc <= 0)
		return -1;
	return (p.revents & ev) ? 0 : -1;
}

static int write_full(int fd, const uint8_t *buf, int len, int timeout_ms)
{
	int off = 0;
	long long deadline = now_ms() + timeout_ms;

	while (off < len) {
		int left = (int)(deadline - now_ms());
		int n;
		if (left < 0)
			return -1;
		if (wait_fd(fd, POLLOUT, left) != 0)
			return -1;
		n = (int)send(fd, buf + off, (size_t)(len - off), MSG_NOSIGNAL);
		if (n < 0) {
			if (errno == EINTR || errno == EAGAIN)
				continue;
			return -1;
		}
		off += n;
	}
	return 0;
}

static int read_full(int fd, uint8_t *buf, int len, int timeout_ms)
{
	int off = 0;
	long long deadline = now_ms() + timeout_ms;

	while (off < len) {
		int left = (int)(deadline - now_ms());
		int n;
		if (left < 0)
			return -1;
		if (wait_fd(fd, POLLIN, left) != 0)
			return -1;
		n = (int)recv(fd, buf + off, (size_t)(len - off), 0);
		if (n == 0)
			return -1;
		if (n < 0) {
			if (errno == EINTR || errno == EAGAIN)
				continue;
			return -1;
		}
		off += n;
	}
	return 0;
}

static int exchange_udp(const struct upstream_srv *u, const uint8_t *q, int qlen,
			uint8_t *resp, int respmax, int timeout_ms)
{
	struct sockaddr_storage ss;
	socklen_t slen = 0;
	int fam;
	int fd;
	int n;

	fam = addr_of(&ss, &slen, u->host, u->port > 0 ? u->port : 53);
	if (fam < 0)
		return -1;
	fd = socket(fam, SOCK_DGRAM, 0);
	if (fd < 0)
		return -1;
	set_nonblock(fd);
	if (sendto(fd, q, (size_t)qlen, 0, (struct sockaddr *)&ss, slen) != qlen) {
		close(fd);
		return -1;
	}
	if (wait_fd(fd, POLLIN, timeout_ms) != 0) {
		close(fd);
		return -1;
	}
	n = (int)recv(fd, resp, (size_t)respmax, 0);
	close(fd);
	return n > 12 ? n : -1;
}

static int exchange_tcp(const struct upstream_srv *u, const uint8_t *q, int qlen,
			uint8_t *resp, int respmax, int timeout_ms)
{
	struct sockaddr_storage ss;
	socklen_t slen = 0;
	int fam;
	int fd;
	int rc;
	uint8_t lenb[2];
	int body;

	fam = addr_of(&ss, &slen, u->host, u->port > 0 ? u->port : 53);
	if (fam < 0 || qlen > 65535)
		return -1;
	fd = socket(fam, SOCK_STREAM, 0);
	if (fd < 0)
		return -1;
	set_nonblock(fd);
	rc = connect(fd, (struct sockaddr *)&ss, slen);
	if (rc < 0 && errno != EINPROGRESS) {
		close(fd);
		return -1;
	}
	if (wait_fd(fd, POLLOUT, timeout_ms) != 0) {
		close(fd);
		return -1;
	}
	{
		int err = 0;
		socklen_t el = sizeof(err);
		getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &el);
		if (err) {
			close(fd);
			return -1;
		}
	}
	lenb[0] = (uint8_t)(qlen >> 8);
	lenb[1] = (uint8_t)qlen;
	if (write_full(fd, lenb, 2, timeout_ms) != 0 ||
	    write_full(fd, q, qlen, timeout_ms) != 0 ||
	    read_full(fd, lenb, 2, timeout_ms) != 0) {
		close(fd);
		return -1;
	}
	body = (lenb[0] << 8) | lenb[1];
	if (body < 12 || body > respmax) {
		close(fd);
		return -1;
	}
	if (read_full(fd, resp, body, timeout_ms) != 0) {
		close(fd);
		return -1;
	}
	close(fd);
	return body;
}

int upstream_exchange(const struct upstream_srv *u, const uint8_t *q, int qlen,
		      uint8_t *resp, int respmax, int timeout_ms, int *rtt_ms)
{
	long long t0;
	int n;

	if (!u || !q || qlen < 12 || !resp)
		return -1;
	t0 = now_ms();
	if (!strcmp(u->proto, "tcp"))
		n = exchange_tcp(u, q, qlen, resp, respmax, timeout_ms);
	else if (!strcmp(u->proto, "dot") || !strcmp(u->proto, "doh"))
		n = upstream_tls_exchange(u, q, qlen, resp, respmax, timeout_ms, rtt_ms);
	else
		n = exchange_udp(u, q, qlen, resp, respmax, timeout_ms);
	if (rtt_ms && n > 0 && !strcmp(u->proto, "udp"))
		*rtt_ms = (int)(now_ms() - t0);
	else if (rtt_ms && n > 0 && !strcmp(u->proto, "tcp"))
		*rtt_ms = (int)(now_ms() - t0);
	return n;
}

struct race_shared {
	pthread_mutex_t mu;
	pthread_cond_t cv;
	int n;
	int finished;
	int mode;
	int closed;
	int main_done;
	int freed;
	struct upstream_result *results;
};

struct race_job {
	struct race_shared *sh;
	int idx;
	struct upstream_srv u;
	uint8_t q[DNS_MAX_PACKET];
	int qlen;
	int timeout_ms;
};

static void race_destroy(struct race_shared *sh)
{
	pthread_mutex_destroy(&sh->mu);
	pthread_cond_destroy(&sh->cv);
	free(sh->results);
	free(sh);
}

static void *race_thread(void *arg)
{
	struct race_job *job = arg;
	uint8_t resp[DNS_MAX_PACKET];
	int rtt = 0;
	int n;
	int last = 0;

	n = upstream_exchange(&job->u, job->q, job->qlen, resp, sizeof(resp), job->timeout_ms, &rtt);
	pthread_mutex_lock(&job->sh->mu);
	job->sh->finished++;
	if (!job->sh->closed && n > 12) {
		struct upstream_result *r = &job->sh->results[job->idx];
		r->rlen = n;
		r->rtt_ms = rtt > 0 ? rtt : 1;
		r->finish_seq = job->sh->finished;
		memcpy(r->pkt, resp, (size_t)n);
	}
	pthread_cond_signal(&job->sh->cv);
	last = job->sh->main_done && job->sh->finished == job->sh->n && !job->sh->freed;
	if (last)
		job->sh->freed = 1;
	pthread_mutex_unlock(&job->sh->mu);
	if (last)
		race_destroy(job->sh);
	free(job);
	return NULL;
}

static int any_success(const struct race_shared *sh)
{
	int i;
	for (i = 0; i < sh->n; i++) {
		if (sh->results[i].rlen > 12)
			return 1;
	}
	return 0;
}

int upstream_race(const struct upstream_srv *list, int n, const uint8_t *q, int qlen,
		  int mode, int timeout_ms, struct upstream_result *results, int max_results)
{
	struct race_shared *sh;
	int started = 0;
	int i;
	int outn = 0;
	struct timespec deadline;
	int last = 0;

	if (!list || n <= 0 || !q || qlen < 12 || qlen > DNS_MAX_PACKET || !results)
		return -1;
	if (n > 8)
		n = 8;
	sh = calloc(1, sizeof(*sh));
	if (!sh)
		return -1;
	sh->results = calloc((size_t)n, sizeof(*sh->results));
	if (!sh->results) {
		free(sh);
		return -1;
	}
	pthread_mutex_init(&sh->mu, NULL);
	pthread_cond_init(&sh->cv, NULL);
	sh->mode = mode;
	clock_gettime(CLOCK_REALTIME, &deadline);
	deadline.tv_sec += timeout_ms / 1000;
	deadline.tv_nsec += (long)(timeout_ms % 1000) * 1000000L;
	if (deadline.tv_nsec >= 1000000000L) {
		deadline.tv_sec++;
		deadline.tv_nsec -= 1000000000L;
	}

	for (i = 0; i < n; i++) {
		struct race_job *job = calloc(1, sizeof(*job));
		pthread_t th;
		if (!job)
			break;
		job->sh = sh;
		job->idx = started;
		job->u = list[i];
		memcpy(job->q, q, (size_t)qlen);
		job->qlen = qlen;
		job->timeout_ms = timeout_ms;
		if (pthread_create(&th, NULL, race_thread, job) != 0) {
			free(job);
			break;
		}
		pthread_detach(th);
		started++;
	}
	sh->n = started;
	if (!started) {
		race_destroy(sh);
		return -1;
	}

	pthread_mutex_lock(&sh->mu);
	for (;;) {
		if (sh->finished == sh->n)
			break;
		if (mode == UP_FIRST && any_success(sh))
			break;
		if (pthread_cond_timedwait(&sh->cv, &sh->mu, &deadline) == ETIMEDOUT)
			break;
	}
	sh->closed = 1;
	for (i = 0; i < sh->n && outn < max_results; i++) {
		if (sh->results[i].rlen > 12)
			results[outn++] = sh->results[i];
	}
	if (mode == UP_FIRST && outn > 1) {
		int best = 0;
		for (i = 1; i < outn; i++) {
			if (results[i].finish_seq < results[best].finish_seq)
				best = i;
		}
		if (best != 0)
			results[0] = results[best];
		outn = 1;
	} else if (mode == UP_FASTEST_RESP && outn > 1) {
		int best = 0;
		for (i = 1; i < outn; i++) {
			if (results[i].rtt_ms < results[best].rtt_ms)
				best = i;
		}
		if (best != 0)
			results[0] = results[best];
		outn = 1;
	}
	sh->main_done = 1;
	last = sh->finished == sh->n && !sh->freed;
	if (last)
		sh->freed = 1;
	pthread_mutex_unlock(&sh->mu);
	if (last)
		race_destroy(sh);
	return outn;
}

int upstream_resolve_a(const char *bootstrap_ip, int port, const char *name, char *out_ip, int outlen)
{
	struct upstream_srv u;
	uint8_t q[512];
	uint8_t resp[512];
	struct dns_rr rr[4];
	int qlen;
	int n;
	int i;

	if (!bootstrap_ip || !name || !out_ip)
		return -1;
	memset(&u, 0, sizeof(u));
	snprintf(u.proto, sizeof(u.proto), "udp");
	snprintf(u.host, sizeof(u.host), "%s", bootstrap_ip);
	u.port = port > 0 ? port : 53;
	qlen = dns_build_query(q, sizeof(q), 1, name, DNS_T_A);
	if (qlen < 0)
		return -1;
	n = upstream_exchange(&u, q, qlen, resp, sizeof(resp), 1500, NULL);
	if (n < 12)
		return -1;
	n = dns_parse_answers(resp, n, rr, 4);
	for (i = 0; i < n; i++) {
		if (rr[i].type == DNS_T_A && rr[i].text[0]) {
			snprintf(out_ip, (size_t)outlen, "%s", rr[i].text);
			return 0;
		}
	}
	return -1;
}

static unsigned icmp_sum(const uint8_t *b, int len)
{
	unsigned sum = 0;
	int i;
	for (i = 0; i + 1 < len; i += 2)
		sum += (unsigned)((b[i] << 8) | b[i + 1]);
	if (len & 1)
		sum += (unsigned)(b[len - 1] << 8);
	while (sum >> 16)
		sum = (sum & 0xffff) + (sum >> 16);
	return ~sum & 0xffff;
}

static int probe_icmp(const char *ip, int timeout_ms)
{
	uint8_t addr[4];
	int fd;
	uint8_t pkt[64];
	struct icmphdr *ih;
	struct sockaddr_in sa;
	long long t0;
	uint16_t id;

	if (dns_parse_ipv4(ip, addr) != 0)
		return -1;
	fd = socket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
	if (fd < 0)
		return -1;
	memset(pkt, 0, sizeof(pkt));
	ih = (struct icmphdr *)pkt;
	ih->type = ICMP_ECHO;
	ih->code = 0;
	id = (uint16_t)getpid();
	ih->un.echo.id = htons(id);
	ih->un.echo.sequence = htons(1);
	ih->checksum = htons((uint16_t)icmp_sum(pkt, 16));
	memset(&sa, 0, sizeof(sa));
	sa.sin_family = AF_INET;
	memcpy(&sa.sin_addr, addr, 4);
	t0 = now_ms();
	if (sendto(fd, pkt, 16, 0, (struct sockaddr *)&sa, sizeof(sa)) < 0) {
		close(fd);
		return -1;
	}
	set_nonblock(fd);
	if (wait_fd(fd, POLLIN, timeout_ms) != 0) {
		close(fd);
		return -1;
	}
	close(fd);
	return (int)(now_ms() - t0);
}

static int probe_tcp(const char *ip, int port, int timeout_ms)
{
	struct sockaddr_storage ss;
	socklen_t slen = 0;
	int fam;
	int fd;
	int rc;
	long long t0;

	fam = addr_of(&ss, &slen, ip, port);
	if (fam < 0)
		return -1;
	fd = socket(fam, SOCK_STREAM, 0);
	if (fd < 0)
		return -1;
	set_nonblock(fd);
	t0 = now_ms();
	rc = connect(fd, (struct sockaddr *)&ss, slen);
	if (rc < 0 && errno != EINPROGRESS) {
		close(fd);
		return -1;
	}
	if (wait_fd(fd, POLLOUT, timeout_ms) != 0) {
		close(fd);
		return -1;
	}
	{
		int err = 0;
		socklen_t el = sizeof(err);
		getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &el);
		close(fd);
		if (err)
			return -1;
	}
	return (int)(now_ms() - t0);
}

int upstream_pick_ip(char ips[][64], int nips, int speed, int timeout_ms, char *best, int bestlen)
{
	int i;
	int best_rtt = 0x7fffffff;
	int found = 0;

	if (!ips || nips <= 0 || !best)
		return -1;
	if (speed == UP_SPEED_OFF) {
		snprintf(best, (size_t)bestlen, "%s", ips[0]);
		return 0;
	}
	for (i = 0; i < nips && i < 8; i++) {
		int rtt = (speed == UP_SPEED_ICMP) ? probe_icmp(ips[i], timeout_ms)
						   : probe_tcp(ips[i], 443, timeout_ms);
		if (rtt >= 0 && rtt < best_rtt) {
			best_rtt = rtt;
			snprintf(best, (size_t)bestlen, "%s", ips[i]);
			found = 1;
		}
	}
	if (!found) {
		snprintf(best, (size_t)bestlen, "%s", ips[0]);
		return 0;
	}
	return 0;
}
