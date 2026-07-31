"""Build reproducible Alcyone IPKs for the XRay and sing-box editions.

Each IPK contains three components:

  usr/palm/applications/<appId>/        the TV web app
  usr/palm/services/<serviceId>/        the Luna service that owns privileged work
  usr/palm/packages/<appId>/            packageinfo.json listing both

The control archive holds only `control`. Debian-style maintainer scripts
(preinst/postinst/prerm) are deliberately absent: webOS does not execute them,
so all initialization, migration and cleanup lives in idempotent Luna service
startup code instead.

Architecture is derived from the ELF machine type of the bundled native cores
rather than hard-coded, and the builder refuses to mislabel a package.
"""

import argparse
import io
import hashlib
import json
import os
import re
import struct
import zlib


ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, "app")
SERVICE = os.path.join(APP, "service")
CONTROL = os.path.join(ROOT, "CONTROL")
CORES = os.environ.get("ALCYONE_CORES_DIR", os.path.join(ROOT, "build", "cores"))
VERSION = "4.0.3"
MTIME = 1700000000

# ELF e_machine values we know how to label.
ELF_MACHINES = {
    40: ("arm", "ARM (32-bit)"),
    183: ("aarch64", "AArch64 (64-bit)"),
    3: ("i386", "x86"),
    62: ("x86_64", "x86-64"),
}

# Files that must be executable inside the package.
EXECUTABLE_PATHS = frozenset(["bin/xray", "bin/tun2socks", "bin/sing-box"])

# Directories excluded from the app payload (the service is packaged separately).
APP_EXCLUDED_DIRS = frozenset(["service"])


EDITIONS = {
    "xray": {
        "app_id": "com.alcyone.vpn",
        "service_id": "com.alcyone.vpn.service",
        "artifact": "Alcyone-XRay_%s_%s.ipk",
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
            "bin/xray": os.path.join(CORES, "xray", "xray"),
            "bin/tun2socks": os.path.join(CORES, "tun2socks", "tun2socks"),
        },
        "assets": {
            "bin/geosite.dat": os.path.join(CORES, "xray", "geosite.dat"),
            "bin/geoip.dat": os.path.join(CORES, "xray", "geoip.dat"),
        },
    },
    "sing-box": {
        # Luna service names may not contain '-', so the service id uses
        # 'singbox' and must remain a prefix-match of the app id.
        "app_id": "com.alcyone.vpn.singbox",
        "service_id": "com.alcyone.vpn.singbox.service",
        "artifact": "Alcyone-sing-box_%s_%s.ipk",
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
            "bin/sing-box": os.path.join(CORES, "sing-box", "sing-box"),
        },
        "assets": {},
    },
}


def read(path):
    with open(path, "rb") as handle:
        return handle.read()


def elf_machine(path):
    """Return (arch_id, label) for an ELF file, or None when not an ELF."""
    with open(path, "rb") as handle:
        header = handle.read(20)
    if len(header) < 20 or header[:4] != b"\x7fELF":
        return None
    little_endian = header[5] == 1
    machine = struct.unpack("<H" if little_endian else ">H", header[18:20])[0]
    return ELF_MACHINES.get(machine, ("unknown", "unknown machine %d" % machine))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def provenance_digests():
    """Map each recorded native input path to its pinned sha256."""
    with open(os.path.join(ROOT, "cores", "provenance.json"), "rb") as handle:
        manifest = json.loads(handle.read().decode("utf-8"))
    entries = manifest["components"] + manifest.get("assets", [])
    return {
        os.path.basename(component["path"]): component["sha256"]
        for component in entries
    }


def verify_binaries(edition):
    """Refuse to package a native binary that is not the pinned artifact.

    tools/build-cores.sh verifies what it downloads or builds, but nothing
    guaranteed that the tree it left behind is what actually ships. Re-checking
    here means a stale, hand-edited or tampered build/cores can never reach a
    user's TV inside a signed-looking IPK.
    """
    pinned = provenance_digests()
    for relative, source in sorted(edition["binaries"].items()):
        if not os.path.isfile(source):
            raise SystemExit("missing core binary: " + source)
        name = os.path.basename(source)
        if name not in pinned:
            raise SystemExit("no provenance entry for bundled binary: " + name)
        actual = sha256_file(source)
        if actual != pinned[name]:
            raise SystemExit(
                "checksum mismatch for %s: provenance records %s, payload is %s. "
                "Rebuild with tools/build-cores.sh." % (source, pinned[name], actual)
            )


