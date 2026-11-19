"""Synthetic guardrails for reviewed OCR export; NEVER expert annotations."""
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ocr_review_export.py"
spec = importlib.util.spec_from_file_location("ocr_review_export", SCRIPT)
reviewer = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = reviewer
spec.loader.exec_module(reviewer)


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def fixture():
    # Fake PDF and human identities are ONLY synthetic fixtures.
    pdf = b"%PDF-1.4 \n fictional PDF fixture"
    source = [
        "Умовне положення: заяви приймають до 15 серпня.",
        "No structured content extracted.",
    ]
    pages = []
    for index, value in enumerate(source, 1):
        pages.append({
            "pageNumber": index, "text": value, "textSha256": sha256(value.encode()),
            "extractionMethod": "ocr", "reviewStatus": "needs_manual_review",
        })
    staging = {
        "schemaVersion": "ocr-page-candidates/1",
        "documentId": "fictional_policy_2026_pdf_1",
        "documentTitle": "Умовне положення про вступ",
        "sourceUrl": "https://example.org/fictional.pdf",
        "declaredSourceYear": 2026,
        "sourceScrapedAt": "2026-01-01",
        "sourcePdfSha256": sha256(pdf),
        "pageCount": 2, "processedPages": 2, "complete": True,
        "requiresHumanVerification": True, "pages": pages,
    }
    staging_bytes = json.dumps(staging, ensure_ascii=False).encode("utf-8")
    review = {
        "schemaVersion": "ocr-page-review/1",
        "documentId": staging["documentId"],
        "sourcePdfSha256": sha256(pdf),
        "stagingSha256": sha256(staging_bytes),
        "documentVersion": "fictional-version-reviewed-by-test",
        "verifiedDocumentYear": 2024,
        "versionEvidenceNote": "Synthetic example: date checked in imaginary title page",
        "versionReviewerId": "synthetic-version-reviewer",
        "category": "regulations",
        "pages": [
            {
                "pageNumber": 1, "candidateTextSha256": pages[0]["textSha256"],
                "decision": "approved", "reviewerId": "synthetic-page-reviewer",
                "reviewedAt": "2026-11-18T13:00:00+02:00",
                "reviewNote": "Synthetic acceptance fixture",
                "reviewedText": source[0],
            },
            {
                "pageNumber": 2, "candidateTextSha256": pages[1]["textSha256"],
                "decision": "excluded", "reviewerId": "synthetic-page-reviewer",
                "reviewedAt": "2026-11-18T13:10:00Z",
                "reviewNote": "Synthetic empty page excluded",
            },
        ],
    }
    return staging, review, pdf


def encoded(stage: dict, review: dict) -> tuple[bytes, bytes]:
    stage_bytes = json.dumps(stage, ensure_ascii=False).encode("utf-8")
    review["stagingSha256"] = sha256(stage_bytes)
    return stage_bytes, json.dumps(review, ensure_ascii=False).encode("utf-8")


