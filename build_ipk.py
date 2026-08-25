"""Build Alcyone IPKs with the official webOS ``ares-package`` tool.

The Python layer prepares the edition-specific app and Luna service trees,
verifies pinned native inputs, and hands those directories to ares-package.
It never creates or modifies an IPK control archive itself.
"""

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import struct
import subprocess
import tarfile
import tempfile
import pathlib


ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, "app")
SERVICE = os.path.join(APP, "service")
CORES = os.environ.get("ALCYONE_CORES_DIR", os.path.join(ROOT, "build", "cores"))
VERSION_FILE = os.path.join(ROOT, "VERSION")
VERSION = open(VERSION_FILE, "r", encoding="utf-8").read().strip() if os.path.exists(VERSION_FILE) else "4.2.1"
SOURCE_DATE_EPOCH = 1700000000

ELF_MACHINES = {
    40: ("arm", "ARM (32-bit)"),
    183: ("aarch64", "AArch64 (64-bit)"),
    3: ("i386", "x86"),
    62: ("x86_64", "x86-64"),
}

EDITIONS = {
    "xray": {
        "app_id": "com.alcyone.vpn",
        "service_id": "com.alcyone.vpn.service",
        "artifact": "Alcyone-XRay_%s.ipk",
        "autostart": "alcyone-vpn",
        "core": "xray",
        "core_label": "XRay",
        "core_version": "26.3.27",
        "data_dir": "/var/lib/alcyone",
        "description": "Alcyone XRay VPN client for rooted LG webOS TVs.",
        "edition_name": "XRay Edition",
        "title": "Alcyone XRay",
        "web_port": 8080,
        "binaries": {
            "bin/alcyone-exec": os.path.join(CORES, "launcher", "alcyone-exec"),
            "bin/xray": os.path.join(CORES, "xray", "xray"),
            "bin/tun2socks": os.path.join(CORES, "tun2socks", "tun2socks"),
            "bin/alcyone-netguard": os.path.join(CORES, "netguard", "alcyone-netguard"),
        },
        "assets": {
            "bin/geosite.dat": os.path.join(CORES, "xray", "geosite.dat"),
            "bin/geoip.dat": os.path.join(CORES, "xray", "geoip.dat"),
        },
    },
    "sing-box": {
        "app_id": "com.alcyone.vpn.singbox",
        "service_id": "com.alcyone.vpn.singbox.service",
        "artifact": "Alcyone-sing-box_%s.ipk",
        "autostart": "alcyone-singbox-vpn",
        "core": "sing-box",
        "core_label": "sing-box",
        "core_version": "1.13.14",
        "data_dir": "/var/lib/alcyone-singbox",
        "description": "Alcyone sing-box VPN client for rooted LG webOS TVs.",
        "edition_name": "sing-box Edition",
        "title": "Alcyone sing-box",
        "web_port": 8081,
        "binaries": {
            "bin/alcyone-exec": os.path.join(CORES, "launcher", "alcyone-exec"),
            "bin/sing-box": os.path.join(CORES, "sing-box", "sing-box"),
        },
        "assets": {},
    },
}


DATA_PLANE = "native-tun"


def read(path):
    with open(path, "rb") as handle:
        return handle.read()


def write(path, data, mode=0o644):
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    with open(path, "wb") as handle:
        handle.write(data)
    os.chmod(path, mode)


def json_bytes(value, compact=False):
    if compact:
        text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    else:
        text = json.dumps(value, ensure_ascii=False, indent=2)
    return (text + "\n").encode("utf-8")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def elf_machine(path):
    with open(path, "rb") as handle:
        header = handle.read(20)
    if len(header) < 20 or header[:4] != b"\x7fELF":
        return None
    little_endian = header[5] == 1
    machine = struct.unpack("<H" if little_endian else ">H", header[18:20])[0]
    return ELF_MACHINES.get(machine, ("unknown", "unknown machine %d" % machine))


def provenance_digests():
    manifest = json.loads(read(os.path.join(ROOT, "cores", "provenance.json")).decode("utf-8"))
    entries = manifest["components"] + manifest.get("assets", [])
    return {os.path.basename(entry["path"]): entry["sha256"] for entry in entries}


