/* alcyone-netguard - independent network fail-open guardian for Alcyone.

   Runs detached from the Node service while a VPN diversion is active.
   Watches a heartbeat file refreshed by the service; if heartbeats stop
   for LEASE_MS (service crash, SIGSTOP or hang), removes ONLY the leased
   objects through rtnetlink - activation rule first, owned routes next,
   TUN interface last - and records a .fired report. Ordinary internet
   returns without any Node code running.

   Contract: no fork, no exec, no shell, no dynamic config beyond the
   root-only lease file. Exit codes: 0 clean exit / fail-open executed,
   2 lease parse error, 3 usage error.
*/

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/rtnetlink.h>
#include <net/if.h>
#include <arpa/inet.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#define LEASE_MAX_ROUTES 16
#define REPORT_STEP_MAX 8

static volatile sig_atomic_t g_stop = 0;

static void on_signal(int sig) {
  (void)sig;
  g_stop = 1;
}

struct route_entry {
  int family;        /* AF_INET or AF_INET6 */
  int unreachable;   /* 1 for type unreachable (IPv6 block) */
  unsigned char dst[16];
  int plen;
};

struct lease {
  char edition[64];
  char tun_if[IFNAMSIZ];
  int have_rule;
  int rule_pref;
  int rule_table;
  int v6_rule;
  struct route_entry routes[LEASE_MAX_ROUTES];
  int n_routes;
  long lease_ms;
  char heartbeat[PATH_MAX];
};

static void iso_ts(char *buf, size_t len) {
  time_t now = time(NULL);
  struct tm tm_utc;
  gmtime_r(&now, &tm_utc);
  strftime(buf, len, "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
}

static void trim_quotes(char *v) {
  size_t n = strlen(v);
  if (n >= 2 && '\'' == v[0] && '\'' == v[n - 1]) {
    v[n - 1] = '\0';
    memmove(v, v + 1, n - 1);
  }
}

static int parse_prefix(const char *text, struct route_entry *out) {
  char buf[80];
  char *slash;
  const char *pfx;
  long plen;
  slash = strchr(text, '/');
  if (!slash || slash == text || (size_t)(slash - text) >= sizeof(buf))
    return -1;
  memcpy(buf, text, (size_t)(slash - text));
  buf[slash - text] = '\0';
  pfx = buf;
  plen = strtol(slash + 1, NULL, 10);
  memset(out->dst, 0, sizeof(out->dst));
  out->unreachable = 0;
  if (strchr(buf, ':')) {
    if (plen < 0 || plen > 128 || 1 != inet_pton(AF_INET6, pfx, out->dst))
      return -1;
    out->family = AF_INET6;
    out->plen = (int)plen;
    return 0;
  }
  if (plen < 0 || plen > 32 || 1 != inet_pton(AF_INET, pfx, out->dst))
    return -1;
  out->family = AF_INET;
  out->plen = (int)plen;
  return 0;
}

static void parse_route_list(const char *value, const char *kind,
                             struct lease *lease,
                             char *errbuf, size_t errlen) {
  char tmp[1024];
  char *tok, *save = NULL;
  strncpy(tmp, value, sizeof(tmp) - 1);
  tmp[sizeof(tmp) - 1] = '\0';
  for (tok = strtok_r(tmp, ",", &save); tok;
       tok = strtok_r(NULL, ",", &save)) {
    struct route_entry entry;
    if (lease->n_routes >= LEASE_MAX_ROUTES)
      break;
    if (0 != parse_prefix(tok, &entry)) {
      snprintf(errbuf, errlen, "bad %s prefix '%s'", kind, tok);
      continue;
    }
    if (0 == strcmp(kind, "V6BLOCK")) entry.unreachable = 1;
    lease->routes[lease->n_routes++] = entry;
  }
}

static int parse_lease(const char *path, struct lease *lease,
                       char *errbuf, size_t errlen) {
  FILE *f;
  char line[2048];
  memset(lease, 0, sizeof(*lease));
  lease->lease_ms = 30000;
  f = fopen(path, "r");
  if (!f) {
    snprintf(errbuf, errlen, "open failed errno=%d", errno);
    return -1;
  }
  while (fgets(line, sizeof(line), f)) {
    char *eq, *key, *val;
    line[strcspn(line, "\r\n")] = '\0';
    if ('#' == line[0] || '\0' == line[0]) continue;
    eq = strchr(line, '=');
    if (!eq) continue;
    *eq = '\0';
    key = line;
    val = eq + 1;
    trim_quotes(val);
    if (0 == strcmp(key, "EDITION")) {
      strncpy(lease->edition, val, sizeof(lease->edition) - 1);
    } else if (0 == strcmp(key, "TUN_IF")) {
      strncpy(lease->tun_if, val, sizeof(lease->tun_if) - 1);
    } else if (0 == strcmp(key, "RULE_PREF")) {
      if ('\0' != val[0]) { lease->have_rule = 1; lease->rule_pref = atoi(val); }
    } else if (0 == strcmp(key, "RULE_TABLE")) {
      if ('\0' != val[0]) { lease->have_rule = 1; lease->rule_table = atoi(val); }
    } else if (0 == strcmp(key, "V6_RULE")) {
      lease->v6_rule = ('1' == val[0]);
    } else if (0 == strcmp(key, "SPLIT_V4")) {
      parse_route_list(val, "SPLIT_V4", lease, errbuf, errlen);
    } else if (0 == strcmp(key, "V6_BLOCK")) {
      parse_route_list(val, "V6BLOCK", lease, errbuf, errlen);
    } else if (0 == strcmp(key, "LEASE_MS")) {
      long ms = strtol(val, NULL, 10);
      if (ms >= 1000) lease->lease_ms = ms;
    } else if (0 == strcmp(key, "HEARTBEAT")) {
      strncpy(lease->heartbeat, val, sizeof(lease->heartbeat) - 1);
    }
  }
  fclose(f);
  return 0;
}

static int nl_open(void) {
  int fd = socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC, NETLINK_ROUTE);
  return fd;
}

