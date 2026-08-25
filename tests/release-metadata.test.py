"""Release metadata guard: feed files must never drift from shipped IPKs.

Runs tools/release-metadata.py check against the real repository state.
This is the guard for the audit finding where repository.json silently
disagreed with the shipping IPK hashes and sizes.
"""

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

result = subprocess.run(
    [sys.executable, str(ROOT / "tools" / "release-metadata.py"), "check"],
    capture_output=True,
    text=True,
)
sys.stdout.write(result.stdout)
sys.stderr.write(result.stderr)
assert result.returncode == 0, "release metadata is inconsistent"

# The checker must actually fail on a corrupted feed: prove it is a real
# guard, not a no-op that always prints ok.
import json  # noqa: E402

repo_json_path = ROOT / "repository.json"
original = repo_json_path.read_text(encoding="utf-8")
try:
    data = json.loads(original)
    target = data["packages"][0]["manifest"]
    target["ipkSize"] = target["ipkSize"] + 1
    repo_json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tampered = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "release-metadata.py"), "check"],
        capture_output=True,
        text=True,
    )
    assert tampered.returncode != 0, "checker accepted a tampered repository.json"
finally:
    repo_json_path.write_text(original, encoding="utf-8")

print("ok - release metadata guard passes and rejects tampering")
