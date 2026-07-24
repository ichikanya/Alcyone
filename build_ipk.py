"""Build reproducible Alcyone IPKs for the XRay and sing-box editions."""

import argparse
import io
import json
import os
import re
import struct
import zlib


ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, "app")
CONTROL = os.path.join(ROOT, "CONTROL")
CORES = os.path.join(ROOT, "cores")
VERSION = "3.2.0"
MTIME = 1700000000

EDITIONS = {
    "xray": {
        "app_id": "com.alcyone.vpn",
        "artifact": "Alcyone-XRay_%s_all.ipk" % VERSION,
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
            "bin/tun2socks": os.path.join(CORES, "xray", "tun2socks"),
        },
    },
    "sing-box": {
        "app_id": "com.alcyone.vpn.singbox",
        "artifact": "Alcyone-sing-box_%s_all.ipk" % VERSION,
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
    },
}


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
    trailer = struct.pack(
        "<II", zlib.crc32(raw) & 0xFFFFFFFF, len(raw) & 0xFFFFFFFF
    )
    return header + body + trailer


def read(path):
    with open(path, "rb") as handle:
        return handle.read()


def normalize_text(data):
    return data.replace(b"\r\n", b"\n")


def shell_quote(value):
    return "'" + str(value).replace("'", "'\\''") + "'"