def verify_assets(edition):
    """Refuse missing, stale or tampered Xray routing data."""
    pinned = provenance_digests()
    for relative, source in sorted(edition["assets"].items()):
        if not os.path.isfile(source):
            raise SystemExit("missing Xray asset: " + source)
        name = os.path.basename(source)
        if name not in pinned:
            raise SystemExit("no provenance entry for bundled asset: " + name)
        actual = sha256_file(source)
        if actual != pinned[name]:
            raise SystemExit(
                "checksum mismatch for %s: provenance records %s, payload is %s. "
                "Rebuild with tools/build-cores.sh xray." % (source, pinned[name], actual)
            )


def edition_architecture(edition):
    """Derive the package architecture from the bundled native binaries.

    A package containing ARM ELF executables must not claim `all`, so the
    architecture is read from the payload instead of being asserted.
    """
    found = set()
    for relative, source in sorted(edition["binaries"].items()):
        if not os.path.isfile(source):
            raise SystemExit("missing core binary: " + source)
        machine = elf_machine(source)
        if machine is None:
            raise SystemExit("bundled core is not an ELF executable: " + relative)
        found.add(machine[0])
    if not found:
        return "all"
    if len(found) > 1:
        raise SystemExit("mixed architectures in one package: " + ", ".join(sorted(found)))
    return found.pop()


def tar_header(name, mode, size, typeflag):
    header = bytearray(512)
    encoded_name = name.encode("utf-8")
    if len(encoded_name) > 100:
        raise SystemExit("name too long: " + name)
    header[0 : len(encoded_name)] = encoded_name
    header[100:108] = b"%07o\x00" % mode
    header[108:116] = b"0000000\x00"
    header[116:124] = b"0000000\x00"
    header[124:136] = b"%011o\x00" % size
    header[136:148] = b"%011o\x00" % MTIME
    header[148:156] = b"        "
    header[156:157] = typeflag
    header[257:265] = b"ustar\x0000"
    header[265:269] = b"root"
    header[297:301] = b"root"
    header[148:156] = b"%06o\x00 " % sum(header)
    return bytes(header)


def tar_add_dir(buffer, name):
    buffer.write(tar_header(name.rstrip("/") + "/", 0o755, 0, b"5"))


def tar_add_file(buffer, name, data, mode):
    buffer.write(tar_header(name, mode, len(data), b"0"))
    buffer.write(data)
    buffer.write(b"\x00" * ((512 - len(data) % 512) % 512))


def tar_finish(buffer):
    buffer.write(b"\x00" * 1024)
    buffer.write(b"\x00" * ((10240 - buffer.tell() % 10240) % 10240))


def gzip_bytes(raw, filename):
    compressor = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
    body = compressor.compress(raw) + compressor.flush()
    header = (
        b"\x1f\x8b\x08\x08"
        + struct.pack("<I", 0)
        + b"\x02\xff"
        + filename.encode("ascii")
        + b"\x00"
    )
    trailer = struct.pack("<II", zlib.crc32(raw) & 0xFFFFFFFF, len(raw) & 0xFFFFFFFF)
    return header + body + trailer


def normalize_text(data):
    return data.replace(b"\r\n", b"\n")


def is_text_file(relative):
    return relative.endswith((".css", ".html", ".js", ".json", ".md", ".svg", ".txt", ".conf"))