def verify_inputs(edition):
    pinned = provenance_digests()
    architectures = set()
    for source in sorted(list(edition["binaries"].values()) + list(edition["assets"].values())):
        if not os.path.isfile(source):
            raise SystemExit("missing build input: " + source)
        name = os.path.basename(source)
        if name not in pinned:
            raise SystemExit("no provenance entry for build input: " + name)
        actual = sha256_file(source)
        if actual != pinned[name]:
            raise SystemExit(
                "checksum mismatch for %s: provenance records %s, payload is %s. "
                "Rebuild with tools/build-cores.sh." % (source, pinned[name], actual)
            )
    for source in sorted(edition["binaries"].values()):
        machine = elf_machine(source)
        if machine is None:
            raise SystemExit("bundled core is not an ELF executable: " + source)
        architectures.add(machine[0])
    if len(architectures) != 1:
        raise SystemExit("mixed or missing native architectures: " + ", ".join(sorted(architectures)))
    return architectures.pop()


def edition_js(edition):
    config = {
        "appId": edition["app_id"],
        "serviceId": edition["service_id"],
        "core": edition["core"],
        "coreLabel": edition["core_label"],
        "editionName": edition["edition_name"],
        "title": edition["title"],
        "version": VERSION,
        "dataPlane": DATA_PLANE,
    }
    return ("window.ALCYONE_EDITION = " + json.dumps(config, ensure_ascii=False, separators=(",", ":")) + ";\n").encode("utf-8")


def edition_json(edition):
    return json_bytes({
        "id": edition["core"],
        "appId": edition["app_id"],
        "serviceId": edition["service_id"],
        "core": edition["core"],
        "coreLabel": edition["core_label"],
        "editionName": edition["edition_name"],
        "title": edition["title"],
        "version": VERSION,
        "dataDir": edition["data_dir"],
        "autostartName": edition["autostart"],
        "webPort": edition["web_port"],
        "dataPlane": DATA_PLANE,
    })


def service_roles(edition):
    return json_bytes({
        "exeName": "/usr/bin/node",
        "type": "regular",
        "allowedNames": [edition["service_id"]],
        "permissions": [{
            "service": edition["service_id"],
            "inbound": [
                edition["app_id"],
                "com.webos.service.activitymanager",
                "com.palm.activitymanager",
            ],
            "outbound": [
                "com.webos.service.activitymanager",
                "com.palm.activitymanager",
                "com.webos.service.connectionmanager",
                "com.palm.connectionmanager",
                "com.webos.service.systemservice",
                "com.palm.systemservice",
            ],
        }],
    })


def prepare_staging(edition, staging_root):
    app_dir = os.path.join(staging_root, "app")
    service_dir = os.path.join(staging_root, "service")
    shutil.copytree(APP, app_dir, ignore=shutil.ignore_patterns("service"))
    shutil.copytree(SERVICE, service_dir)

    appinfo = json.loads(read(os.path.join(APP, "appinfo.json")).decode("utf-8"))
    appinfo.update({
        "id": edition["app_id"],
        "version": VERSION,
        "title": edition["title"],
        "appDescription": edition["description"],
    })
    write(os.path.join(app_dir, "appinfo.json"), json_bytes(appinfo))
    write(os.path.join(app_dir, "edition.js"), edition_js(edition))
    binary_note = "Alcyone %s %s bundles %s %s for Linux ARMv7. Provenance and checksums are recorded in cores/provenance.json.\n" % (
        VERSION, edition["edition_name"], edition["core_label"], edition["core_version"]
    )
    write(os.path.join(app_dir, "bin", "README.txt"), binary_note.encode("utf-8"))

    for relative, source in sorted(edition["binaries"].items()):
        write(os.path.join(app_dir, *relative.split("/")), read(source), 0o755)
    for relative, source in sorted(edition["assets"].items()):
        write(os.path.join(app_dir, *relative.split("/")), read(source))

    # package.properties is an official ares-package input. It records the
    # intended executable modes even on hosts whose filesystem cannot express
    # POSIX execute bits; Linux release builds also preserve the chmod above.
    executable_names = ",".join(sorted(os.path.basename(path) for path in edition["binaries"]))
    write(os.path.join(app_dir, "package.properties"), ("filemode.755=" + executable_names + "\n").encode("ascii"))

    service_package = {
        "name": edition["service_id"],
        "version": VERSION,
        "description": "Alcyone VPN Luna service (%s)" % edition["edition_name"],
        "main": "service.js",
        "private": True,
    }
    services = json.loads(read(os.path.join(SERVICE, "services.json")).decode("utf-8"))
    services["id"] = edition["service_id"]
    for entry in services.get("services", []):
        entry["name"] = edition["service_id"]
    roles = service_roles(edition)
    write(os.path.join(service_dir, "package.json"), json_bytes(service_package))
    write(os.path.join(service_dir, "services.json"), json_bytes(services))
    write(os.path.join(service_dir, "roles.json"), roles)
    write(os.path.join(service_dir, "role.json"), roles)
    write(os.path.join(service_dir, "edition.json"), edition_json(edition))
    write(os.path.join(service_dir, "countries.js"), read(os.path.join(APP, "countries.js")))

    for current, dirnames, filenames in os.walk(staging_root):
        for name in dirnames + filenames:
            path = os.path.join(current, name)
            try:
                os.utime(path, (SOURCE_DATE_EPOCH, SOURCE_DATE_EPOCH))
            except OSError:
                pass
    return app_dir, service_dir


