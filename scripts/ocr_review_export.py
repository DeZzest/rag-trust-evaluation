#!/usr/bin/env python3
"""Validate explicit human OCR reviews and export ONE versioned corpus document.

This tool cannot establish that a reviewer genuinely checked the scan, or that
the cited regulatory edition remains legally in force. Those are human gates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

STAGING_SCHEMA = "ocr-page-candidates/1"
REVIEW_SCHEMA = "ocr-page-review/1"
HEX256 = re.compile(r"^[a-f0-9]{64}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")
PAGE_NOISE = re.compile(r"^--\s*\d+\s+of\s+\d+\s*--$", re.I)
PLACEHOLDER = re.compile(r"^No structured content extracted\.?$", re.I)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fail(message: str) -> None:
    raise ValueError(message)


def record(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        fail(f"{label}: object required")
    return value


def string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{label}: nonempty text required")
    return value.strip()


def check_hash(value: object, label: str) -> str:
    if not isinstance(value, str) or not HEX256.fullmatch(value):
        fail(f"{label}: SHA-256 required")
    return value


def check_timestamp(value: object) -> str:
    raw = string(value, "reviewedAt")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        fail("reviewedAt: valid ISO 8601 timestamp required")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        fail("reviewedAt: timezone required")
    return raw


def clean_metadata(value: object, label: str) -> str:
    return " ".join(string(value, label).split())


def informative(text: str) -> bool:
    stripped = [" ".join(line.split()) for line in text.splitlines()]
    content = [line for line in stripped if line]
    return bool(content) and any(
        not PAGE_NOISE.fullmatch(line) and not PLACEHOLDER.fullmatch(line)
        for line in content
    )


def validate_staging(staging: object) -> dict:
    obj = record(staging, "staging")
    if obj.get("schemaVersion") != STAGING_SCHEMA:
        fail("staging: unsupported schemaVersion")
    doc_id = string(obj.get("documentId"), "documentId")
    if not SAFE_ID.fullmatch(doc_id):
        fail("documentId: unsafe characters")
    string(obj.get("documentTitle"), "documentTitle")
    source_url = string(obj.get("sourceUrl"), "sourceUrl")
    url = urlsplit(source_url)
    if url.scheme not in ("https", "http") or not url.netloc:
        fail("sourceUrl: HTTP(S) URL required")
    check_hash(obj.get("sourcePdfSha256"), "sourcePdfSha256")
    count = obj.get("pageCount")
    pages = obj.get("pages")
    if type(count) is not int or count < 1 or count > 3000:
        fail("staging: invalid pageCount")
    if not obj.get("complete") is True or obj.get("requiresHumanVerification") is not True:
        fail("staging: incomplete or not awaiting human verification")
    if not isinstance(pages, list) or len(pages) != count or obj.get("processedPages") != count:
        fail("staging: incomplete page set")
    for expected, item in enumerate(pages, 1):
        page = record(item, "staging page")
        if page.get("pageNumber") != expected:
            fail("staging: nonsequential page numbers")
        body = page.get("text")
        if not isinstance(body, str) or sha256(body.encode("utf-8")) != page.get("textSha256"):
            fail(f"staging page {expected}: text SHA-256 mismatch")
        if page.get("reviewStatus") not in ("needs_manual_review", "unreadable"):
            fail("staging: unexpected reviewStatus")
        if page.get("extractionMethod") not in ("native", "ocr"):
            fail("staging: unexpected extractionMethod")
    return obj


def validate_review(staging: dict, review_input: object, staging_file_hash: str,
                    pdf_bytes: bytes) -> tuple[dict, list[dict]]:
    review = record(review_input, "review")
    if review.get("schemaVersion") != REVIEW_SCHEMA:
        fail("review: unsupported schemaVersion")
    if review.get("documentId") != staging["documentId"]:
        fail("review: documentId mismatch")
    if check_hash(review.get("stagingSha256"), "review.stagingSha256") != staging_file_hash:
        fail("review: staging file SHA-256 mismatch")
    pdf_hash = sha256(pdf_bytes)
    if pdf_hash != staging["sourcePdfSha256"] or review.get("sourcePdfSha256") != pdf_hash:
        fail("review: original PDF SHA-256 mismatch")

    version = clean_metadata(review.get("documentVersion"), "documentVersion")
    year = review.get("verifiedDocumentYear")
    if type(year) is not int or not 1900 <= year <= 2200:
        fail("review: verifiedDocumentYear must be a reviewed four-digit year")
    version_note = string(review.get("versionEvidenceNote"), "versionEvidenceNote")
    reviewer = string(review.get("versionReviewerId"), "versionReviewerId")
    category = string(review.get("category"), "category")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", category):
        fail("category: only safe identifiers are allowed")

    decisions = review.get("pages")
    if not isinstance(decisions, list) or len(decisions) != staging["pageCount"]:
        fail("review: exactly one explicit decision for every PDF page required")
    checked: list[dict] = []
    approved = 0
    for page_index, raw in enumerate(decisions):
        choice = record(raw, "review page")
        src = staging["pages"][page_index]
        number = page_index + 1
        if choice.get("pageNumber") != number:
            fail("review: page missing, duplicated or out of order")
        if choice.get("candidateTextSha256") != src["textSha256"]:
            fail(f"review page {number}: candidate text hash mismatch")
        reviewer_id = string(choice.get("reviewerId"), "reviewerId")
        reviewed_at = check_timestamp(choice.get("reviewedAt"))
        note = string(choice.get("reviewNote"), "reviewNote")
        decision = choice.get("decision")
        if decision not in ("approved", "excluded"):
            fail(f"review page {number}: approved or excluded required")
        reviewed_text = choice.get("reviewedText")
        if decision == "approved":
            if not isinstance(reviewed_text, str) or not informative(reviewed_text):
                fail(f"review page {number}: approved reviewedText is empty or placeholder")
            if len(reviewed_text) > 2_000_000:
                fail(f"review page {number}: reviewedText exceeds limit")
            approved += 1
            reviewed_sha = sha256(reviewed_text.encode("utf-8"))
        else:
            if reviewed_text is not None:
                fail(f"review page {number}: excluded page cannot have reviewedText")
            reviewed_sha = None
        checked.append({
            "pageNumber": number,
            "decision": decision,
            "reviewerId": reviewer_id,
            "reviewedAt": reviewed_at,
            "reviewNote": note,
            "candidateTextSha256": src["textSha256"],
            "reviewedTextSha256": reviewed_sha,
            "extractionMethod": src["extractionMethod"],
            **({"reviewedText": reviewed_text} if decision == "approved" else {}),
        })
    if not approved:
        fail("review: all pages excluded; refusing empty corpus export")
    return {
        "documentVersion": version,
        "verifiedDocumentYear": year,
        "versionEvidenceNote": version_note,
        "versionReviewerId": reviewer,
        "category": category,
    }, checked


def split_page(text: str, max_chars: int = 650) -> list[str]:
    """Split reviewed word sequence into bounded retrieval chunks, not new facts."""
    words = text.split()
    output: list[str] = []
    current: list[str] = []
    size = 0
    for word in words:
        length = len(word) + (1 if current else 0)
        if current and size + length > max_chars:
            output.append(" ".join(current))
            current, size = [], 0
        current.append(word)
        size += len(word) + (1 if len(current) > 1 else 0)
    if current:
        output.append(" ".join(current))
    return output


def render_structured(staging: dict, version: dict, decisions: list[dict]) -> str:
    source = urlsplit(staging["sourceUrl"]).hostname or "unknown"
    heading = clean_metadata(staging["documentTitle"], "documentTitle")
    lines = [
        f"Document: {heading}", f"Source: {source}",
        f"Year: {version['verifiedDocumentYear']}",
        f"Category: {version['category']}",
        f"URL: {staging['sourceUrl']}",
        f"ScrapedAt: {staging.get('sourceScrapedAt') or 'unknown'}", "",
    ]
    for page in decisions:
        if page["decision"] != "approved":
            continue
        num = page["pageNumber"]
        lines.append(f"Section {num}. PDF-сторінка {num}")
        for index, text in enumerate(split_page(page["reviewedText"]), 1):
            lines.append(f"{num}.{index} {text}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def prepare_export(staging_bytes: bytes, review_bytes: bytes,
                   pdf_bytes: bytes) -> tuple[str, str, dict]:
    try:
        stage_input = json.loads(staging_bytes)
        review_input = json.loads(review_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid staging or review JSON") from exc
    staging = validate_staging(stage_input)
    file_sha = sha256(staging_bytes)
    version, pages = validate_review(staging, review_input, file_sha, pdf_bytes)
    doc_id = staging["documentId"]
    text = render_structured(staging, version, pages)
    filename = f"{doc_id}.txt"
    sidecar = {
        "schemaVersion": "ocr-reviewed-provenance/1",
        "documentId": doc_id,
        "sourceUrl": staging["sourceUrl"],
        "sourcePdfSha256": sha256(pdf_bytes),
        "stagingFileSha256": file_sha,
        "reviewFileSha256": sha256(review_bytes),
        "declaredSourceYearUnverified": staging.get("declaredSourceYear"),
        **version,
        "originalPageCount": staging["pageCount"],
        "pageDecisions": pages,
        "exportedTextFile": filename,
        "exportedTextSha256": sha256(text.encode("utf-8")),
        "warning": "Review statements are supplied by humans; this program does not prove legal validity or semantic accuracy.",
    }
    return filename, text, sidecar


def export_to_new_directory(output_dir: Path, filename: str,
                            text: str, provenance: dict) -> None:
    if not re.fullmatch(r"university_corpus_ocr_[A-Za-z0-9_-]+", output_dir.name):
        fail("output directory must be a new university_corpus_ocr_* directory")
    if output_dir.exists():
        raise FileExistsError("refusing to overwrite existing corpus directory")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(exist_ok=False)
    try:
        # The sidecar hash is calculated over UTF-8 bytes with LF line endings.
        # Binary output keeps the on-disk bytes identical on Windows and Unix.
        with (output_dir / filename).open("xb") as f:
            f.write(text.encode("utf-8"))
        with (output_dir / (filename[:-4] + ".provenance.json")).open(
            "x", encoding="utf-8", newline="\n"
        ) as f:
            json.dump(provenance, f, ensure_ascii=False, indent=2)
            f.write("\n")
    except Exception:
        shutil.rmtree(output_dir)
        raise


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--staging", type=Path, required=True)
    p.add_argument("--review", type=Path, required=True)
    p.add_argument("--pdf", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    args = p.parse_args()
    try:
        paths = [args.staging.resolve(), args.review.resolve(), args.pdf.resolve()]
        if len(set(paths)) != len(paths):
            fail("staging, review and PDF must be different files")
        output = args.output_dir.resolve()
        if output.exists() or output in paths:
            fail("output directory already exists or conflicts with an input")
        filename, text, provenance = prepare_export(
            args.staging.read_bytes(), args.review.read_bytes(), args.pdf.read_bytes()
        )
        export_to_new_directory(output, filename, text, provenance)
        print(json.dumps({
            "status": "exported_after_explicit_reviews",
            "documentId": provenance["documentId"],
            "outputDirectory": str(output),
            "sourcePdfSha256": provenance["sourcePdfSha256"],
            "exportedTextSha256": provenance["exportedTextSha256"],
            "approvedPages": sum(p["decision"] == "approved" for p in provenance["pageDecisions"]),
            "excludedPages": sum(p["decision"] == "excluded" for p in provenance["pageDecisions"]),
            "nextGate": "human audit of export, then controlled versioned ingestion; NOT indexed automatically",
        }, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError) as exc:
        print("Reviewed OCR export failed:", exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
