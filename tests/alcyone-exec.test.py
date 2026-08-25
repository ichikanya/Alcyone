import hashlib
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[1]
binary = ROOT / "build" / "cores" / "launcher" / "alcyone-exec"
source = (ROOT / "tools" / "alcyone-exec.c").read_text(encoding="utf-8")
provenance = json.loads((ROOT / "cores" / "provenance.json").read_text(encoding="utf-8"))
entry = next(item for item in provenance["components"] if item["name"] == "alcyone-exec")

assert binary.is_file(), "cross-built launcher is missing"
payload = binary.read_bytes()
assert payload[:4] == b"\x7fELF"
machine = struct.unpack("<H" if payload[5] == 1 else ">H", payload[18:20])[0]
assert machine == 40
assert len(payload) <= 65536
assert hashlib.sha256(payload).hexdigest() == entry["sha256"]
assert "PR_SET_PDEATHSIG" in source and "setrlimit(RLIMIT_NOFILE" in source
assert "execve(" in source and "system(" not in source
assert entry["toolchain"] == "zig 0.16.0"
print("ok - alcyone-exec ARM ELF, size, provenance and syscall contract")