def find_ares_package(explicit=None):
    candidates = [explicit, os.environ.get("ARES_PACKAGE")]
    local_bin = os.path.join(ROOT, "node_modules", ".bin")
    local_names = ["ares-package.cmd", "ares-package"] if os.name == "nt" else ["ares-package", "ares-package.cmd"]
    candidates.extend([os.path.join(local_bin, name) for name in local_names])
    candidates.append(shutil.which("ares-package"))
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return os.path.abspath(candidate)
    raise SystemExit("official ares-package not found; run `npm ci` in the repository root")


def run_ares_package(executable, app_dir, service_dir, output_dir):
    command = [executable, app_dir, service_dir, "--outdir", output_dir]
    if os.name == "nt" and executable.lower().endswith((".cmd", ".bat")):
        command = [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/s", "/c"] + command
    subprocess.run(command, cwd=ROOT, check=True)


def read_ar(path):
    payload = read(path)
    if not payload.startswith(b"!<arch>\n"):
        raise SystemExit("ares-package output has invalid ar magic: " + path)
    members = {}
    offset = 8
    while offset < len(payload):
        header = payload[offset:offset + 60]
        if len(header) != 60 or header[58:60] != b"`\n":
            raise SystemExit("ares-package output has an invalid ar member header")
        name = header[:16].decode("ascii").strip().rstrip("/")
        size = int(header[48:58].decode("ascii").strip())
        offset += 60
        members[name] = payload[offset:offset + size]
        offset += size + (size % 2)
    return members


def control_metadata(path):
    members = read_ar(path)
    if "control.tar.gz" not in members:
        raise SystemExit("ares-package output is missing control.tar.gz")
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(members["control.tar.gz"])), mode="r:") as archive:
        control_member = next((member for member in archive.getmembers() if member.name.lstrip("./") == "control"), None)
        if control_member is None:
            raise SystemExit("ares-package output is missing control metadata")
        text = archive.extractfile(control_member).read().decode("utf-8")
    metadata = {}
    for line in text.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            metadata[key] = value.strip()
    return metadata, text


def verify_official_metadata(path, edition):
    metadata, text = control_metadata(path)
    required = ("Installed-Size", "webOS-Package-Format-Version", "webOS-Packager-Version")
    missing = [field for field in required if not metadata.get(field)]
    if missing:
        raise SystemExit("ares-package control metadata is missing: " + ", ".join(missing))
    if metadata.get("Package") != edition["app_id"]:
        raise SystemExit("unexpected Package field in ares-package output")
    if metadata.get("Version") != VERSION:
        raise SystemExit("unexpected Version field in ares-package output")
    if metadata["webOS-Package-Format-Version"] != "2":
        raise SystemExit("webOS-Package-Format-Version must be 2")
    try:
        if int(metadata["Installed-Size"]) <= 0:
            raise ValueError()
    except ValueError:
        raise SystemExit("Installed-Size must be a positive integer")
    print("verified official control metadata:\n" + text.rstrip())


