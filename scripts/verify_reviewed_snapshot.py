#!/usr/bin/env python3
"""Fail-closed, offline verification of one immutable reviewed OCR snapshot.

Use before approving a separate future ChromaDB indexing operation.
Checks file hashes and internal consistency, NOT the truth of human reviews.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from assemble_reviewed_snapshot import (
    SNAPSHOT_SCHEMA, SAFE_ID, canonical_bytes, check_sha, name, obj, sha256, year_value
)


def verify_snapshot_directory(folder: Path) -> dict:
    if not folder.is_dir() or folder.is_symlink():
        raise ValueError("snapshot: real directory required")
    children = list(folder.iterdir())
    if any(p.is_symlink() or not p.is_file() for p in children) or {
        p.name for p in children
    } != {"ingested_corpus.jsonl", "snapshot_manifest.json"}:
        raise ValueError("snapshot: expected only one JSONL and one snapshot manifest")

    try:
        m = obj(json.loads((folder / "snapshot_manifest.json").read_bytes()), "snapshot manifest")
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError("snapshot manifest: invalid JSON") from error
    if m.get("schemaVersion") != SNAPSHOT_SCHEMA:
        raise ValueError("snapshot: unsupported schemaVersion")
    source_manifest_sha = check_sha(m.get("sourceManifestSha256"), "sourceManifestSha256")
    docs = m.get("documents")
    if not isinstance(docs, list) or not docs:
        raise ValueError("snapshot: nonempty documents required")
    names = set()
    previous_doc = ""
    for d in docs:
        doc = obj(d, "snapshot document")
        doc_id = name(doc.get("documentId"), "documentId")
        if not SAFE_ID.fullmatch(doc_id) or doc_id in names or (previous_doc and doc_id < previous_doc):
            raise ValueError("snapshot: duplicate, unsafe or unsorted document ID")
        names.add(doc_id)
        previous_doc = doc_id
        name(doc.get("documentVersion"), "documentVersion")
        year_value(doc.get("verifiedDocumentYear"), "verifiedDocumentYear")
        for key in ("sourcePdfSha256", "exportedTextSha256", "reviewedProvenanceSha256",
                    "stagingFileSha256", "reviewFileSha256"):
            check_sha(doc.get(key), key)

    fingerprint = {"sourceManifestSha256": source_manifest_sha, "reviewedDocuments": docs}
    expected_id = "sha256:" + sha256(canonical_bytes(fingerprint))
    if m.get("corpusSnapshotId") != expected_id:
        raise ValueError("snapshot: snapshot ID mismatch")

    missing = m.get("missingPdfDocumentIds")
    if not isinstance(missing, list) or any(
        not isinstance(v, str) or not SAFE_ID.fullmatch(v) or v in names for v in missing
    ) or missing != sorted(set(missing)):
        raise ValueError("snapshot: invalid missing document IDs")
    if m.get("documentCount") != len(docs) or (
        m.get("pdfDocumentsInSourceManifest") != len(docs) + len(missing)
    ) or m.get("completeForPdfManifest") is not (len(missing) == 0):
        raise ValueError("snapshot: document counts or completeness flag inconsistent")

    ingested = (folder / "ingested_corpus.jsonl").read_bytes()
    if check_sha(m.get("ingestedSha256"), "ingestedSha256") != sha256(ingested):
        raise ValueError("snapshot: ingested JSONL SHA-256 mismatch")
    lines = ingested.splitlines()
    if len(lines) != m.get("chunkCount") or not lines:
        raise ValueError("snapshot: missing or extra JSONL rows")

    expected_docs = {d["documentId"]: d for d in docs}
    chunk_ids = set()
    chunks_by_doc = {doc_id: 0 for doc_id in names}
    for idx, raw in enumerate(lines, 1):
        try:
            item = obj(json.loads(raw), f"row {idx}")
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError(f"snapshot row {idx}: invalid JSON") from error
        body = name(item.get("text"), f"row {idx}.text")
        md = obj(item.get("metadata"), f"row {idx}.metadata")
        doc_id = name(md.get("documentId"), f"row {idx}.documentId")
        doc = expected_docs.get(doc_id)
        if doc is None:
            raise ValueError("snapshot: row references unknown document")
        if (md.get("corpusSnapshotId") != expected_id
            or md.get("sourcePdfSha256") != doc["sourcePdfSha256"]
            or md.get("documentVersion") != doc["documentVersion"]
            or md.get("year") != doc["verifiedDocumentYear"]
            or md.get("reviewedTextSha256") is None
            or md.get("reviewStatus") != "approved"):
            raise ValueError("snapshot: metadata provenance mismatch")
        check_sha(md["reviewedTextSha256"], f"row {idx}.reviewedTextSha256")
        page = md.get("pageNumber")
        subsection = md.get("subsection")
        if type(page) is not int or not 1 <= page <= doc["pageCount"] or not isinstance(subsection, str):
            raise ValueError("snapshot: invalid physical page or subsection")
        prefix = str(page) + "."
        if md.get("section") != str(page) or not subsection.startswith(prefix):
            raise ValueError("snapshot: section not tied to PDF page")
        part = subsection[len(prefix):]
        if not part.isdigit() or int(part) < 1 or str(int(part)) != part:
            raise ValueError("snapshot: invalid chunk sequence")
        chunk_id = "chunk-" + sha256(canonical_bytes([
            expected_id, doc_id, doc["documentVersion"], page, int(part), body
        ]))[:24]
        if md.get("chunkId") != chunk_id or chunk_id in chunk_ids:
            raise ValueError("snapshot: invalid or duplicate chunk ID")
        chunk_ids.add(chunk_id)
        chunks_by_doc[doc_id] += 1
    if any(n == 0 for n in chunks_by_doc.values()):
        raise ValueError("snapshot: at least one document has no chunks")
    return {
        "valid": True,
        "corpusSnapshotId": expected_id,
        "documentCount": len(docs),
        "chunkCount": len(lines),
        "completeForPdfManifest": len(missing) == 0,
        "ingestedSha256": sha256(ingested),
        "warning": "Artifact consistency only. Human review and normative validity are not independently established.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot-dir", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify_snapshot_directory(args.snapshot_dir),
                         ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError) as error:
        print("Snapshot verification failed:", error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
