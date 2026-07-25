from __future__ import annotations

import argparse
import json
import shutil
import zipfile
from pathlib import Path

from common import (
    DEFAULT_CONFIG,
    configure_logging,
    ensure_pipeline_directories,
    iter_jsonl,
    load_config,
    load_json,
    resolve_project_path,
    stable_id,
    write_jsonl,
)


def download_opus(source: dict, destination: Path, logger) -> Path:
    try:
        from opustools import OpusGet
    except ImportError as exc:
        raise RuntimeError(
            "Thiếu opustools. Hãy cài requirements-training.txt trong venv training."
        ) from exc
    download_dir = destination / "opus_download"
    download_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Tải OPUS corpus=%s release=%s", source["corpus"], source["release"])
    getter = OpusGet(
        directory=source["corpus"],
        source=source["source_language"],
        target=source["target_language"],
        release=source.get("release", "latest"),
        preprocess="moses",
        download_dir=str(download_dir),
        suppress_prompts=True,
    )
    getter.get_files()
    for archive in download_dir.rglob("*.zip"):
        extraction_root = archive.with_suffix("")
        extraction_root.mkdir(parents=True, exist_ok=True)
        resolved_root = extraction_root.resolve()
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                target_path = (extraction_root / member.filename).resolve()
                if resolved_root not in target_path.parents and target_path != resolved_root:
                    raise RuntimeError(f"Archive OPUS có đường dẫn không an toàn: {member.filename}")
            bundle.extractall(extraction_root)
    source_files = sorted(
        path for path in download_dir.rglob("*")
        if path.is_file() and path.suffix in {".ja", ".jpn"}
    )
    target_files = sorted(
        path for path in download_dir.rglob("*")
        if path.is_file() and path.suffix in {".vi", ".vie"}
    )
    if not source_files or not target_files:
        raise RuntimeError(
            f"OPUS không tạo cặp file ja/vi trong {download_dir}. "
            "Xem metadata release và log opustools."
        )
    output = destination / "pairs.jsonl"
    pairs = []
    with source_files[0].open("r", encoding="utf-8", errors="replace") as ja_handle, \
            target_files[0].open("r", encoding="utf-8", errors="replace") as vi_handle:
        for ja, vi in zip(ja_handle, vi_handle):
            ja, vi = ja.strip(), vi.strip()
            if ja and vi:
                pairs.append({
                    "id": stable_id(source["id"], ja, vi),
                    "ja": ja,
                    "vi": vi,
                    "source": source["id"],
                    "license": source["license"],
                })
    write_jsonl(output, pairs)
    return output


def import_local_jsonl(source: dict, destination: Path) -> Path:
    source_path = resolve_project_path(source["path"])
    if not source_path.is_file():
        destination.mkdir(parents=True, exist_ok=True)
        placeholder = destination / "README.txt"
        placeholder.write_text(
            f"Đặt file JSONL đã duyệt tại: {source_path}\n"
            f"Mỗi dòng cần trường {source['source_field']} và {source['target_field']}.\n",
            encoding="utf-8",
        )
        return placeholder
    output = destination / "pairs.jsonl"
    pairs = []
    for item in iter_jsonl(source_path):
        ja = str(item.get(source["source_field"]) or "").strip()
        vi = str(item.get(source["target_field"]) or "").strip()
        if ja and vi:
            pairs.append({
                "id": stable_id(source["id"], ja, vi),
                "ja": ja,
                "vi": vi,
                "source": source["id"],
                "license": source["license"],
            })
    write_jsonl(output, pairs)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument(
        "--accept-licenses",
        action="store_true",
        help="Bắt buộc xác nhận đã đọc và chấp nhận license trong sources.json.",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    config = load_config(args.config)
    ensure_pipeline_directories(config)
    logger = configure_logging(config, "01_download")
    source_manifest_path = Path(__file__).with_name("sources.json")
    manifest = load_json(source_manifest_path)
    raw_root = Path(config["paths"]["raw"])
    completed = []
    for source in manifest["sources"]:
        if not source.get("enabled", False):
            continue
        if not source.get("accepted", False) and not args.accept_licenses:
            raise RuntimeError(
                f"Chưa chấp nhận license nguồn {source['id']}: {source['license']}. "
                "Sửa accepted=true sau khi đọc license hoặc truyền --accept-licenses."
            )
        destination = raw_root / source["id"]
        marker = destination / ".complete.json"
        if marker.is_file() and not args.force:
            logger.info("Bỏ qua nguồn đã hoàn tất: %s", source["id"])
            completed.append(json.loads(marker.read_text(encoding="utf-8")))
            continue
        if args.force and destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True, exist_ok=True)
        if source["kind"] == "opus":
            output = download_opus(source, destination, logger)
        elif source["kind"] == "local_jsonl":
            output = import_local_jsonl(source, destination)
        else:
            raise RuntimeError(f"Loại nguồn chưa hỗ trợ: {source['kind']}")
        record = {
            "id": source["id"],
            "kind": source["kind"],
            "license": source["license"],
            "accepted": bool(source.get("accepted", False) or args.accept_licenses),
            "output": str(output),
        }
        marker.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        completed.append(record)
    report = Path(config["paths"]["reports"]) / "download_manifest.json"
    report.write_text(json.dumps(completed, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Hoàn tất manifest %s nguồn tại %s", len(completed), report)


if __name__ == "__main__":
    main()
