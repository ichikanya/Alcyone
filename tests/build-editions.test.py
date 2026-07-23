"""Verify independent, reproducible XRay and sing-box IPK builds."""

import gzip
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILDER = os.path.join(ROOT, "build_ipk.py")
VERSION = "3.2.0"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_ar(path):
    with open(path, "rb") as handle:
        payload = handle.read()
    assert payload.startswith(b"!<arch>\n"), "invalid ar magic"
    members = {}
    offset = 8
    while offset < len(payload):
        header = payload[offset : offset + 60]
        assert len(header) == 60 and header[58:60] == b"`\n", "invalid ar header"
        name = header[:16].decode("ascii").strip().rstrip("/")
        size = int(header[48:58].decode("ascii").strip())
        offset += 60
        members[name] = payload[offset : offset + size]
        offset += size + (size % 2)
    return payload, members


def read_tar_members(compressed):
    raw = gzip.decompress(compressed)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        result = {}
        modes = {}
        for member in archive.getmembers():
            if member.isfile():
                result[member.name] = archive.extractfile(member).read()
                modes[member.name] = member.mode
        return result, modes


def build(output_dir, edition):
    subprocess.run(
        [sys.executable, BUILDER, "--edition", edition, "--output-dir", output_dir],
        cwd=ROOT,
        check=True,
    )


def verify(path, expected):
    payload, ar_members = read_ar(path)
    assert set(ar_members) == {"debian-binary", "control.tar.gz", "data.tar.gz"}
    assert ar_members["debian-binary"] == b"2.0\n"
    control, control_modes = read_tar_members(ar_members["control.tar.gz"])
    data, data_modes = read_tar_members(ar_members["data.tar.gz"])

    control_text = control["control"].decode("utf-8")
    assert "Package: %s\n" % expected["app_id"] in control_text
    assert "Version: %s\n" % VERSION in control_text
    assert b"@" not in control["postinst"], "packaging tokens must be fully rendered"
    assert control_modes["control"] == 0o644

    prefix = "usr/palm/applications/" + expected["app_id"] + "/"
    appinfo = json.loads(data[prefix + "appinfo.json"].decode("utf-8"))
    assert appinfo["id"] == expected["app_id"]
    assert appinfo["version"] == VERSION
    assert appinfo["title"] == expected["title"]
    edition = data[prefix + "edition.js"].decode("utf-8")
    assert expected["core"] in edition
    assert expected["data_dir"] in edition
    assert data_modes[prefix + "scripts/alcyonectl.sh"] == 0o755

    if expected["core"] == "xray":
        assert prefix + "bin/xray" in data
        assert prefix + "bin/tun2socks" in data
        assert prefix + "bin/sing-box" not in data
        assert sha256(data[prefix + "bin/xray"]) == "b7ea2a82185f0f7a59510b01b24a93cc3c45529dabbf3c97970ad66c49c6b882"
        assert data_modes[prefix + "bin/xray"] == 0o755
    else:
        assert prefix + "bin/sing-box" in data
        assert prefix + "bin/xray" not in data
        assert prefix + "bin/tun2socks" not in data
        assert sha256(data[prefix + "bin/sing-box"]) == "900c9e01b628a59c39af5705b389bff0de3a4c2fc66a1f0f5951fe3f11f5f664"
        assert data_modes[prefix + "bin/sing-box"] == 0o755

    return sha256(payload)


def main():
    expected = {
        "xray": {
            "app_id": "com.alcyone.vpn",
            "title": "Alcyone XRay",
            "core": "xray",
            "data_dir": "/var/lib/alcyone",
            "artifact": "Alcyone-XRay_%s_all.ipk" % VERSION,
        },
        "sing-box": {
            "app_id": "com.alcyone.vpn.singbox",
            "title": "Alcyone sing-box",
            "core": "sing-box",
            "data_dir": "/var/lib/alcyone-singbox",
            "artifact": "Alcyone-sing-box_%s_all.ipk" % VERSION,
        },
    }
    with tempfile.TemporaryDirectory(prefix="alcyone-build-test-") as output_dir:
        build(output_dir, "xray")
        assert os.listdir(output_dir) == [expected["xray"]["artifact"]]
        xray_path = os.path.join(output_dir, expected["xray"]["artifact"])
        first_xray_hash = verify(xray_path, expected["xray"])

        build(output_dir, "sing-box")
        singbox_path = os.path.join(output_dir, expected["sing-box"]["artifact"])
        first_singbox_hash = verify(singbox_path, expected["sing-box"])

        os.remove(xray_path)
        build(output_dir, "xray")
        assert verify(xray_path, expected["xray"]) == first_xray_hash, "XRay builds must be reproducible"

        os.remove(singbox_path)
        build(output_dir, "sing-box")
        assert verify(singbox_path, expected["sing-box"]) == first_singbox_hash, "sing-box builds must be reproducible"

    print("independent edition build tests passed")


if __name__ == "__main__":
    main()
