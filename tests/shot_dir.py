"""Where tests write screenshots.

Default is test-output/ (git-ignored) so test runs leave the tree clean.
Set SPLITSTONE_UPDATE_SHOTS=1 to refresh the README images in screenshots/.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def shot_dir() -> Path:
    name = "screenshots" if os.environ.get("SPLITSTONE_UPDATE_SHOTS") == "1" else "test-output"
    d = ROOT / name
    d.mkdir(exist_ok=True)
    return d
