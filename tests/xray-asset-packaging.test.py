"""Focused Xray-only staging and IPK asset integrity checks."""

import gzip
import hashlib
import importlib.util
import io
import json
import os
import re
import tarfile
import tempfile


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = importlib.util.spec_from_file_location("build_ipk", os.path.join(ROOT, "build_ipk.py"))
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)
EXPECTED = {
    "geosite.dat": ("adf92de0cfc70e458b399f04c5f912bf42d115ed7e37281b30e2f1c68605e4e9", 10491954),
    "geoip.dat": ("744c97b74c52bae2ac8664fef6ac481d7765cb8432a0df54f0368a88b9b4a354", 19768301),
}
VERSION = "4.0.3"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def ar_payload(ipk, wanted):
    payload = open(ipk, "rb").read()
    assert payload.startswith(b"!<arch>\n")
    offset = 8
    while offset < len(payload):
        header = payload[offset : offset + 60]
        name = header[:16].decode("ascii").strip().rstrip("/")
        size = int(header[48:58].decode("ascii").strip())
        offset += 60
        member = payload[offset : offset + size]
        if name == wanted:
            return member
        offset += size + (size % 2)
    raise AssertionError(wanted + " missing")


def compressed_tar(ipk, wanted):
    return gzip.decompress(ar_payload(ipk, wanted))


def main():
    for name, expected in EXPECTED.items():
        staged = os.path.join(ROOT, "build", "cores", "xray", name)
        assert os.path.isfile(staged), "staged asset missing: " + staged
        data = open(staged, "rb").read()
        assert (sha256(data), len(data)) == expected

    with tempfile.TemporaryDirectory(prefix="alcyone-xray-asset-ipk-") as output:
        ipk = BUILDER.build_edition("xray", output)
        assert os.path.basename(ipk) == "Alcyone-XRay_%s_arm.ipk" % VERSION
        assert os.listdir(output) == [os.path.basename(ipk)]
        with tarfile.open(fileobj=io.BytesIO(compressed_tar(ipk, "control.tar.gz")), mode="r:") as control:
            control_text = control.extractfile("control").read().decode("utf-8")
            assert "Package: com.alcyone.vpn\n" in control_text
            assert "Version: %s\n" % VERSION in control_text
            assert "Architecture: arm\n" in control_text

        with tarfile.open(fileobj=io.BytesIO(compressed_tar(ipk, "data.tar.gz")), mode="r:") as archive:
            members = {member.name: member for member in archive.getmembers() if member.isfile()}
            app = "usr/palm/applications/com.alcyone.vpn/"
            service = "usr/palm/services/com.alcyone.vpn.service/"
            package = "usr/palm/packages/com.alcyone.vpn/"

            appinfo = json.loads(archive.extractfile(members[app + "appinfo.json"]).read())
            service_package = json.loads(archive.extractfile(members[service + "package.json"]).read())
            edition = json.loads(archive.extractfile(members[service + "edition.json"]).read())
            packageinfo = json.loads(archive.extractfile(members[package + "packageinfo.json"]).read())
            assert appinfo["version"] == VERSION
            assert service_package["version"] == VERSION
            assert edition["version"] == VERSION
            assert packageinfo["version"] == VERSION

            service_source = archive.extractfile(members[service + "service.js"]).read().decode("utf-8")
            assert re.search(
                r"path\.resolve\(__dirname,\s*'\.\.',\s*'\.\.',\s*'applications',\s*edition\.appId\)",
                service_source,
            ), "packaged service must resolve the sibling installed application"
            assert "logger.info('service started', { edition: edition.id, version: edition.version });" in service_source

            for name, expected in EXPECTED.items():
                packaged = app + "bin/" + name
                assert packaged in members, "IPK asset missing: " + packaged
                member = members[packaged]
                data = archive.extractfile(member).read()
                assert (sha256(data), len(data)) == expected
                assert member.mode == 0o644
    print("ok - Xray 4.0.1 staging, metadata, resolver and pinned assets are canonical")


if __name__ == "__main__":
    main()
