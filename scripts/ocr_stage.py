#!/usr/bin/env python3
"""Stage per-page Ukrainian OCR candidates. NEVER writes to the RAG corpus."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

SCHEMA = "ocr-page-candidates/1"
PAGE_MARKER = re.compile(r"^--\s*\d+\s+of\s+\d+\s*--$", re.I)
PLACEHOLDER = re.compile(r"^No structured content extracted\.?$", re.I)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def clean_extracted_text(raw: str) -> str:
    result = []
    for raw_line in raw.replace("\r", "").split("\n"):
        line = " ".join(raw_line.split())
        if line and not PAGE_MARKER.fullmatch(line) and not PLACEHOLDER.fullmatch(line):
            result.append(line)
    return "\n".join(result).strip()


def evidence_chars(text: str) -> int:
    return sum(ch.isalnum() for ch in text)


def url_cache_suffix(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("invalid source URL")
    normalized = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:14]


def locate_cached_pdf(directory: Path, url: str) -> Path:
    suffix = url_cache_suffix(url)
    found = sorted(p for p in directory.rglob("*.pdf")
                   if p.name.lower().endswith("_" + suffix + ".pdf"))
    if len(found) != 1:
        raise ValueError(f"expected one cached PDF with SHA-1 suffix {suffix}; found {len(found)}")
    return found[0]


def parse_tesseract_tsv(tsv: str) -> tuple[str, float | None, int]:
    """Raw Tesseract confidences are diagnostic, NOT calibrated accuracy."""
    reader = csv.DictReader(io.StringIO(tsv), delimiter="\t")
    required = {"conf", "text", "block_num", "par_num", "line_num"}
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        raise ValueError("invalid Tesseract TSV header")
    lines: list[str] = []
    words: list[str] = []
    scores: list[float] = []
    old_key = None
    for row in reader:
        word = (row.get("text") or "").strip()
        if not word:
            continue
        try:
            conf = float(row.get("conf") or "-1")
        except ValueError:
            continue
        if not 0 <= conf <= 100:
            continue
        key = (row.get("page_num"), row.get("block_num"),
               row.get("par_num"), row.get("line_num"))
        if old_key is not None and old_key != key:
            lines.append(" ".join(words))
            words = []
        old_key = key
        words.append(word)
        scores.append(conf)
    if words:
        lines.append(" ".join(words))
    output = clean_extracted_text("\n".join(lines))
    average = round(sum(scores) / len(scores), 1) if scores else None
    return output, average, len(scores)


def call(args: list[str], timeout: int = 120) -> str:
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Missing command: {args[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Command timed out: {args[0]}") from exc
    if result.returncode:
        reason = result.stderr.decode("utf-8", "replace")[:600]
        raise RuntimeError(f"{args[0]} failed with code {result.returncode}: {reason}")
    return result.stdout.decode("utf-8", "replace")


def check_tools() -> None:
    commands = ("pdfinfo", "pdftotext", "pdftoppm", "tesseract")
    missing = [name for name in commands if not shutil.which(name)]
    if missing:
        raise RuntimeError("Install Poppler/Tesseract tools: " + ", ".join(missing))
    langs = set(call(["tesseract", "--list-langs"], timeout=30).splitlines())
    if not {"ukr", "eng"}.issubset(langs):
        raise RuntimeError("Tesseract needs both ukr and eng language data")


def pdf_pages(pdf: Path) -> int:
    match = re.search(r"^Pages:\s*(\d+)\s*$", call(["pdfinfo", str(pdf)]), re.M)
    if not match or int(match.group(1)) <= 0:
        raise ValueError("Cannot determine PDF page count")
    return int(match.group(1))


def native_page(pdf: Path, page: int) -> str:
    return clean_extracted_text(call([
        "pdftotext", "-f", str(page), "-l", str(page), "-layout",
        "-enc", "UTF-8", "-nopgbrk", str(pdf), "-"
    ], timeout=60))


def ocr_page(pdf: Path, page: int, dpi: int) -> tuple[str, float | None, int]:
    with tempfile.TemporaryDirectory(prefix="rag-ocr-") as folder:
        prefix = Path(folder) / "page"
        call(["pdftoppm", "-f", str(page), "-l", str(page), "-r", str(dpi),
              "-gray", "-png", "-singlefile", str(pdf), str(prefix)], timeout=120)
        image = prefix.with_suffix(".png")
        if not image.is_file():
            raise RuntimeError("PDF page rasterization failed")
        tsv = call(["tesseract", str(image), "stdout", "-l", "ukr+eng",
                    "--psm", "3", "tsv"], timeout=150)
        return parse_tesseract_tsv(tsv)


def make_page(page: int, native: str, recognized: tuple[str, float | None, int] | None,
              min_native_chars: int, min_ocr_chars: int) -> dict:
    native = clean_extracted_text(native)
    if evidence_chars(native) >= min_native_chars:
        method, body, confidence, word_count = "native", native, None, None
    else:
        if recognized is None:
            raise ValueError("OCR is required for a scanned page")
        method, body, confidence, word_count = "ocr", *recognized
        body = clean_extracted_text(body)
    return {
        "pageNumber": page,
        "extractionMethod": method,
        "reviewStatus": ("needs_manual_review"
                         if evidence_chars(body) >= min_ocr_chars else "unreadable"),
        "text": body,
        "textSha256": sha256(body.encode("utf-8")),
        "evidenceCharacters": evidence_chars(body),
        "rawOcrMeanWordConfidence": confidence,
        "rawOcrWordCount": word_count,
    }


def validate_staging(result: dict) -> None:
    if result.get("schemaVersion") != SCHEMA:
        raise ValueError("invalid staging schema")
    pages, total = result.get("pages"), result.get("pageCount")
    if not isinstance(pages, list) or not pages or not isinstance(total, int) or total < len(pages):
        raise ValueError("invalid page count or page list")
    if result.get("complete") is not (len(pages) == total):
        raise ValueError("incorrect completeness flag")
    for number, page in enumerate(pages, 1):
        if page.get("pageNumber") != number:
            raise ValueError("invalid page sequence")
        if page.get("reviewStatus") not in ("needs_manual_review", "unreadable"):
            raise ValueError("invalid review status")
        if page.get("extractionMethod") not in ("native", "ocr"):
            raise ValueError("invalid extraction method")
        body = page.get("text")
        if not isinstance(body, str) or sha256(body.encode("utf-8")) != page.get("textSha256"):
            raise ValueError("page text hash mismatch")


def process_document(entry: dict, pdf: Path, max_pages: int | None,
                     dpi: int, min_native_chars: int, min_ocr_chars: int) -> dict:
    total = pdf_pages(pdf)
    limit = min(total, max_pages) if max_pages else total
    pages = []
    for page_no in range(1, limit + 1):
        native = native_page(pdf, page_no)
        recognized = (ocr_page(pdf, page_no, dpi)
                      if evidence_chars(native) < min_native_chars else None)
        pages.append(make_page(page_no, native, recognized, min_native_chars, min_ocr_chars))
    result = {
        "schemaVersion": SCHEMA,
        "documentId": entry["id"],
        "documentTitle": entry.get("documentTitle"),
        "sourceUrl": entry["sourceUrl"],
        "declaredSourceYear": entry.get("year"),
        "sourceScrapedAt": entry.get("scrapedAt"),
        "sourcePdfSha256": sha256(pdf.read_bytes()),
        "pdfCacheFile": pdf.name,
        "pageCount": total,
        "processedPages": len(pages),
        "complete": len(pages) == total,
        "ocrLanguages": "ukr+eng",
        "renderDpi": dpi,
        "minNativeCharacters": min_native_chars,
        "minOcrCharacters": min_ocr_chars,
        "requiresHumanVerification": True,
        "pages": pages,
    }
    validate_staging(result)
    return result


def stage_manifest(manifest: dict, pdf_root: Path, output: Path, document_id: str | None,
                   max_pages: int | None, dpi: int,
                   min_native_chars: int, min_ocr_chars: int) -> dict:
    docs = manifest.get("documents")
    if not isinstance(docs, list):
        raise ValueError("invalid scrape manifest")
    selected = [doc for doc in docs if isinstance(doc, dict)
                and "_pdf_" in str(doc.get("id", ""))]
    if document_id:
        selected = [doc for doc in selected if doc["id"] == document_id]
    if not selected:
        raise ValueError("PDF document not found in manifest")
    if len({doc["id"] for doc in selected}) != len(selected):
        raise ValueError("duplicate document IDs in manifest")
    output.mkdir(parents=True, exist_ok=True)
    summary = {"schemaVersion": "ocr-staging-run/1", "documents": [],
               "warning": "OCR text is UNREVIEWED and MUST NOT be treated as gold or indexed automatically."}
    for doc in selected:
        doc_id = str(doc["id"])
        if not re.fullmatch(r"[A-Za-z0-9_-]+", doc_id):
            raise ValueError("unsafe document ID in manifest")
        target = output / (doc_id + ".ocr.json")
        if target.exists():
            raise FileExistsError(f"will not overwrite existing file: {target}")
        pdf = locate_cached_pdf(pdf_root, doc["sourceUrl"])
        result = process_document(doc, pdf, max_pages, dpi, min_native_chars, min_ocr_chars)
        with target.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(result, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
        pages = result["pages"]
        summary["documents"].append({
            "documentId": doc_id, "candidateFile": str(target),
            "pageCount": result["pageCount"], "processedPages": len(pages),
            "complete": result["complete"],
            "nativePages": sum(p["extractionMethod"] == "native" for p in pages),
            "ocrPages": sum(p["extractionMethod"] == "ocr" for p in pages),
            "unreadablePages": sum(p["reviewStatus"] == "unreadable" for p in pages),
        })
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("data/scrape_manifest.json"))
    parser.add_argument("--raw-pdf", type=Path, default=Path("data/raw_pdf"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/ocr_staging"))
    parser.add_argument("--document-id", help="Limit OCR to one manifest document")
    parser.add_argument("--max-pages", type=int, help="Only for incomplete smoke tests")
    parser.add_argument("--dpi", type=int, default=220)
    parser.add_argument("--min-native-chars", type=int, default=40)
    parser.add_argument("--min-ocr-chars", type=int, default=10)
    args = parser.parse_args()
    if args.max_pages is not None and args.max_pages < 1:
        parser.error("--max-pages must be positive")
    if not 150 <= args.dpi <= 350:
        parser.error("--dpi must be between 150 and 350")
    if args.min_native_chars < 1 or args.min_ocr_chars < 1:
        parser.error("character thresholds must be positive")
    try:
        check_tools()
        with args.manifest.open(encoding="utf-8") as stream:
            manifest = json.load(stream)
        report = stage_manifest(manifest, args.raw_pdf, args.output_dir, args.document_id,
                                args.max_pages, args.dpi, args.min_native_chars, args.min_ocr_chars)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, RuntimeError) as exc:
        print("OCR staging failed:", str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
