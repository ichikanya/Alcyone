#!/usr/bin/env python3
"""Release metadata: single source of truth checks and feed synchronization.

    python tools/release-metadata.py check
    python tools/release-metadata.py sync --version 4.2.2 [--ipk-dir DIR]

`check` verifies two independent groups and one relation between them:

  SOURCE group: VERSION, app/service/edition.json, app/appinfo.json and
  package.json must declare the same version.

  FEED group: r.json, repository.json, the two com.alcyone.*.manifest.json
  files, SHA256SUMS.txt and the actual IPKs in release-assets/ must agree
  on version, sha256 and size for both editions.

  Relation: feed_version <= source_version. A source version ahead of the
  feed means "release pending"; the opposite direction is always a bug.

This exists because repository.json silently drifted from the shipping
IPKs once already (audit 2026-08). Never edit feed hashes by hand: run
`sync` after a real build instead.
"""

import argparse
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

EDITIONS = [
    {"key": "xray", "id": "com.alcyone.vpn", "file": "Alcyone-XRay_{v}.ipk"},
    {
        "key": "sing-box",
        "id": "com.alcyone.vpn.singbox",
        "file": "Alcyone-sing-box_{v}.ipk",
    },
]

SOURCE_FILES = [
    ROOT / "VERSION",
    ROOT / "app" / "service" / "edition.json",
    ROOT / "app" / "appinfo.json",
    ROOT / "package.json",
]


def read_json(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def semver_tuple(version):
    parts = []
    for piece in str(version).split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits or 0))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def source_version(errors):
    versions = {}
    for path in SOURCE_FILES:
        data = read_json(path) if path.suffix == ".json" else None
        versions[str(path)] = (
            data.get("version") if isinstance(data, dict) else path.read_text(encoding="utf-8").strip()
        )
    distinct = sorted(set(versions.values()))
    if len(distinct) != 1:
        errors.append(
            "source versions disagree: "
            + "; ".join(f"{path}={value}" for path, value in versions.items())
        )
        return None
    return distinct[0]


def feed_facts(ipk_dir, artifact_version=None):
    facts = {}
    rjson = read_json(ROOT / "r.json")
    repojson = read_json(ROOT / "repository.json")
    sums_text = (ROOT / "SHA256SUMS.txt").read_text(encoding="utf-8")
    sums = {}
    for line in sums_text.splitlines():
        if line.strip():
            digest, name = line.split(None, 1)
            sums[name.strip().lstrip("*")] = digest.strip().lower()

    by_id = {pkg.get("id"): pkg for pkg in repojson.get("packages", [])}
    for edition in EDITIONS:
        manifest_name = (
            "com.alcyone.vpn.singbox.manifest.json"
            if edition["key"] == "sing-box"
            else "com.alcyone.vpn.manifest.json"
        )
        manifest = read_json(ROOT / manifest_name)
        entry = {}
        entry["manifest"] = manifest
        # During `sync`, manifests still describe the previous release. The
        # requested version must select the new artifacts; otherwise a version
        # bump silently signs the new feed with hashes from the old IPKs.
        declared_version = str(artifact_version or manifest.get("version"))
        expected_name = edition["file"].format(v=declared_version)
        entry["r"] = next(
            (p for p in rjson.get("packages", []) if p.get("id") == edition["id"]),
            {},
        ).get("manifest", {})
        entry["repo"] = (by_id.get(edition["id"], {}).get("manifest", {}))
        entry["sums_hash"] = sums.get(expected_name)
        ipk = pathlib.Path(ipk_dir) / expected_name
        entry["ipk_path"] = ipk
        entry["ipk_exists"] = ipk.is_file()
        if entry["ipk_exists"]:
            entry["ipk_hash"] = sha256_of(ipk)
            entry["ipk_size"] = ipk.stat().st_size
        facts[edition["key"]] = entry
    return facts


