"""Source contract for tools/alcyone-netguard.c.

The guardian is the last line of defense for ordinary internet, so its
implementation is pinned to a minimal, shell-free rtnetlink contract.
Optionally runs `cc -fsyntax-only` when a compiler exists on PATH.
"""

import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
source = (ROOT / "tools" / "alcyone-netguard.c").read_text(encoding="utf-8")

required = [
    "RTM_DELRULE",       # activation rule removal (policy backend)
    "RTM_DELROUTE",      # owned split/unreachable route removal
    "RTM_DELLINK",       # TUN interface removal
    "FRA_PRIORITY",      # rule matching by pref
    "FRA_TABLE",         # rule matching by table
    "RTA_OIF",           # route scoped to the owned device
    "SIOCGIFINDEX",      # ifindex resolution without shelling out
    "oom_score_adj",     # best-effort OOM protection
    "futimens",          # heartbeat acknowledgement
    "nanosleep",         # bounded polling loop
    '--lease',           # lease argument contract
    "--check",           # dry-run/validation mode
    ".fired",            # post-mortem marker file
    "FAILOPEN_AT",
]

for token in required:
    assert token in source, f"netguard source missing contract token: {token}"

for forbidden in ["system(", "popen(", "execvp(", "execl", "fork("]:
    assert forbidden not in source, f"netguard must not spawn processes: {forbidden}"

cc = shutil.which("gcc") or shutil.which("clang") or shutil.which("cc")
if cc and sys.platform.startswith("linux"):
    result = subprocess.run(
        [cc, "-fsyntax-only", "-Wall", str(ROOT / "tools" / "alcyone-netguard.c")],
        capture_output=True,
    )
    assert result.returncode == 0, f"syntax check failed: {result.stderr.decode()[:800]}"
    print("ok - netguard compiles cleanly (-fsyntax-only)")
else:
    print("ok - netguard source contract (compiler not available on this host)")

# When the cross-built ELF exists, pin it exactly like alcyone-exec:
# ARMv7, bounded size, and byte-identical to the provenance entry.
binary = ROOT / "build" / "cores" / "netguard" / "alcyone-netguard"
if binary.is_file():
    import hashlib
    import json
    import struct

    payload = binary.read_bytes()
    provenance = json.loads((ROOT / "cores" / "provenance.json").read_text(encoding="utf-8"))
    entry = next(
        item for item in provenance["components"] if item["name"] == "alcyone-netguard"
    )
    assert payload[:4] == b"\x7fELF", "netguard is not an ELF"
    machine = struct.unpack("<H" if payload[5] == 1 else ">H", payload[18:20])[0]
    assert machine == 40, f"netguard must be ARM (40), got {machine}"
    assert len(payload) <= 131072, "netguard exceeds the 128 KiB ceiling"
    assert hashlib.sha256(payload).hexdigest() == entry["sha256"], (
        "netguard ELF does not match provenance sha256"
    )
    assert entry["toolchain"] == "zig 0.16.0"
    print("ok - netguard ARM ELF matches provenance pin")
else:
    print("note - build/cores/netguard/alcyone-netguard not built on this host")

print("ok - netguard keeps the no-shell rtnetlink fail-open contract")