def build_edition(name, output_dir, ares_package, label=""):
    edition = EDITIONS[name]
    payload_arch = verify_inputs(edition)
    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)
    with tempfile.TemporaryDirectory(prefix=".tmp-alcyone-%s-" % name, dir=ROOT) as staging_root:
        app_dir, service_dir = prepare_staging(edition, staging_root)
        package_dir = os.path.join(staging_root, "dist")
        os.makedirs(package_dir)
        run_ares_package(ares_package, app_dir, service_dir, package_dir)
        candidates = [
            os.path.join(package_dir, filename)
            for filename in os.listdir(package_dir)
            if filename.endswith(".ipk")
        ]
        if len(candidates) != 1:
            raise SystemExit("ares-package produced %d IPKs; expected exactly one" % len(candidates))
        verify_official_metadata(candidates[0], edition)
        output_path = os.path.join(output_dir, edition["artifact"] % (VERSION + label))
        if os.path.exists(output_path):
            os.remove(output_path)
        shutil.move(candidates[0], output_path)
    print("built with official ares-package: %s (%d bytes, payload: %s)" % (
        os.path.abspath(output_path), os.path.getsize(output_path), payload_arch
    ))
    return output_path


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--edition", choices=("all", "xray", "sing-box"), default="all")
    parser.add_argument(
        "--data-plane",
        choices=("tun2socks", "native-tun"),
        default="native-tun",
        help="XRay data plane baked into the edition descriptor",
    )
    parser.add_argument(
        "--output-dir",
        # Shipping artifacts live in release-assets/ and are pinned by the
        # feed metadata; local builds must not overwrite them by accident
        # (audit 2026-08 finding). Pass --output-dir release-assets only
        # for an intentional, reviewed release rebuild.
        default=os.path.join(ROOT, "build", "dist"),
        help="directory for built IPKs (default: build/dist)",
    )
    parser.add_argument("--label", default="", help="filename-only suffix for an unpublished candidate")
    parser.add_argument("--ares-package", help="path to the official ares-package executable")
    return parser.parse_args()


def write_artifacts_manifest(output_dir, names, label):
    """Emit build/dist/artifacts.json describing every IPK of this run.

    Repeated invocations (one edition at a time) MERGE by file name, so
    a full two-edition release ends up with both entries. Feed hashes
    must come from real bytes; tools/release-metadata.py sync consumes
    this."""
    import datetime

    target = pathlib.Path(output_dir) / "artifacts.json"
    existing = {}
    if target.is_file():
        try:
            prior = json.loads(target.read_text(encoding="utf-8"))
            for item in prior.get("editions", []):
                existing[item["file"]] = item
        except (ValueError, OSError, KeyError):
            existing = {}
    suffix = ("_" + label) if label else ""
    pattern = re.compile(
        r"^Alcyone-(?P<edition>.+?)_%s%s\.ipk$"
        % (re.escape(VERSION), re.escape(suffix))
    )
    for path in sorted(pathlib.Path(output_dir).glob("Alcyone-*")):
        match = pattern.match(path.name)
        if not match:
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        existing[path.name] = {
            "edition": match.group("edition"),
            "file": path.name,
            "sha256": digest,
            "size": path.stat().st_size,
        }
    manifest = {
        "version": VERSION,
        "label": label,
        "generatedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "editions": [existing[key] for key in sorted(existing)],
    }
    target.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote %s (%d edition(s))" % (target, len(manifest["editions"])))


def main():
    global DATA_PLANE
    args = parse_args()
    DATA_PLANE = args.data_plane
    executable = find_ares_package(args.ares_package)
    label = re.sub(r"[^A-Za-z0-9._-]", "", args.label)
    names = ("xray", "sing-box") if args.edition == "all" else (args.edition,)
    output_dir = os.path.abspath(args.output_dir)
    for name in names:
        build_edition(name, output_dir, executable, label)
    write_artifacts_manifest(output_dir, names, label)


if __name__ == "__main__":
    main()
