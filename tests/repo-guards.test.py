"""Repository guard: reject insecure patterns in the production tree.

These are the specific regressions the maintainer review called out. Each one
is cheap to reintroduce by accident, so the build fails if any reappears.

Scope is the shipped application, packaging and build tooling. Historical
archives, published IPKs and release notes are excluded: they are records of
what was released, not code that runs on a TV.
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Directories that are documentation or frozen history, not the active build.
EXCLUDED_DIRS = frozenset([
    ".git", "node_modules", "release-assets", "packages", "__pycache__",
    "docs", "cores", "assets",
])

SCANNED_EXTENSIONS = (".js", ".py", ".sh", ".json", ".html", ".css", ".in", ".yml", ".yaml")

# Files allowed to mention a pattern because their job is to forbid it.
GUARD_FILES = frozenset([
    os.path.join("tests", "repo-guards.test.py"),
    os.path.join("tests", "frontend-luna.test.js"),
])


def rule(name, pattern, explanation):
    return {"name": name, "regex": re.compile(pattern), "explanation": explanation}


RULES = [
    rule(
        "Homebrew Channel exec",
        r"hbchannel[^\s'\"]*/exec|org\.webosbrew\.hbchannel\.service/exec",
        "privileged work must go through the Alcyone Luna service, not a generic shell endpoint",
    ),
    rule(
        "insecure TLS opt-out",
        r"rejectUnauthorized\s*:\s*false",
        "certificate validation must never be disabled",
    ),
    rule(
        "wget certificate bypass",
        r"--no-check-certificate",
        "certificate validation must never be disabled",
    ),
    rule(
        "curl certificate bypass",
        r"curl\s+(?:[^\n|;&]*\s)?-{1,2}(?:k|insecure)\b",
        "certificate validation must never be disabled",
    ),
    rule(
        "unrelated legacy application path",
        r"vless\.m\.vpn",
        "the application must not read, modify or migrate another app's files",
    ),
    rule(
        "online native core installer",
        r"install_(?:xray|singbox|tun2socks)_online",
        "the installed application must never download and execute a native binary",
    ),
    rule(
        "wildcard CORS",
        r"Access-Control-Allow-Origin['\"]?\s*[:,]\s*['\"]\*",
        "cross-origin access must not be granted to every origin",
    ),
    rule(
        "shell command assembly in the frontend",
        r"function\s+shQuote",
        "the frontend must not build shell commands",
    ),
]


def iter_files():
    for current, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDED_DIRS)
        for filename in sorted(filenames):
            if not filename.endswith(SCANNED_EXTENSIONS) and filename != "control.in":
                continue
            path = os.path.join(current, filename)
            yield os.path.relpath(path, ROOT), path


def main():
    findings = []
    scanned = 0

    for relative, path in iter_files():
        if relative in GUARD_FILES:
            continue
        try:
            with io.open(path, encoding="utf-8", errors="replace") as handle:
                lines = handle.read().split("\n")
        except (IOError, OSError):
            continue
        scanned += 1
        for index, line in enumerate(lines, 1):
            for entry in RULES:
                if entry["regex"].search(line):
                    findings.append((entry["name"], relative, index, line.strip()[:100], entry["explanation"]))

    for entry in RULES:
        matched = [f for f in findings if f[0] == entry["name"]]
        if matched:
            print("FAIL - no " + entry["name"])
            for _, relative, index, text, explanation in matched:
                print("       %s:%d: %s" % (relative, index, text))
                print("       reason: " + explanation)
        else:
            print("ok   - no " + entry["name"])

    builder_source = open(os.path.join(ROOT, "build_ipk.py"), encoding="utf-8").read()
    official_packaging = (
        "ares-package" in builder_source
        and "subprocess.run" in builder_source
        and "ar_member(" not in builder_source
        and "build_control_tar(" not in builder_source
        and not os.path.exists(os.path.join(ROOT, "CONTROL", "control.in"))
    )
    print(("ok   - " if official_packaging else "FAIL - ") + "builder delegates IPK creation to ares-package")

    # The sanitizer legitimately reads profile.link to derive a display label,
    # so inspect what it actually emits rather than the source text.
    sanitizer_ok = True
    store_module = os.path.join(ROOT, "app", "service", "lib", "store", "profiles.js")
    if os.path.isfile(store_module):
        import json
        import subprocess

        probe = (
            "var s=require(process.argv[1]);"
            "var p={id:'p1',name:'Node',protocol:'vless',country:'nl',"
            "link:'vless://SECRETUUID@h.example.com:443?pbk=SECRETKEY#Node',"
            "sourceType:'single',fullConfig:{outbounds:[{tag:'SECRETCFG'}]}};"
            "process.stdout.write(JSON.stringify(s.sanitizeProfile(p,'p1')));"
        )
        try:
            output = subprocess.check_output(
                ["node", "-e", probe, store_module.replace(os.sep, "/")],
                stderr=subprocess.STDOUT,
            ).decode("utf-8")
        except (subprocess.CalledProcessError, OSError) as error:
            output = ""
            sanitizer_ok = False
            print("FAIL - could not evaluate the sanitizer: %s" % error)

        for secret in ("SECRETUUID", "SECRETKEY", "SECRETCFG", "vless://"):
            if secret and secret in output:
                sanitizer_ok = False
                print("FAIL - sanitized profile leaks " + secret)
        if output:
            emitted = json.loads(output)
            for key in ("link", "uuid", "password", "fullConfig", "sourceKey"):
                if key in emitted:
                    sanitizer_ok = False
                    print("FAIL - sanitized profile exposes field " + key)
    print(("ok   - " if sanitizer_ok else "FAIL - ") + "sanitized profiles carry no secret fields")

    print("\nscanned %d files" % scanned)
    if findings or not official_packaging or not sanitizer_ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
