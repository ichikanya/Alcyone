"""Verify pinned native release inputs against their recorded provenance.

Native binaries are generated under build/cores and must never be committed.
When generated outputs exist, this test verifies digest, size and ELF machine.
"""

import hashlib
import io
import json
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROVENANCE = os.path.join(ROOT, "cores", "provenance.json")

failures = []
checks = 0


def check(name, condition, detail=""):
    global checks
    checks += 1
    if condition:
        print("ok   - " + name)
    else:
        failures.append(name)
        print("FAIL - " + name + ((" (" + detail + ")") if detail else ""))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def elf_machine(path):
    with open(path, "rb") as handle:
        header = handle.read(20)
    if len(header) < 20 or header[:4] != b"\x7fELF":
        return None
    little_endian = header[5] == 1
    return struct.unpack("<H" if little_endian else ">H", header[18:20])[0]


def main():
    with io.open(PROVENANCE, encoding="utf-8") as handle:
        manifest = json.load(handle)

    check("provenance manifest lists components", len(manifest.get("components", [])) > 0)
    check("provenance schema is current", manifest.get("schemaVersion") == 2)

    committed_locations = [
        os.path.join(ROOT, "cores", "xray", "xray"),
        os.path.join(ROOT, "cores", "xray", "tun2socks"),
        os.path.join(ROOT, "cores", "sing-box", "sing-box"),
    ]
    check(
        "native executables are not stored with source",
        not any(os.path.isfile(item) for item in committed_locations),
    )

    for component in manifest["components"]:
        name = component["name"]
        path = os.path.join(ROOT, component["path"].replace("/", os.sep))

        license_path = os.path.join(ROOT, component["licenseFile"].replace("/", os.sep))
        check(name + ": upstream license text is vendored", os.path.isfile(license_path), license_path)
        check(name + ": license identifier is recorded", bool(component.get("license")))

        for field in (
            "upstreamRepository",
            "upstreamTag",
            "upstreamCommit",
            "acquisition",
            "toolchain",
            "buildFlags",
            "outputArchitecture",
            "sha256",
            "sizeBytes",
        ):
            check(name + ": provenance records " + field, bool(component.get(field)))
        check(
            name + ": source commit is immutable",
            bool(re.match(r"^[0-9a-f]{40}$", component.get("upstreamCommit", ""))),
        )
        check(
            name + ": no provenance field is unverified",
            "UNVERIFIED" not in json.dumps(component),
        )

        if os.path.isfile(path):
            actual_sha = sha256_file(path)
            check(
                name + ": generated sha256 matches provenance",
                actual_sha == component["sha256"],
                "expected %s got %s" % (component["sha256"], actual_sha),
            )
            actual_size = os.path.getsize(path)
            check(
                name + ": generated size matches provenance",
                actual_size == component["sizeBytes"],
                "expected %d got %d" % (component["sizeBytes"], actual_size),
            )
            machine = elf_machine(path)
            check(
                name + ": generated ELF machine matches provenance",
                machine == component["elfMachine"],
                "expected %s got %s" % (component["elfMachine"], machine),
            )
            check(name + ": generated binary targets 32-bit ARM", machine == 40, "e_machine=%s" % machine)
        else:
            check(name + ": generated output is optional before the core build", True)

    print("\n%d/%d checks passed" % (checks - len(failures), checks))
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
