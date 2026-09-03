"""Release metadata guard: feed files must never drift from shipped IPKs.

Runs tools/release-metadata.py check against the real repository state.
This is the guard for the audit finding where repository.json silently
disagreed with the shipping IPK hashes and sizes.
"""

import pathlib
import subprocess
import sys
import hashlib
import importlib.util
import tempfile

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

# A release bump must select artifacts by the requested version, not by the
# still-old version in the manifests that `sync` is about to replace.
spec = importlib.util.spec_from_file_location(
    "release_metadata", ROOT / "tools" / "release-metadata.py"
)
release_metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_metadata)
with tempfile.TemporaryDirectory() as temp_dir:
    artifact_dir = pathlib.Path(temp_dir)
    payloads = {"xray": b"new-xray", "sing-box": b"new-sing-box"}
    for edition in release_metadata.EDITIONS:
        path = artifact_dir / edition["file"].format(v="9.9.9")
        path.write_bytes(payloads[edition["key"]])
    facts = release_metadata.feed_facts(artifact_dir, "9.9.9")
    for key, payload in payloads.items():
        assert facts[key]["ipk_exists"], f"sync did not select new {key} artifact"
        assert facts[key]["ipk_hash"] == hashlib.sha256(payload).hexdigest()

print("ok - release metadata guard passes, rejects tampering, and selects bumped artifacts")
