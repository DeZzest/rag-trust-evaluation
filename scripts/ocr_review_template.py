#!/usr/bin/env python3
"""Generate an UNAPPROVED OCR review worksheet; no decisions are inferred."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ocr_review_export import sha256, validate_staging


def pending_review_template(staging_bytes: bytes) -> dict:
    try:
        stage = validate_staging(json.loads(staging_bytes))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid staging JSON") from exc
    return {
        "schemaVersion": "ocr-page-review/1",
        "documentId": stage["documentId"],
        "sourcePdfSha256": stage["sourcePdfSha256"],
        "stagingSha256": sha256(staging_bytes),
        "documentVersion": "",
        "verifiedDocumentYear": None,
        "versionEvidenceNote": "",
        "versionReviewerId": "",
        "category": "",
        "pages": [
            {
                "pageNumber": page["pageNumber"],
                "candidateTextSha256": page["textSha256"],
                "decision": "pending",
                "reviewerId": "",
                "reviewedAt": "",
                "reviewNote": "",
            } for page in stage["pages"]
        ],
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--staging", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    args = p.parse_args()
    try:
        result = pending_review_template(args.staging.read_bytes())
        target = args.output.resolve()
        if target == args.staging.resolve():
            raise ValueError("cannot overwrite the staging file")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("x", encoding="utf-8") as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        print(json.dumps({
            "output": str(target),
            "pagesAwaitingManualReview": len(result["pages"]),
            "status": "PENDING — cannot be exported without human decisions",
        }, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError) as exc:
        print("OCR review worksheet failed:", exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
