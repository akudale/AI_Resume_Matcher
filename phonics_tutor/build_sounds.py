"""
Register phonics sound recordings for Pip.

Put one short clip per phoneme in static/sounds/, named by its id (s.mp3, sh.mp3, igh.mp3 ...),
then run:  python build_sounds.py
It writes static/sounds/manifest.json, which the app reads. Any sound without a clip is spoken
by the voice instead, so you can add recordings a few at a time.

Phoneme ids (with an example word) are printed by:  python build_sounds.py --list
"""
import json
import re
import subprocess
import sys
from pathlib import Path

SOUNDS = Path(__file__).parent / "static" / "sounds"
EXTS = (".mp3", ".m4a", ".ogg", ".wav")


def phonemes() -> dict:
    """Read the phoneme table from syllabus.js so there is one source of truth."""
    out = subprocess.run(
        ["node", "-e", "process.stdout.write(JSON.stringify(require('./static/syllabus.js').PHONEMES))"],
        cwd=Path(__file__).parent, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def main() -> None:
    table = phonemes()
    if "--list" in sys.argv:
        for pid, (say, ipa, example) in table.items():
            print(f"{pid + '.mp3':10} /{ipa}/  as in {example:8}  (spoken fallback: {say})")
        return
    files, unknown = {}, []
    for f in sorted(SOUNDS.iterdir()):
        if f.suffix.lower() not in EXTS:
            continue
        pid = re.sub(r"[^a-z]", "", f.stem.lower())
        (files.__setitem__(pid, f.name) if pid in table else unknown.append(f.name))
    missing = [p for p in table if p not in files]
    (SOUNDS / "manifest.json").write_text(json.dumps({"files": files}, indent=2) + "\n")
    print(f"{len(files)} of {len(table)} sounds have recordings.")
    if missing:
        print("Spoken by the voice instead:", ", ".join(missing))
    if unknown:
        print("Ignored (name is not a phoneme id):", ", ".join(unknown))


if __name__ == "__main__":
    main()