static int nl_talk(int fd, struct nlmsghdr *nh) {
  char reply[4096];
  struct sockaddr_nl addr;
  socklen_t addrlen = sizeof(addr);
  struct iovec iov;
  struct msghdr mh;
  ssize_t got;
  nh->nlmsg_seq = (uint32_t)getpid();
  nh->nlmsg_pid = 0;
  memset(&addr, 0, sizeof(addr));
  addr.nl_family = AF_NETLINK;
  iov.iov_base = nh;
  iov.iov_len = nh->nlmsg_len;
  memset(&mh, 0, sizeof(mh));
  mh.msg_name = &addr;
  mh.msg_namelen = addrlen;
  mh.msg_iov = &iov;
  mh.msg_iovlen = 1;
  if (sendmsg(fd, &mh, 0) < 0) return -1;
  got = recvmsg(fd, &mh, 0);
  if (got < 0) return -1;
  if ((size_t)got < NLMSG_LENGTH(sizeof(struct nlmsgerr))) return -1;
  if (NLMSG_OK(nh, (unsigned)got) && NLMSG_ERROR == nh->nlmsg_type) {
    struct nlmsgerr *e = (struct nlmsgerr *)NLMSG_DATA(nh);
    /* ESRCH/EEXIST/ENOENT mean the object is already gone: success. */
    if (0 == e->error || ESRCH == -e->error ||
        ENOENT == -e->error || EEXIST == -e->error) return 0;
    errno = -e->error;
    return -1;
  }
  return 0;
}

static int del_rule(int fd, int family, int pref, int table) {
  char buf[NLMSG_ALIGN(sizeof(struct nlmsghdr)) +
           NLMSG_ALIGN(sizeof(struct fib_rule_hdr)) + 128];
  struct nlmsghdr *nh = (struct nlmsghdr *)buf;
  struct fib_rule_hdr *frh;
  struct rtattr *rta;
  memset(buf, 0, sizeof(buf));
  nh->nlmsg_type = RTM_DELRULE;
  nh->nlmsg_flags = NLM_F_REQUEST | NLM_F_ACK;
  frh = (struct fib_rule_hdr *)NLMSG_DATA(nh);
  frh->family = (unsigned char)family;
  frh->action = FR_ACT_TO_TBL;
  nh->nlmsg_len = NLMSG_LENGTH(sizeof(*frh));
  if (pref > 0) {
    rta = (struct rtattr *)((char *)nh + NLMSG_ALIGN(nh->nlmsg_len));
    rta->rta_type = FRA_PRIORITY;
    rta->rta_len = RTA_LENGTH(4);
    memcpy(RTA_DATA(rta), &pref, 4);
    nh->nlmsg_len = NLMSG_ALIGN(nh->nlmsg_len) + rta->rta_len;
  }
  if (table > 0) {
    rta = (struct rtattr *)((char *)nh + NLMSG_ALIGN(nh->nlmsg_len));
    rta->rta_type = FRA_TABLE;
    rta->rta_len = RTA_LENGTH(4);
    memcpy(RTA_DATA(rta), &table, 4);
    nh->nlmsg_len = NLMSG_ALIGN(nh->nlmsg_len) + rta->rta_len;
  }
  return nl_talk(fd, nh);
}

