from __future__ import annotations

import html
import json
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from app.config import DATA_DIR
from app.ocr_service import OcrRegion, get_ocr_provider


MANGA_OCR_BASE = "https://raw.githubusercontent.com/kha-white/manga-ocr/master/assets/examples/"
MOKURO_DEMO = "https://kha-white.github.io/manga-demo/"
OUTPUT_DIR = DATA_DIR / "ocr_evaluation"

CROP_EXPECTED = [
    "素直にあやまるしか",
    "立川で見た〝穴〟の下の巨大な眼は：",
    "実戦剣術も一流です",
    "第３０話重苦しい闇の奥で静かに呼吸づきながら",
    "よかったじゃないわよ！何逃げてるのよ！！早くあいつを退治してよ！",
    "ぎゃっ",
    "ピンポーーン",
    "ＬＩＮＫ！私達７人の力でガノンの塔の結界をやぶります",
    "ファイアパンチ",
    "少し黙っている",
    "わかるかな〜？",
    "警察にも先生にも町中の人達に！！",
]

FULL_PAGE_NAMES = {"000b.jpg", "001a.jpg", "002a.jpg", "003b.jpg"}


def download(url: str, destination: Path) -> None:
    if destination.is_file():
        return
    request = Request(url, headers={"User-Agent": "MangaTranslatorStudio/0.1 OCR evaluation"})
    with urlopen(request, timeout=60) as response:
        destination.write_bytes(response.read())


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "MangaTranslatorStudio/0.1 OCR evaluation"})
    with urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    return "".join(text.split())


def similarity(expected: str, actual: str) -> float:
    return SequenceMatcher(None, normalize(expected), normalize(actual)).ratio()


def reading_order(regions: list[OcrRegion]) -> list[OcrRegion]:
    # Most Japanese manga columns are read right-to-left; horizontal fragments on
    # the same row remain ordered left-to-right by their x coordinate.
    return sorted(regions, key=lambda item: (round(item.y / 40), -item.x))


def parse_demo_pages(document: str) -> list[dict]:
    pages: list[dict] = []
    chunks = re.split(r'<div id="page\d+" class="page">', document)[1:]
    for chunk in chunks:
        image_match = re.search(r'background-image:url\(&quot;([^&]+?\.jpg)&quot;\)', chunk)
        if not image_match:
            continue
        relative_url = html.unescape(image_match.group(1))
        name = Path(relative_url).name
        if name not in FULL_PAGE_NAMES:
            continue
        expected_blocks: list[str] = []
        for block_html in re.findall(r'class="textBox"[^>]*>(.*?)</div>', chunk, flags=re.DOTALL):
            paragraphs = re.findall(r"<p>(.*?)</p>", block_html, flags=re.DOTALL)
            value = "".join(html.unescape(re.sub(r"<[^>]+>", "", item)) for item in paragraphs).strip()
            if value:
                expected_blocks.append(value)
        pages.append(
            {
                "name": name,
                "url": urljoin(MOKURO_DEMO, relative_url),
                "expected_blocks": expected_blocks,
            }
        )
    return pages


def best_match_scores(expected: list[str], predicted: list[str]) -> list[float]:
    return [max((similarity(item, candidate) for candidate in predicted), default=0.0) for item in expected]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    provider = get_ocr_provider()
    report: dict = {"provider": provider.name, "crop_samples": [], "full_pages": []}

    for index, expected in enumerate(CROP_EXPECTED):
        name = f"crop_{index:02d}.jpg"
        path = OUTPUT_DIR / name
        download(f"{MANGA_OCR_BASE}{index:02d}.jpg", path)
        regions = provider.recognize(path)
        actual = "".join(region.text for region in reading_order(regions))
        report["crop_samples"].append(
            {
                "name": name,
                "expected": expected,
                "actual": actual,
                "regions": len(regions),
                "similarity": round(similarity(expected, actual), 4),
            }
        )

    demo_html = fetch_text(MOKURO_DEMO)
    for page in parse_demo_pages(demo_html):
        path = OUTPUT_DIR / page["name"]
        download(page["url"], path)
        regions = provider.recognize(path)
        predicted = [region.text for region in regions]
        scores = best_match_scores(page["expected_blocks"], predicted)
        report["full_pages"].append(
            {
                "name": page["name"],
                "expected_block_count": len(page["expected_blocks"]),
                "detected_block_count": len(regions),
                "matched_at_60_percent": sum(score >= 0.6 for score in scores),
                "mean_best_similarity": round(sum(scores) / len(scores), 4) if scores else 0,
                "predicted_text": predicted,
            }
        )

    crop_scores = [item["similarity"] for item in report["crop_samples"]]
    report["summary"] = {
        "crop_mean_similarity": round(sum(crop_scores) / len(crop_scores), 4),
        "crop_exact_matches": sum(score == 1 for score in crop_scores),
        "crop_total": len(crop_scores),
        "full_page_total": len(report["full_pages"]),
    }
    report_path = OUTPUT_DIR / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=True))
    for page in report["full_pages"]:
        summary = {key: value for key, value in page.items() if key != "predicted_text"}
        print(json.dumps(summary, ensure_ascii=True))
    print("report=" + ascii(str(report_path)))


if __name__ == "__main__":
    main()