def edition_js(edition):
    """Public, non-secret edition facts consumed by the TV frontend."""
    public_config = {
        "appId": edition["app_id"],
        "serviceId": edition["service_id"],
        "core": edition["core"],
        "coreLabel": edition["core_label"],
        "editionName": edition["edition_name"],
        "title": edition["title"],
        "version": VERSION,
    }
    return (
        "window.ALCYONE_EDITION = "
        + json.dumps(public_config, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    ).encode("utf-8")


def edition_json(edition):
    """Edition configuration read by the Luna service at startup."""
    config = {
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
    }
    return (json.dumps(config, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def generated_appinfo(edition):
    appinfo = json.loads(read(os.path.join(APP, "appinfo.json")).decode("utf-8"))
    appinfo.update(
        {
            "id": edition["app_id"],
            "version": VERSION,
            "title": edition["title"],
            "appDescription": edition["description"],
        }
    )
    return (json.dumps(appinfo, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def generated_service_package_json(edition):
    return (
        json.dumps(
            {
                "name": edition["service_id"],
                "version": VERSION,
                "description": "Alcyone VPN Luna service (%s)" % edition["edition_name"],
                "main": "service.js",
                "private": True,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    ).encode("utf-8")


def generated_services_json(edition):
    """services.json with this edition's service id substituted in."""
    template = json.loads(read(os.path.join(SERVICE, "services.json")).decode("utf-8"))
    template["id"] = edition["service_id"]
    for entry in template.get("services", []):
        entry["name"] = edition["service_id"]
    return (json.dumps(template, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def generated_service_roles_json(edition):
    """roles.json declaring LS2 bus permissions for this edition's service."""
    return (
        json.dumps(
            {
                "exeName": "/usr/bin/node",
                "type": "regular",
                "allowedNames": [edition["service_id"]],
                "permissions": [
                    {
                        "service": edition["service_id"],
                        "inbound": [edition["app_id"]],
                        "outbound": ["com.webos.service.activitymanager"],
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    ).encode("utf-8")


def generated_binary_readme(edition):
    if edition["core"] == "xray":
        detail = (
            "Bundles Xray %s and tun2socks for Linux ARMv7. Provenance and "
            "checksums are recorded in cores/provenance.json."
            % edition["core_version"]
        )
    else:
        detail = (
            "Bundles sing-box %s for Linux ARMv7. The native TUN mode uses one "
            "core process for low memory use and fast startup. Provenance and "
            "checksums are recorded in cores/provenance.json."
            % edition["core_version"]
        )
    return ("Alcyone %s %s. %s\n" % (VERSION, edition["edition_name"], detail)).encode("utf-8")


def app_overrides(edition):
    overrides = {
        "appinfo.json": generated_appinfo(edition),
        "bin/README.txt": generated_binary_readme(edition),
        "edition.js": edition_js(edition),
    }
    for relative_path, source_path in edition["binaries"].items():
        if not os.path.isfile(source_path):
            raise SystemExit("missing core binary: " + source_path)
        overrides[relative_path] = read(source_path)
    for relative_path, source_path in edition["assets"].items():
        if not os.path.isfile(source_path):
            raise SystemExit("missing Xray asset: " + source_path)
        overrides[relative_path] = read(source_path)
    return overrides


def walk_files(base, excluded_dirs=frozenset()):
    """Collect (directories, files) under `base`, deterministically ordered."""
    directories = set()
    files = {}
    for current, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if d not in excluded_dirs)
        filenames.sort()
        relative_dir = os.path.relpath(current, base)
        if relative_dir == ".":
            relative_dir = ""
        for dirname in dirnames:
            directories.add(os.path.join(relative_dir, dirname).replace(os.sep, "/"))
        for filename in filenames:
            relative = os.path.join(relative_dir, filename).replace(os.sep, "/")
            files[relative] = os.path.join(current, filename)
    return directories, files


def render_control(edition, architecture):
    replacements = {
        "@APP_ID@": edition["app_id"],
        "@VERSION@": VERSION,
        "@ARCH@": architecture,
        "@DESCRIPTION@": edition["description"],
    }
    text = read(os.path.join(CONTROL, "control.in")).decode("utf-8")
    for token, value in replacements.items():
        text = text.replace(token, str(value))
    if re.search(r"@[A-Z_]+@", text):
        raise SystemExit("unresolved packaging token in control.in")
    return normalize_text(text.encode("utf-8"))


def build_control_tar(edition, architecture):
    """Control archive holds `control` only: webOS ignores maintainer scripts."""
    buffer = io.BytesIO()
    tar_add_file(buffer, "control", render_control(edition, architecture), 0o644)
    tar_finish(buffer)
    return buffer.getvalue()


def build_data_tar(edition):
    app_prefix = "usr/palm/applications/" + edition["app_id"]
    service_prefix = "usr/palm/services/" + edition["service_id"]
    package_prefix = "usr/palm/packages/" + edition["app_id"]

    overrides = app_overrides(edition)
    app_dirs, app_files = walk_files(APP, APP_EXCLUDED_DIRS)
    service_dirs, service_files = walk_files(SERVICE)

    for relative in overrides:
        parent = os.path.dirname(relative).replace(os.sep, "/")
        while parent:
            app_dirs.add(parent)
            parent = os.path.dirname(parent).replace(os.sep, "/")

    buffer = io.BytesIO()
    for directory in (
        "usr",
        "usr/palm",
        "usr/palm/applications",
        app_prefix,
        "usr/palm/services",
        service_prefix,
        "usr/palm/packages",
        package_prefix,
    ):
        tar_add_dir(buffer, directory)

    for relative in sorted(app_dirs):
        tar_add_dir(buffer, app_prefix + "/" + relative)
    for relative in sorted(set(app_files) | set(overrides)):
        data = overrides.get(relative)
        if data is None:
            data = read(app_files[relative])
        if is_text_file(relative):
            data = normalize_text(data)
        mode = 0o755 if relative in EXECUTABLE_PATHS else 0o644
        tar_add_file(buffer, app_prefix + "/" + relative, data, mode)

    service_overrides = {
        "package.json": generated_service_package_json(edition),
        "services.json": generated_services_json(edition),
        "roles.json": generated_service_roles_json(edition),
        "role.json": generated_service_roles_json(edition),
        "edition.json": edition_json(edition),
        "countries.js": read(os.path.join(APP, "countries.js")),
    }
    for relative in sorted(service_dirs):
        tar_add_dir(buffer, service_prefix + "/" + relative)
    for relative in sorted(set(service_files) | set(service_overrides)):
        data = service_overrides.get(relative)
        if data is None:
            data = read(service_files[relative])
        if is_text_file(relative):
            data = normalize_text(data)
        tar_add_file(buffer, service_prefix + "/" + relative, data, 0o644)

    # The package manifest must list the service, or webOS will not register it.
    packageinfo = json.dumps(
        {
            "id": edition["app_id"],
            "app": edition["app_id"],
            "services": [edition["service_id"]],
            "version": VERSION,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8") + b"\n"
    tar_add_file(buffer, package_prefix + "/packageinfo.json", packageinfo, 0o644)

    tar_finish(buffer)
    return buffer.getvalue()


def ar_member(name, data):
    header = (
        "%-16s%-12s%-6s%-6s%-8s%-10d`\n" % (name + "/", "0", "0", "0", "100644", len(data))
    ).encode("ascii")
    return header + data + (b"\n" if len(data) % 2 else b"")


def build_edition(name, output_dir, label=""):
    edition = EDITIONS[name]
    verify_binaries(edition)
    verify_assets(edition)
    architecture = edition_architecture(edition)
    control_tar = gzip_bytes(build_control_tar(edition, architecture), "control.tar")
    data_tar = gzip_bytes(build_data_tar(edition), "data.tar")
    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)
    # A label distinguishes an unpublished candidate from the release it was
    # built from, without touching the package's declared version: webOS
    # requires appinfo.json's version to stay a numeric triplet, so the label
    # belongs in the filename and nowhere else.
    output_path = os.path.join(
        output_dir, edition["artifact"] % (VERSION + label, architecture)
    )
    with open(output_path, "wb") as handle:
        handle.write(b"!<arch>\n")
        handle.write(ar_member("debian-binary", b"2.0\n"))
        handle.write(ar_member("control.tar.gz", control_tar))
        handle.write(ar_member("data.tar.gz", data_tar))
    print(
        "built: %s (%d bytes, %s, Architecture: %s)"
        % (
            os.path.abspath(output_path),
            os.path.getsize(output_path),
            edition["edition_name"],
            architecture,
        )
    )
    return output_path


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--edition",
        choices=("all", "xray", "sing-box"),
        default="all",
        help="edition to build (default: all)",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(ROOT, "release-assets"),
        help="directory for generated IPKs",
    )
    parser.add_argument(
        "--label",
        default="",
        help="filename-only suffix marking an unpublished candidate build",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    names = ("xray", "sing-box") if args.edition == "all" else (args.edition,)
    label = re.sub(r"[^A-Za-z0-9._-]", "", args.label)
    for name in names:
        build_edition(name, os.path.abspath(args.output_dir), label)


if __name__ == "__main__":
    main()
