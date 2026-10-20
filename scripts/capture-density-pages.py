"""Capture two public pages for the developer-only density replay harness."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.request

OUTPUT = Path(__file__).resolve().parents[1] / ".cache/density-manual"
PAGES = {
    "syosetu": "https://ncode.syosetu.com/n2386hb/1/",
    "mixed": "https://developer.mozilla.org/ja/docs/Web/JavaScript/Guide/Introduction",
}

if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, url in PAGES.items():
        request = urllib.request.Request(url, headers={"User-Agent": "Hakkutsu-local-validation/2.6.2"})
        raw = urllib.request.urlopen(request, timeout=30).read()
        data = {"url": url, "capturedAt": datetime.now(timezone.utc).isoformat(),
                "sha256": hashlib.sha256(raw).hexdigest(), "html": raw.decode("utf-8")}
        (OUTPUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"{name}: {len(raw)} bytes")