def edition_js(edition):
    public_config = {
        "appId": edition["app_id"],
        "autostart": edition["autostart"],
        "core": edition["core"],
        "coreLabel": edition["core_label"],
        "dataDir": edition["data_dir"],
        "editionName": edition["edition_name"],
        "title": edition["title"],
        "version": VERSION,
        "webPort": edition["web_port"],
    }
    return (
        "window.ALCYONE_EDITION = "
        + json.dumps(public_config, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    ).encode("utf-8")


def edition_conf(edition):
    values = {
        "ALCYONE_APP_ID": edition["app_id"],
        "ALCYONE_AUTOSTART": edition["autostart"],
        "ALCYONE_CORE": edition["core"],
        "ALCYONE_CORE_LABEL": edition["core_label"],
        "ALCYONE_CORE_VERSION": edition["core_version"],
        "ALCYONE_DATA_DIR": edition["data_dir"],
        "ALCYONE_EDITION_NAME": edition["edition_name"],
        "ALCYONE_TITLE": edition["title"],
        "ALCYONE_VERSION": VERSION,
        "ALCYONE_WEB_PORT": edition["web_port"],
    }
    return "".join(
        "%s=%s\n" % (key, shell_quote(value)) for key, value in values.items()
    ).encode("utf-8")


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


def generated_binary_readme(edition):
    if edition["core"] == "xray":
        detail = (
            "Bundles Xray %s and tun2socks for Linux ARMv7. "
            "Persistent binaries use %s/bin."
            % (edition["core_version"], edition["data_dir"])
        )
    else:
        detail = (
            "Bundles sing-box %s for Linux ARMv7. The native TUN mode uses one "
            "core process for low memory use and fast startup. Persistent binaries "
            "use %s/bin."
            % (edition["core_version"], edition["data_dir"])
        )
    return ("Alcyone %s %s. %s\n" % (VERSION, edition["edition_name"], detail)).encode(
        "utf-8"
    )


def app_overrides(edition):
    overrides = {
        "appinfo.json": generated_appinfo(edition),
        "bin/README.txt": generated_binary_readme(edition),
        "edition.conf": edition_conf(edition),
        "edition.js": edition_js(edition),
    }
    for relative_path, source_path in edition["binaries"].items():
        if not os.path.isfile(source_path):
            raise SystemExit("missing core binary: " + source_path)
        overrides[relative_path] = read(source_path)
    return overrides


def app_entries(overrides):
    directories = set()
    files = {}
    for current, dirnames, filenames in os.walk(APP):
        dirnames.sort()
        filenames.sort()
        relative_dir = os.path.relpath(current, APP)
        if relative_dir == ".":
            relative_dir = ""
        for dirname in dirnames:
            relative = os.path.join(relative_dir, dirname).replace(os.sep, "/")
            directories.add(relative)
        for filename in filenames:
            relative = os.path.join(relative_dir, filename).replace(os.sep, "/")
            files[relative] = os.path.join(current, filename)
    for relative in overrides:
        parent = os.path.dirname(relative).replace(os.sep, "/")
        while parent:
            directories.add(parent)
            parent = os.path.dirname(parent).replace(os.sep, "/")
    return sorted(directories), files


def render_control_template(name, edition):
    replacements = {
        "@APP_ID@": edition["app_id"],
        "@AUTOSTART@": edition["autostart"],
        "@CORE@": edition["core"],
        "@DATA_DIR@": edition["data_dir"],
        "@DESCRIPTION@": edition["description"],
        "@VERSION@": VERSION,
    }
    text = read(os.path.join(CONTROL, name)).decode("utf-8")
    for token, value in replacements.items():
        text = text.replace(token, str(value))
    if re.search(r"@[A-Z_]+@", text):
        raise SystemExit("unresolved packaging token in %s" % name)
    return normalize_text(text.encode("utf-8"))


def build_control_tar(edition):
    buffer = io.BytesIO()
    tar_add_file(buffer, "control", render_control_template("control.in", edition), 0o644)
    for name in ("postinst", "preinst", "prerm"):
        tar_add_file(buffer, name, render_control_template(name, edition), 0o644)
    tar_finish(buffer)
    return buffer.getvalue()


def is_text_file(relative):
    return relative.endswith((".css", ".html", ".js", ".json", ".md", ".sh", ".svg", ".txt"))


def build_data_tar(edition):
    prefix = "usr/palm/applications/" + edition["app_id"]
    overrides = app_overrides(edition)
    directories, files = app_entries(overrides)
    executable_files = set(edition["binaries"])
    executable_files.add("scripts/alcyonectl.sh")
    buffer = io.BytesIO()
    for directory in ("usr", "usr/palm", "usr/palm/applications", prefix):
        tar_add_dir(buffer, directory)
    for relative in directories:
        tar_add_dir(buffer, prefix + "/" + relative)
    all_files = sorted(set(files) | set(overrides))
    for relative in all_files:
        data = overrides.get(relative)
        if data is None:
            data = read(files[relative])
        if is_text_file(relative):
            data = normalize_text(data)
        mode = 0o755 if relative in executable_files else 0o644
        tar_add_file(buffer, prefix + "/" + relative, data, mode)
    tar_finish(buffer)
    return buffer.getvalue()


def ar_member(name, data):
    header = (
        "%-16s%-12s%-6s%-6s%-8s%-10d`\n"
        % (name + "/", "0", "0", "0", "100644", len(data))
    ).encode("ascii")
    return header + data + (b"\n" if len(data) % 2 else b"")


def build_edition(name, output_dir):
    edition = EDITIONS[name]
    control_tar = gzip_bytes(build_control_tar(edition), "control.tar")
    data_tar = gzip_bytes(build_data_tar(edition), "data.tar")
    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)
    output_path = os.path.join(output_dir, edition["artifact"])
    with open(output_path, "wb") as handle:
        handle.write(b"!<arch>\n")
        handle.write(ar_member("debian-binary", b"2.0\n"))
        handle.write(ar_member("control.tar.gz", control_tar))
        handle.write(ar_member("data.tar.gz", data_tar))
    print(
        "built: %s (%d bytes, %s)"
        % (os.path.abspath(output_path), os.path.getsize(output_path), edition["edition_name"])
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
    return parser.parse_args()


def main():
    args = parse_args()
    names = ("xray", "sing-box") if args.edition == "all" else (args.edition,)
    for name in names:
        build_edition(name, os.path.abspath(args.output_dir))


if __name__ == "__main__":
    main()