static int del_route(int fd, const struct route_entry *re, int oif) {
  char buf[NLMSG_ALIGN(sizeof(struct nlmsghdr)) +
           NLMSG_ALIGN(sizeof(struct rtmsg)) + 256];
  struct nlmsghdr *nh = (struct nlmsghdr *)buf;
  struct rtmsg *rtm;
  struct rtattr *rta;
  int table = re->unreachable ? RT_TABLE_LOCAL : RT_TABLE_MAIN;
  memset(buf, 0, sizeof(buf));
  nh->nlmsg_type = RTM_DELROUTE;
  nh->nlmsg_flags = NLM_F_REQUEST | NLM_F_ACK;
  rtm = (struct rtmsg *)NLMSG_DATA(nh);
  rtm->rtm_family = (unsigned char)re->family;
  rtm->rtm_dst_len = (unsigned char)re->plen;
  rtm->rtm_src_len = 0;
  rtm->rtm_tos = 0;
  rtm->rtm_table = (unsigned char)(table & 0xff);
  rtm->rtm_type = re->unreachable ? RTN_UNREACHABLE : RTN_UNICAST;
  rtm->rtm_scope = RT_SCOPE_UNIVERSE;
  rtm->rtm_protocol = RTPROT_BOOT;
  nh->nlmsg_len = NLMSG_LENGTH(sizeof(*rtm));
  rta = (struct rtattr *)((char *)nh + NLMSG_ALIGN(nh->nlmsg_len));
  rta->rta_type = RTA_DST;
  rta->rta_len = RTA_LENGTH(re->family == AF_INET6 ? 16 : 4);
  memcpy(RTA_DATA(rta), re->dst, re->family == AF_INET6 ? 16 : 4);
  nh->nlmsg_len = NLMSG_ALIGN(nh->nlmsg_len) + rta->rta_len;
  rta = (struct rtattr *)((char *)nh + NLMSG_ALIGN(nh->nlmsg_len));
  rta->rta_type = RTA_TABLE;
  rta->rta_len = RTA_LENGTH(4);
  memcpy(RTA_DATA(rta), &table, 4);
  nh->nlmsg_len = NLMSG_ALIGN(nh->nlmsg_len) + rta->rta_len;
  if (oif > 0) {
    rta = (struct rtattr *)((char *)nh + NLMSG_ALIGN(nh->nlmsg_len));
    rta->rta_type = RTA_OIF;
    rta->rta_len = RTA_LENGTH(4);
    memcpy(RTA_DATA(rta), &oif, 4);
    nh->nlmsg_len = NLMSG_ALIGN(nh->nlmsg_len) + rta->rta_len;
  }
  return nl_talk(fd, nh);
}

static int ifindex_of(const char *name) {
  struct ifreq ifr;
  int fd, idx;
  fd = socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return -1;
  memset(&ifr, 0, sizeof(ifr));
  strncpy(ifr.ifr_name, name, IFNAMSIZ - 1);
  if (ioctl(fd, SIOCGIFINDEX, &ifr) < 0) {
    close(fd);
    return -1;
  }
  idx = ifr.ifr_ifindex;
  close(fd);
  return idx;
}

static int del_link(int fd, const char *name) {
  char buf[NLMSG_ALIGN(sizeof(struct nlmsghdr)) +
           NLMSG_ALIGN(sizeof(struct ifinfomsg)) + 64];
  struct nlmsghdr *nh = (struct nlmsghdr *)buf;
  struct ifinfomsg *ifi;
  int idx = ifindex_of(name);
  if (idx <= 0) return -1;
  memset(buf, 0, sizeof(buf));
  nh->nlmsg_type = RTM_DELLINK;
  nh->nlmsg_flags = NLM_F_REQUEST | NLM_F_ACK;
  ifi = (struct ifinfomsg *)NLMSG_DATA(nh);
  ifi->ifi_family = AF_UNSPEC;
  ifi->ifi_index = idx;
  nh->nlmsg_len = NLMSG_LENGTH(sizeof(*ifi));
  return nl_talk(fd, nh);
}

struct step_report {
  char steps[REPORT_STEP_MAX][96];
  int n;
};

static void record(struct step_report *rep, const char *fmt, ...) {
  va_list ap;
  if (rep->n >= REPORT_STEP_MAX) return;
  va_start(ap, fmt);
  vsnprintf(rep->steps[rep->n], sizeof(rep->steps[0]), fmt, ap);
  va_end(ap);
  rep->n++;
}