def check_feed_consistency(facts, errors):
    for key, entry in facts.items():
        where = f"[{key}]"
        sources = (
            ("manifest", entry["manifest"]),
            ("r.json", entry["r"]),
            ("repository.json", entry["repo"]),
        )
        versions = {name: obj.get("version") for name, obj in sources}
        hashes = {name: (obj.get("ipkHash") or {}).get("sha256", "").lower() for name, obj in sources}
        sizes = {name: obj.get("ipkSize") for name, obj in sources}
        if len(set(versions.values())) != 1:
            errors.append(f"{where} versions disagree: {versions}")
        if len(set(hashes.values())) != 1:
            errors.append(f"{where} sha256 disagree: {hashes}")
        if len(set(sizes.values())) != 1:
            errors.append(f"{where} sizes disagree: {sizes}")
        declared_hash = hashes["manifest"]
        declared_version = versions["manifest"]
        declared_size = sizes["manifest"]
        url = str(entry["manifest"].get("ipkUrl", ""))
        if f"v{declared_version}/" not in url:
            errors.append(f"{where} ipkUrl does not match version: {url}")
        if not declared_hash:
            errors.append(f"{where} manifest has no ipkHash")
        if entry["sums_hash"] is None:
            errors.append(f"{where} SHA256SUMS.txt lacks an entry for {entry['ipk_path'].name}")
        elif entry["sums_hash"] != declared_hash:
            errors.append(f"{where} SHA256SUMS.txt hash differs from manifests")
        if entry["ipk_exists"]:
            if entry["ipk_hash"] != declared_hash:
                errors.append(
                    f"{where} shipped IPK hash {entry['ipk_hash'][:12]}… != declared {declared_hash[:12]}…"
                )
            if entry["ipk_size"] != declared_size:
                errors.append(
                    f"{where} shipped IPK size {entry['ipk_size']} != declared {declared_size}"
                )
        else:
            print(f"note - {where} IPK {entry['ipk_path'].name} not present yet; hash consistency checked across feeds only")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="verify release metadata consistency")
    sync = commands.add_parser("sync", help="rewrite feed files from built IPKs")
    sync.add_argument("--version", required=True)
    sync.add_argument("--ipk-dir", default=str(ROOT / "release-assets"))
    args = parser.parse_args()

    if args.command == "check":
        errors = []
        source = source_version(errors)
        facts = feed_facts(ROOT / "release-assets")
        check_feed_consistency(facts, errors)
        feed_versions = {
            entry["manifest"].get("version") for entry in facts.values()
        }
        if len(feed_versions) != 1:
            errors.append(f"feed versions disagree across editions: {feed_versions}")
        elif source is not None:
            if semver_tuple(list(feed_versions)[0]) > semver_tuple(source):
                errors.append(
                    f"feed version {list(feed_versions)[0]} is newer than source version {source}"
                )
        if errors:
            for error in errors:
                print(f"FAIL - {error}")
            sys.exit(1)
        print(
            f"ok - release metadata consistent (source {source}, feed {list(feed_versions)[0]})"
        )
        return

    if args.command == "sync":
        version = args.version
        facts = feed_facts(pathlib.Path(args.ipk_dir), version)
        errors = []
        for key, entry in facts.items():
            if not entry["ipk_exists"]:
                errors.append(f"missing built IPK: {entry['ipk_path']}")
                continue
            entry["declared_hash"] = entry["ipk_hash"]
            entry["declared_size"] = entry["ipk_size"]
        if errors:
            for error in errors:
                print(f"FAIL - {error}")
            sys.exit(1)

        base_url = "https://github.com/ichikanya/Alcyone/releases/download/v{v}/{f}"
        sums_lines = []
        for edition in EDITIONS:
            entry = facts[edition["key"]]
            manifest_path = (
                ROOT / "com.alcyone.vpn.singbox.manifest.json"
                if edition["key"] == "sing-box"
                else ROOT / "com.alcyone.vpn.manifest.json"
            )
            manifest = read_json(manifest_path)
            manifest["version"] = version
            manifest["ipkUrl"] = base_url.format(v=version, f=edition["file"].format(v=version))
            manifest["ipkHash"] = {"sha256": entry["ipk_hash"]}
            manifest["ipkSize"] = entry["ipk_size"]
            manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

            for feed_name in ("r.json", "repository.json"):
                feed_path = ROOT / feed_name
                feed = read_json(feed_path)
                target = next(
                    (p for p in feed.get("packages", []) if p.get("id") == edition["id"]),
                    None,
                )
                if target is None:
                    errors.append(f"{feed_name} has no package id {edition['id']}")
                    continue
                inner = target.setdefault("manifest", {})
                inner["version"] = version
                inner["ipkUrl"] = manifest["ipkUrl"]
                inner["ipkHash"] = {"sha256": entry["ipk_hash"]}
                inner["ipkSize"] = entry["ipk_size"]
                feed_path.write_text(json.dumps(feed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

            sums_lines.append(
                f"{entry['ipk_hash']}  {edition['file'].format(v=version)}"
            )
        if errors:
            for error in errors:
                print(f"FAIL - {error}")
            sys.exit(1)
        (ROOT / "SHA256SUMS.txt").write_text("\n".join(sums_lines) + "\n", encoding="utf-8")
        print(f"ok - feed metadata synced to {version}; review the diff, then tag and upload the IPKs")


if __name__ == "__main__":
    main()
