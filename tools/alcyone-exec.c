#define _GNU_SOURCE

#include <dirent.h>
#include <errno.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <unistd.h>

extern char **environ;

static void fail(const char *code) {
    size_t length = strlen(code);
    (void)write(STDERR_FILENO, code, length);
    (void)write(STDERR_FILENO, "\n", 1);
    _exit(111);
}

static rlim_t parse_nofile(const char *value) {
    char *end = NULL;
    unsigned long parsed;
    errno = 0;
    parsed = strtoul(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' ||
        parsed < 1024UL || parsed > 65536UL) {
        fail("ALCYONE_EXEC_BAD_NOFILE");
    }
    return (rlim_t)parsed;
}

static void close_inherited_fds(void) {
    DIR *directory = opendir("/proc/self/fd");
    if (directory != NULL) {
        struct dirent *entry;
        int directory_fd = dirfd(directory);
        while ((entry = readdir(directory)) != NULL) {
            char *end = NULL;
            long fd;
            errno = 0;
            fd = strtol(entry->d_name, &end, 10);
            if (errno == 0 && end != entry->d_name && *end == '\0' &&
                fd >= 3 && fd != directory_fd && fd <= INT32_MAX) {
                (void)close((int)fd);
            }
        }
        (void)closedir(directory);
        return;
    }

    {
        struct rlimit current;
        rlim_t limit = 65536;
        rlim_t fd;
        if (getrlimit(RLIMIT_NOFILE, &current) == 0 && current.rlim_cur < limit) {
            limit = current.rlim_cur;
        }
        for (fd = 3; fd < limit; ++fd) (void)close((int)fd);
    }
}

int main(int argc, char **argv) {
    pid_t parent;
    rlim_t nofile;
    struct rlimit limit;

    if (argc < 5 || strcmp(argv[1], "--nofile") != 0 ||
        strcmp(argv[3], "--") != 0 || argv[4][0] != '/') {
        fail("ALCYONE_EXEC_USAGE");
    }

    nofile = parse_nofile(argv[2]);
    parent = getppid();
    if (parent <= 1) fail("ALCYONE_EXEC_NO_PARENT");
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0) fail("ALCYONE_EXEC_PDEATHSIG");
    if (getppid() != parent) fail("ALCYONE_EXEC_PARENT_CHANGED");

    limit.rlim_cur = nofile;
    limit.rlim_max = nofile;
    if (setrlimit(RLIMIT_NOFILE, &limit) != 0) {
        /* Some rooted firmwares keep CAP_SYS_RESOURCE constrained. Use the
         highest inherited capability instead of refusing to start the core. */
        if (getrlimit(RLIMIT_NOFILE, &limit) != 0 || limit.rlim_max < 1024) {
            fail("ALCYONE_EXEC_RLIMIT");
        }
        limit.rlim_cur = limit.rlim_max;
        if (setrlimit(RLIMIT_NOFILE, &limit) != 0) fail("ALCYONE_EXEC_RLIMIT");
    }

    close_inherited_fds();
    execve(argv[4], &argv[4], environ);
    fail("ALCYONE_EXEC_EXECVE");
    return 111;
}