static void touch_heartbeat(const struct lease *lease) {
  /* The acknowledgement contract: heartbeat content becomes the guardian
     PID, so the client can tell a parsed lease from its own pre-touch. */
  char buf[32];
  int len, fd = open(lease->heartbeat, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
  if (fd >= 0) {
    len = snprintf(buf, sizeof(buf), "%ld\n", (long)getpid());
    if (len > 0) {
      ssize_t ignored = write(fd, buf, (size_t)len);
      (void)ignored;
    }
    futimens(fd, NULL);
    close(fd);
  }
}

static void fail_open(const struct lease *lease, const char *lease_path) {
  int fd = nl_open();
  int i, oif = -1;
  struct step_report rep;
  char ts[32];
  FILE *fired;
  char path[PATH_MAX];
  memset(&rep, 0, sizeof(rep));
  if (fd < 0) record(&rep, "netlink=errno%d", errno);
  if ('\0' != lease->tun_if[0]) oif = ifindex_of(lease->tun_if);
  if (fd >= 0 && lease->have_rule) {
    int rc = del_rule(fd, AF_INET, lease->rule_pref, lease->rule_table);
    record(&rep, "del_rule_v4=%s", rc ? "errno" : "ok");
  }
  if (fd >= 0 && lease->v6_rule && lease->have_rule) {
    int rc = del_rule(fd, AF_INET6, lease->rule_pref, lease->rule_table);
    record(&rep, "del_rule_v6=%s", rc ? "errno" : "ok");
  }
  for (i = 0; i < lease->n_routes; i++) {
    struct route_entry *re = &lease->routes[i];
    int rc;
    if (AF_INET == re->family && oif > 0)
      rc = del_route(fd, re, oif);
    else
      rc = del_route(fd, re, -1);
    record(&rep, "del_route%d=%s", i, rc ? "errno" : "ok");
  }
  if (fd >= 0 && '\0' != lease->tun_if[0]) {
    int rc = del_link(fd, lease->tun_if);
    record(&rep, "del_link=%s", rc ? "errno" : "ok");
  }
  if (fd >= 0) close(fd);
  iso_ts(ts, sizeof(ts));
  snprintf(path, sizeof(path), "%s.fired", lease_path);
  fired = fopen(path, "w");
  if (fired) {
    fprintf(fired, "FAILOPEN_AT='%s'\n", ts);
    for (i = 0; i < rep.n; i++) fprintf(fired, "STEP_%d='%s'\n", i, rep.steps[i]);
    fclose(fired);
    chmod(path, 0600);
  }
  unlink(lease_path);
}

int main(int argc, char **argv) {
  struct lease lease;
  char errbuf[192] = "";
  const char *lease_path = "";
  const char *heartbeat_path = "";
  int check_only = 0, i, fd;
  long poll_ms = 1000;

  for (i = 1; i < argc; i++) {
    if (0 == strcmp(argv[i], "--lease") && i + 1 < argc) {
      lease_path = argv[++i];
    } else if (0 == strcmp(argv[i], "--check")) {
      check_only = 1;
    } else {
      fprintf(stderr, "usage: alcyone-netguard --lease PATH [--check]\n");
      return 3;
    }
  }
  if ('\0' == lease_path[0]) {
    fprintf(stderr, "usage: alcyone-netguard --lease PATH [--check]\n");
    return 3;
  }
  if (0 != parse_lease(lease_path, &lease, errbuf, sizeof(errbuf))) {
    fprintf(stderr, "lease unreadable: %s\n", errbuf);
    return 2;
  }
  heartbeat_path = lease.heartbeat;
  if (check_only) {
    printf("EDITION='%s'\n", lease.edition);
    printf("TUN_IF='%s'\n", lease.tun_if);
    printf("RULE='%d/%d' V6_RULE='%d'\n",
           lease.rule_pref, lease.rule_table, lease.v6_rule);
    printf("ROUTES='%d' LEASE_MS='%ld'\n", lease.n_routes, lease.lease_ms);
    printf("HEARTBEAT='%s'\n", heartbeat_path);
    return 0;
  }
  if ('\0' == heartbeat_path[0]) {
    fprintf(stderr, "lease has no HEARTBEAT path\n");
    return 2;
  }
  signal(SIGTERM, on_signal);
  signal(SIGINT, on_signal);
  signal(SIGHUP, SIG_IGN);
  /* Best-effort protection from the TV's OOM killer. */
  fd = open("/proc/self/oom_score_adj", O_WRONLY | O_CLOEXEC);
  if (fd >= 0) {
    ssize_t ignored = write(fd, "-500\n", 5);
    (void)ignored;
    close(fd);
  }
  touch_heartbeat(&lease); /* acknowledge arming */
  while (!g_stop) {
    struct stat st;
    long idle_ms;
    struct timespec ts;
    if (stat(lease_path, &st) != 0) break; /* disarmed by owner */
    if (stat(heartbeat_path, &st) == 0) {
      idle_ms = (long)((time(NULL) - st.st_mtime) * 1000L);
      if (idle_ms > lease.lease_ms) {
        fail_open(&lease, lease_path);
        break;
      }
    } else if (errno == ENOENT) {
      /* Heartbeat lost entirely counts as an expired lease. */
      fail_open(&lease, lease_path);
      break;
    }
    ts.tv_sec = poll_ms / 1000;
    ts.tv_nsec = (poll_ms % 1000) * 1000000L;
    nanosleep(&ts, NULL);
  }
  return 0;
}
