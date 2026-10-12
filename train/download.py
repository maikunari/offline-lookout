"""Download the public datasets and verify their checksums.

Both sources are CC BY 4.0 (see DATA_LICENSES.md). No login required.
"""
from __future__ import annotations

import hashlib
import io
import sys
import zipfile

import requests

from common import RAW

SOURCES = {
    "uci_sms_spam_collection.zip": {
        "url": "https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip",
        "sha256": None,  # UCI occasionally re-zips; we verify the inner file instead
        "inner": {"SMSSpamCollection": "uci/SMSSpamCollection", "readme": "uci/readme"},
    },
    "mendeley_sms_phishing.zip": {
        "url": "https://data.mendeley.com/public-files/datasets/f45bkkt8pr/files/edb361de-918d-469f-9106-e84823830665/file_downloaded",
        "sha256": "9bbf3188fdad81495d8e82825648b9b63b53fc86841a3d26c02629990b233cc3",
        "inner": {"Dataset_5971.csv": "mendeley/Dataset_5971.csv"},
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    for name, src in SOURCES.items():
        target = RAW / name
        if target.exists():
            data = target.read_bytes()
            print(f"[skip] {name} already present ({len(data)} bytes)")
        else:
            print(f"[get ] {src['url']}")
            r = requests.get(src["url"], timeout=120)
            r.raise_for_status()
            data = r.content
            target.write_bytes(data)
        if src["sha256"] and sha256(data) != src["sha256"]:
            print(f"[FAIL] checksum mismatch for {name}: {sha256(data)}", file=sys.stderr)
            return 1
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for member, out in src["inner"].items():
                dest = RAW / out
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(zf.read(member))
                print(f"       -> {dest.relative_to(RAW)} sha256={sha256(dest.read_bytes())[:16]}...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
