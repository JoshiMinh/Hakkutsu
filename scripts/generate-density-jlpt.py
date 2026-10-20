"""Generate the bundled density lexicon from a pinned, attributed source."""
import csv
import hashlib
import io
import json
from pathlib import Path
import unicodedata
import urllib.request

REVISION = "1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0"
BASE = f"https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/{REVISION}/"
ROOT = Path(__file__).resolve().parents[1]

def generate():
    expressions, readings, hashes = {}, {}, {}
    for level in range(1, 6):
        name = f"src/n{level}.csv"
        data = urllib.request.urlopen(BASE + name).read()
        hashes[name] = hashlib.sha256(data).hexdigest()
        for row in csv.DictReader(io.StringIO(data.decode("utf-8-sig"))):
            for column, target in [("expression", expressions), ("reading", readings)]:
                for alias in row[column].split(";"):
                    key = unicodedata.normalize("NFKC", alias).strip()
                    if key:
                        target.setdefault(key, set()).add(f"N{level}")
    # A reading can represent several homographs. Never prefer one level silently.
    for key, levels in readings.items():
        expressions.setdefault(key, set()).update(levels)
    index = {key: next(iter(levels)) if len(levels) == 1 else None
             for key, levels in sorted(expressions.items())}
    output = ROOT / "src/shared/japanese/data/density-jlpt.json"
    output.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    license_text = urllib.request.urlopen(BASE + "LICENSE").read().decode()
    notice = (f"Open Anki JLPT Decks\nhttps://github.com/jamsinclair/open-anki-jlpt-decks\n"
              f"Revision: {REVISION}\nDerived vocabulary: expression/reading aliases and source-file JLPT level only.\n"
              "Upstream credits: chyyran/jlpt-anki-decks and tanos.co.uk.\n"
              "Community study lists, not an official JLPT classification.\n\n" + license_text)
    for folder in ["licenses", "public/licenses"]:
        (ROOT / folder).mkdir(exist_ok=True)
        (ROOT / folder / "density-jlpt.txt").write_text(notice, encoding="utf-8")
    manifest = {"revision": REVISION, "sha256": hashes, "entries": len(index),
                "ambiguous": sum(value is None for value in index.values())}
    (output.parent / "density-jlpt.source.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest))

if __name__ == "__main__":
    generate()
