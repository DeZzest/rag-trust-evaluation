#!/usr/bin/env python3
"""Assemble immutable, reviewed-PDF-only JSONL corpus snapshots, without indexing.

Only reviewed OCR exports are accepted. Legacy TXT, unreviewed OCR staging,
and active ChromaDB collections are never read or modified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlsplit

from ocr_review_export import informative, render_structured, sha256, split_page, check_timestamp
from ocr_stage import locate_cached_pdf

SNAPSHOT_SCHEMA = "corpus-snapshot/1"
PROVENANCE_SCHEMA = "ocr-reviewed-provenance/1"
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


def fail(message: str) -> None:
    raise ValueError(message)


def obj(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        fail(f"{label}: object required")
    return value


def name(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{label}: nonempty text required")
    return value.strip()


def check_sha(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        fail(f"{label}: valid SHA-256 required")
    return value


def year_value(value: object, label: str) -> int:
    if type(value) is not int or value < 1900 or value > 2200:
        fail(f"{label}: reviewed year 1900..2200 required")
    return value


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def read_manifest(manifest_bytes: bytes) -> dict[str, dict]:
    try:
        manifest = obj(json.loads(manifest_bytes), "manifest")
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("manifest: invalid JSON") from error
    documents = manifest.get("documents")
    if not isinstance(documents, list) or not documents:
        fail("manifest: nonempty documents array required")
    output = {}
    for entry in documents:
        e = obj(entry, "manifest document")
        document_id = name(e.get("id"), "manifest document ID")
        if not SAFE_ID.fullmatch(document_id) or document_id in output:
            fail("manifest: duplicate or unsafe document ID")
        name(e.get("documentTitle"), "manifest documentTitle")
        url = name(e.get("sourceUrl"), "manifest sourceUrl")
        if urlsplit(url).scheme not in ("http", "https"):
            fail("manifest: source URL must be HTTP(S)")
        name(e.get("scrapedAt"), "manifest scrapedAt")
        output[document_id] = e
    return output


def checked_document(reviewed_dir: Path, manifest_documents: dict[str, dict],
                     raw_pdf_dir: Path) -> dict:
    if not reviewed_dir.is_dir() or reviewed_dir.is_symlink() or not reviewed_dir.name.startswith("university_corpus_ocr_"):
        fail("reviewed source directory must be a real university_corpus_ocr_* folder")

    files = list(reviewed_dir.iterdir())
    if any(f.is_symlink() or not f.is_file() for f in files):
        fail("reviewed directory: symlinks and nested directories are forbidden")
    text_files = sorted(f for f in files if f.suffix == ".txt")
    provenance_files = sorted(f for f in files if f.name.endswith(".provenance.json"))
    if len(text_files) != 1 or len(provenance_files) != 1 or len(files) != 2:
        fail("reviewed directory must contain exactly one TXT and one provenance JSON")
    try:
        sidecar = obj(json.loads(provenance_files[0].read_bytes()), "provenance")
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("provenance: invalid JSON") from error
    if sidecar.get("schemaVersion") != PROVENANCE_SCHEMA:
        fail("provenance: not an approved OCR export")
    doc_id = name(sidecar.get("documentId"), "provenance.documentId")
    if not SAFE_ID.fullmatch(doc_id) or doc_id not in manifest_documents:
        fail("provenance: unknown or unsafe document ID")
    if text_files[0].name != doc_id + ".txt" or provenance_files[0].name != doc_id + ".provenance.json":
        fail("provenance: filename/document ID mismatch")
    if sidecar.get("exportedTextFile") != text_files[0].name:
        fail("provenance: exportedTextFile mismatch")

    source = manifest_documents[doc_id]
    source_url = name(sidecar.get("sourceUrl"), "provenance.sourceUrl")
    if source_url != source["sourceUrl"]:
        fail("provenance: source URL does not match manifest")
    pdf = locate_cached_pdf(raw_pdf_dir, source_url)
    source_pdf_sha = check_sha(sidecar.get("sourcePdfSha256"), "sourcePdfSha256")
    if sha256(pdf.read_bytes()) != source_pdf_sha:
        fail("provenance: original PDF SHA-256 mismatch")

    for field in ("stagingFileSha256", "reviewFileSha256"):
        check_sha(sidecar.get(field), field)
    version = name(sidecar.get("documentVersion"), "documentVersion")
    doc_year = year_value(sidecar.get("verifiedDocumentYear"), "verifiedDocumentYear")
    version_note = name(sidecar.get("versionEvidenceNote"), "versionEvidenceNote")
    version_reviewer = name(sidecar.get("versionReviewerId"), "versionReviewerId")
    category = name(sidecar.get("category"), "category")
    if not SAFE_ID.fullmatch(category):
        fail("provenance: unsafe category")

    count = sidecar.get("originalPageCount")
    pages = sidecar.get("pageDecisions")
    if type(count) is not int or not 1 <= count <= 3000 or not isinstance(pages, list) or len(pages) != count:
        fail("provenance: incomplete page decisions")
    approved = []
    excluded_count = 0
    for number, raw in enumerate(pages, 1):
        item = obj(raw, f"page {number}")
        if item.get("pageNumber") != number:
            fail("provenance: missing, duplicated or out-of-order pages")
        check_sha(item.get("candidateTextSha256"), f"page {number} candidateTextSha256")
        name(item.get("reviewerId"), f"page {number} reviewerId")
        check_timestamp(item.get("reviewedAt"))
        name(item.get("reviewNote"), f"page {number} reviewNote")
        decision = item.get("decision")
        if decision == "approved":
            review_text = item.get("reviewedText")
            if not isinstance(review_text, str) or not informative(review_text):
                fail(f"page {number}: invalid approved reviewedText")
            if check_sha(item.get("reviewedTextSha256"), f"page {number} reviewedTextSha256") != sha256(review_text.encode("utf-8")):
                fail(f"page {number}: reviewed text SHA-256 mismatch")
            approved.append(item)
        elif decision == "excluded":
            if item.get("reviewedText") is not None or item.get("reviewedTextSha256") is not None:
                fail(f"page {number}: excluded page cannot contain approved text")
            excluded_count += 1
        else:
            fail(f"page {number}: unsupported decision")
    if not approved:
        fail("provenance: no approved pages")

    original_text = text_files[0].read_bytes()
    if check_sha(sidecar.get("exportedTextSha256"), "exportedTextSha256") != sha256(original_text):
        fail("provenance: exported TXT SHA-256 mismatch")
    try:
        original_decoded = original_text.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("provenance: exported TXT must be UTF-8") from error
    expected = render_structured({
        "sourceUrl": source_url,
        "documentTitle": source["documentTitle"],
        "sourceScrapedAt": source["scrapedAt"],
    }, {
        "verifiedDocumentYear": doc_year, "category": category,
    }, pages)
    if expected != original_decoded:
        fail("provenance: exported TXT does not match reviewed pages and source manifest")

    metadata = {
        "documentId": doc_id,
        "documentVersion": version,
        "year": doc_year,
        "verifiedDocumentYear": doc_year,
        "category": category,
        "documentType": category,
        "documentTitle": source["documentTitle"],
        "source": urlsplit(source_url).hostname or "",
        "url": source_url,
        "sourcePdfSha256": source_pdf_sha,
        "stagingFileSha256": sidecar["stagingFileSha256"],
        "reviewFileSha256": sidecar["reviewFileSha256"],
        "fileName": text_files[0].name,
    }
    info = {
        "documentId": doc_id,
        "documentVersion": version,
        "verifiedDocumentYear": doc_year,
        "versionEvidenceNote": version_note,
        "versionReviewerId": version_reviewer,
        "sourceUrl": source_url,
        "sourcePdfSha256": source_pdf_sha,
        "exportedTextSha256": sha256(original_text),
        "reviewedProvenanceSha256": sha256(provenance_files[0].read_bytes()),
        "stagingFileSha256": sidecar["stagingFileSha256"],
        "reviewFileSha256": sidecar["reviewFileSha256"],
        "pageCount": count,
        "approvedPages": len(approved),
        "excludedPages": excluded_count,
    }
    return {"documentId": doc_id, "metadata": metadata, "info": info, "approved": approved}


def prepare_snapshot(manifest_bytes: bytes, raw_pdf_dir: Path,
                     reviewed_dirs: list[Path]) -> tuple[bytes, bytes]:
    """Prepare all output bytes in memory BEFORE touching the filesystem."""
    if not reviewed_dirs:
        fail("snapshot: at least one reviewed OCR export required")
    manifest = read_manifest(manifest_bytes)
    all_pdf_ids = sorted(k for k in manifest if "_pdf_" in k)
    if not all_pdf_ids:
        fail("manifest: no PDF documents to assemble")
    reviewed = [checked_document(folder, manifest, raw_pdf_dir) for folder in reviewed_dirs]
    by_id = {}
    seen_urls = set()
    for item in reviewed:
        doc_id = item["documentId"]
        url = item["metadata"]["url"]
        if doc_id in by_id:
            fail("snapshot: duplicate reviewed document ID")
        if url in seen_urls:
            fail("snapshot: duplicate reviewed PDF URL")
        by_id[doc_id] = item
        seen_urls.add(url)
    reviewed.sort(key=lambda item: item["documentId"])
    document_infos = [item["info"] for item in reviewed]
    source_manifest_sha = sha256(manifest_bytes)
    fingerprint = {
        "sourceManifestSha256": source_manifest_sha,
        "reviewedDocuments": document_infos,
    }
    snapshot_id = "sha256:" + sha256(canonical_bytes(fingerprint))
    lines = []
    chunk_ids = set()
    for item in reviewed:
        for page in item["approved"]:
            page_num = page["pageNumber"]
            for index, chunk in enumerate(split_page(page["reviewedText"]), 1):
                chunk_id = "chunk-" + sha256(canonical_bytes([
                    snapshot_id, item["documentId"], item["metadata"]["documentVersion"],
                    page_num, index, chunk,
                ]))[:24]
                if chunk_id in chunk_ids:
                    fail("snapshot: duplicate chunk ID")
                chunk_ids.add(chunk_id)
                metadata = {
                    **item["metadata"],
                    "corpusSnapshotId": snapshot_id,
                    "pageNumber": page_num,
                    "section": str(page_num),
                    "subsection": f"{page_num}.{index}",
                    "title": f"PDF-сторінка {page_num}",
                    "reviewStatus": "approved",
                    "reviewedTextSha256": page["reviewedTextSha256"],
                    "chunkId": chunk_id,
                }
                lines.append(canonical_bytes({"text": chunk, "metadata": metadata}) + b"\n")
    if not lines:
        fail("snapshot: no evidence chunks after reviewed page splitting")
    ingested_bytes = b"".join(lines)
    missing = sorted(set(all_pdf_ids) - set(by_id))
    manifest_out = {
        "schemaVersion": SNAPSHOT_SCHEMA,
        "corpusSnapshotId": snapshot_id,
        "sourceManifestSha256": source_manifest_sha,
        "sourceCorpusType": "human-reviewed-ocr-pdfs-only",
        "documentCount": len(reviewed),
        "pdfDocumentsInSourceManifest": len(all_pdf_ids),
        "completeForPdfManifest": not missing,
        "missingPdfDocumentIds": missing,
        "chunkCount": len(lines),
        "ingestedFile": "ingested_corpus.jsonl",
        "ingestedSha256": sha256(ingested_bytes),
        "documents": document_infos,
        "caveat": "Hashes validate artifact consistency, not independent reviewer identity or legal validity. OCR-only subset: HTML and native sources not included.",
    }
    return ingested_bytes, json.dumps(manifest_out, ensure_ascii=False,
                                     sort_keys=True, indent=2).encode("utf-8") + b"\n"


def export_snapshot(output_dir: Path, ingested_bytes: bytes, manifest_bytes: bytes) -> None:
    """Never overwrite existing output, default corpus or the active index."""
    if output_dir.parent.name != "corpus_snapshots" or not SAFE_ID.fullmatch(output_dir.name):
        fail("output must be data/corpus_snapshots/<safe-snapshot-label>")
    if output_dir.exists():
        raise FileExistsError("snapshot output directory already exists")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(exist_ok=False)
    try:
        with (output_dir / "ingested_corpus.jsonl").open("xb") as f:
            f.write(ingested_bytes)
        with (output_dir / "snapshot_manifest.json").open("xb") as f:
            f.write(manifest_bytes)
    except Exception:
        shutil.rmtree(output_dir)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--raw-pdf", required=True, type=Path)
    parser.add_argument("--reviewed-dir", required=True, type=Path, action="append")
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    try:
        manifest_path = args.manifest.resolve()
        raw_pdf = args.raw_pdf.resolve()
        reviewed_dirs = [p.resolve() for p in args.reviewed_dir]
        output_dir = args.output_dir.resolve()
        if output_dir.exists():
            raise FileExistsError("snapshot output directory already exists")
        if any(p == output_dir or output_dir in p.parents for p in [manifest_path, raw_pdf, *reviewed_dirs]):
            fail("output directory cannot contain an input")
        if len(set(reviewed_dirs)) != len(reviewed_dirs):
            fail("duplicate reviewed directory argument")
        ingested, snapshot_manifest = prepare_snapshot(
            manifest_path.read_bytes(), raw_pdf, reviewed_dirs,
        )
        export_snapshot(output_dir, ingested, snapshot_manifest)
        m = json.loads(snapshot_manifest)
        print(json.dumps({
            "status": "snapshot_created_not_indexed",
            "directory": str(output_dir),
            "corpusSnapshotId": m["corpusSnapshotId"],
            "documentCount": m["documentCount"],
            "chunkCount": m["chunkCount"],
            "ingestedSha256": m["ingestedSha256"],
            "completeForPdfManifest": m["completeForPdfManifest"],
            "missingPdfDocumentIds": m["missingPdfDocumentIds"],
            "nextGate": "review snapshot, then index a NEW Chroma collection in a separate approved step",
        }, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError) as error:
        print("Reviewed corpus snapshot failed:", error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
