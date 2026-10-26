"""Generate the frontend catalog from the backend's current versioned source of truth."""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "backend/app/scoring/mappings"
TARGET = ROOT / "frontend/lib/mappings"

sys.path.insert(0, str(ROOT / "backend"))
from app.scoring.recommendations import CURRENT_MAPPING_VERSION, MAPPING_FILES


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if the generated copy is stale")
    args = parser.parse_args()
    name = MAPPING_FILES[CURRENT_MAPPING_VERSION]
    source, target = SOURCE / name, TARGET / name
    stale = [path for path in TARGET.glob("*.json") if path.name != name]
    if args.check:
        if stale or not target.exists() or target.read_bytes() != source.read_bytes():
            raise SystemExit("Run python scripts/sync-recommendation-mappings.py: frontend catalog is stale")
        return
    TARGET.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())
    for path in stale:
        path.unlink()


if __name__ == "__main__":
    main()