class ReviewedOcrExportTests(unittest.TestCase):
    def test_correct_version_and_page_provenance(self):
        stage, review, pdf = fixture()
        stage_bytes, review_bytes = encoded(stage, review)
        name, text, sidecar = reviewer.prepare_export(stage_bytes, review_bytes, pdf)
        self.assertEqual(name, "fictional_policy_2026_pdf_1.txt")
        self.assertIn("Year: 2024", text)
        self.assertNotIn("Year: 2026", text)
        self.assertIn("Section 1. PDF-сторінка 1", text)
        self.assertNotIn("Section 2.", text)
        self.assertIn("заяви приймають", text)
        self.assertEqual(sidecar["originalPageCount"], 2)
        self.assertEqual(sidecar["pageDecisions"][1]["decision"], "excluded")
        self.assertEqual(sidecar["pageDecisions"][0]["reviewedText"], stage["pages"][0]["text"])
        self.assertEqual(sidecar["exportedTextSha256"], sha256(text.encode("utf-8")))
        self.assertEqual(sidecar["stagingFileSha256"], sha256(stage_bytes))
        self.assertEqual(sidecar["reviewFileSha256"], sha256(review_bytes))

    def test_export_is_separate_and_never_overwrites(self):
        stage, review, pdf = fixture()
        name, text, sidecar = reviewer.prepare_export(*encoded(stage, review), pdf)
        with tempfile.TemporaryDirectory() as dirname:
            base = Path(dirname)
            output = base / "university_corpus_ocr_synthetic_v1"
            reviewer.export_to_new_directory(output, name, text, sidecar)
            self.assertEqual((output / name).read_text(encoding="utf-8"), text)
            # Exact bytes matter: Windows CRLF conversion must not invalidate
            # the immutable SHA-256 written to the provenance sidecar.
            self.assertEqual((output / name).read_bytes(), text.encode("utf-8"))
            self.assertEqual(sha256((output / name).read_bytes()), sidecar["exportedTextSha256"])
            other = json.loads((output / (name[:-4] + ".provenance.json")).read_text())
            self.assertEqual(other["sourcePdfSha256"], sha256(pdf))
            with self.assertRaises(FileExistsError):
                reviewer.export_to_new_directory(output, name, text, sidecar)
            with self.assertRaisesRegex(ValueError, "new university_corpus_ocr_"):
                reviewer.export_to_new_directory(base / "university_corpus", name, text, sidecar)

    def test_all_pages_must_be_reviewed(self):
        stage, review, pdf = fixture()
        def fails(mutate, expected):
            s = json.loads(json.dumps(stage))
            r = json.loads(json.dumps(review))
            mutate(s, r)
            with self.assertRaisesRegex(ValueError, expected):
                reviewer.prepare_export(*encoded(s, r), pdf)
        fails(lambda s, r: r["pages"].pop(), "exactly one explicit decision")
        fails(lambda s, r: r["pages"][1].update(pageNumber=1), "out of order")
        fails(lambda s, r: r["pages"][0].update(candidateTextSha256="fake"), "candidate text hash")
        fails(lambda s, r: r["pages"][0].update(reviewerId=""), "reviewerId")
        fails(lambda s, r: r["pages"][0].update(reviewedAt="2026-11-18"), "timezone")
        fails(lambda s, r: r["pages"][0].update(decision="pending"), "approved or excluded")
        fails(lambda s, r: r["pages"][0].pop("reviewedText"), "approved reviewedText")
        fails(lambda s, r: r["pages"][0].update(reviewedText="-- 1 of 2 --"), "placeholder")
        fails(lambda s, r: r["pages"][1].update(reviewedText="injected"), "cannot have reviewedText")
        fails(lambda s, r: r["pages"][0].update(decision="excluded"), "cannot have reviewedText")

    def test_rejects_missing_version_and_forged_inputs(self):
        stage, review, pdf = fixture()
        def fails(mutate, expected, payload_pdf=None):
            s = json.loads(json.dumps(stage))
            r = json.loads(json.dumps(review))
            mutate(s, r)
            with self.assertRaisesRegex(ValueError, expected):
                reviewer.prepare_export(*encoded(s, r), pdf if payload_pdf is None else payload_pdf)
        fails(lambda s, r: r.update(verifiedDocumentYear="2026"), "verifiedDocumentYear")
        fails(lambda s, r: r.update(versionEvidenceNote=""), "versionEvidenceNote")
        fails(lambda s, r: r.update(documentVersion=""), "documentVersion")
        fails(lambda s, r: r.update(documentId="other"), "documentId mismatch")
        fails(lambda s, r: r.update(sourcePdfSha256="0"*64), "original PDF SHA-256")
        fails(lambda s, r: s.update(complete=False), "incomplete")
        fails(lambda s, r: s["pages"][0].update(textSha256="0"*64), "text SHA-256")
        fails(lambda s, r: None, "original PDF SHA-256", payload_pdf=b"%PDF forged")
        stage_bytes, review_bytes = encoded(stage, review)
        forged_review = json.loads(review_bytes)
        forged_review["stagingSha256"] = "f"*64
        with self.assertRaisesRegex(ValueError, "staging file SHA-256"):
            reviewer.prepare_export(stage_bytes, json.dumps(forged_review).encode(), pdf)

    def test_rejects_all_excluded_and_unknown_schema(self):
        stage, review, pdf = fixture()
        review["pages"][0]["decision"] = "excluded"
        review["pages"][0].pop("reviewedText")
        with self.assertRaisesRegex(ValueError, "all pages excluded"):
            reviewer.prepare_export(*encoded(stage, review), pdf)
        stage["schemaVersion"] = "unknown"
        with self.assertRaisesRegex(ValueError, "unsupported schemaVersion"):
            reviewer.prepare_export(*encoded(stage, review), pdf)

    def test_long_text_wrapped_without_new_facts(self):
        source = " ".join(["умовне"]*220)
        chunks = reviewer.split_page(source)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(" ".join(chunks), source)
        self.assertTrue(all(len(c) <= 650 for c in chunks))


    def test_template_is_pending_not_approval(self):
        template_path = Path(__file__).resolve().parents[1] / "scripts" / "ocr_review_template.py"
        template_spec = importlib.util.spec_from_file_location("ocr_review_template", template_path)
        template_module = importlib.util.module_from_spec(template_spec)
        sys.modules[template_spec.name] = template_module
        template_spec.loader.exec_module(template_module)
        stage, _review, pdf = fixture()
        stage_bytes = json.dumps(stage, ensure_ascii=False).encode()
        template = template_module.pending_review_template(stage_bytes)
        self.assertEqual(template["stagingSha256"], sha256(stage_bytes))
        self.assertEqual(len(template["pages"]), 2)
        self.assertTrue(all(p["decision"] == "pending" for p in template["pages"]))
        self.assertIsNone(template["verifiedDocumentYear"])
        with self.assertRaisesRegex(ValueError, "documentVersion"):
            reviewer.prepare_export(stage_bytes, json.dumps(template).encode(), pdf)



if __name__ == "__main__":
    unittest.main()
