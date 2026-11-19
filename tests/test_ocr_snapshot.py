"""Fictional offline tests for immutable corpus snapshots; NOT expert evidence."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import ocr_review_export as exporter
import ocr_stage
import assemble_reviewed_snapshot as snapshot
import verify_reviewed_snapshot as verifier


def h(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class SyntheticWorkspace:
    def __init__(self, root: Path):
        self.root = root
        self.raw_pdf = root / "raw_pdf"
        self.raw_pdf.mkdir()
        self.sources = []

    def add_document(self, doc_id: str, year: int = 2024,
                     paragraphs=None, approved_mask=None):
        if paragraphs is None:
            paragraphs = ["Умовний документ: заяви приймаються до 15 серпня.",
                          "No structured content extracted."]
        if approved_mask is None:
            approved_mask = [True] + [False] * (len(paragraphs) - 1)
        assert len(paragraphs) == len(approved_mask)
        source_url = "https://example.org/" + doc_id + ".pdf"
        pdf_bytes = (b"%PDF-1.4 fictional-" + doc_id.encode())
        cache_file = self.raw_pdf / ("doc_" + ocr_stage.url_cache_suffix(source_url) + ".pdf")
        cache_file.write_bytes(pdf_bytes)
        source = {
            "id": doc_id,
            "sourceUrl": source_url,
            "documentTitle": "Умовне положення " + doc_id,
            "scrapedAt": "2026-11-18",
        }
        self.sources.append(source)

        staging = {
            "schemaVersion": "ocr-page-candidates/1",
            "documentId": doc_id,
            "documentTitle": source["documentTitle"],
            "sourceUrl": source_url,
            "declaredSourceYear": 2026,
            "sourceScrapedAt": "2026-11-18",
            "sourcePdfSha256": h(pdf_bytes),
            "pageCount": len(paragraphs),
            "processedPages": len(paragraphs),
            "complete": True,
            "requiresHumanVerification": True,
            "pages": [
                {
                    "pageNumber": i,
                    "text": value,
                    "textSha256": h(value.encode()),
                    "reviewStatus": "needs_manual_review",
                    "extractionMethod": "ocr",
                } for i, value in enumerate(paragraphs, 1)
            ],
        }
        staging_bytes = json.dumps(staging, ensure_ascii=False).encode()
        review = {
            "schemaVersion": "ocr-page-review/1",
            "documentId": doc_id,
            "sourcePdfSha256": h(pdf_bytes),
            "stagingSha256": h(staging_bytes),
            "documentVersion": "fictional-approved-v1",
            "verifiedDocumentYear": year,
            "versionEvidenceNote": "Synthetic version note; never a real legal verification",
            "versionReviewerId": "fictional-version-reviewer",
            "category": "regulations",
            "pages": [],
        }
        for idx, (text, approved) in enumerate(zip(paragraphs, approved_mask), 1):
            decision = {
                "pageNumber": idx,
                "candidateTextSha256": h(text.encode()),
                "decision": "approved" if approved else "excluded",
                "reviewerId": "synthetic-reviewer",
                "reviewedAt": "2026-11-18T20:00:00+02:00",
                "reviewNote": "Synthetic fixture only",
            }
            if approved:
                decision["reviewedText"] = text
            review["pages"].append(decision)
        review_bytes = json.dumps(review, ensure_ascii=False).encode()
        filename, content, sidecar = exporter.prepare_export(staging_bytes, review_bytes, pdf_bytes)
        folder = self.root / ("university_corpus_ocr_" + doc_id)
        exporter.export_to_new_directory(folder, filename, content, sidecar)
        return folder, cache_file, sidecar

    def manifest_bytes(self) -> bytes:
        return json.dumps({"documents": self.sources}, ensure_ascii=False).encode()


class CorpusSnapshotTests(unittest.TestCase):
    def test_stable_snapshot_independent_of_input_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = SyntheticWorkspace(Path(tmp))
            first, _, _ = w.add_document("fictional_pdf_1")
            many = " ".join(["Перевірений умовний текст"] * 100)
            second, _, _ = w.add_document("fictional_pdf_2", year=2025,
                                          paragraphs=[many], approved_mask=[True])
            manifest = w.manifest_bytes()
            a, ma = snapshot.prepare_snapshot(manifest, w.raw_pdf, [first, second])
            b, mb = snapshot.prepare_snapshot(manifest, w.raw_pdf, [second, first])
            self.assertEqual((a, ma), (b, mb))
            meta = json.loads(ma)
            self.assertEqual(meta["schemaVersion"], "corpus-snapshot/1")
            self.assertEqual(meta["documentCount"], 2)
            self.assertEqual(meta["pdfDocumentsInSourceManifest"], 2)
            self.assertTrue(meta["completeForPdfManifest"])
            self.assertEqual(meta["missingPdfDocumentIds"], [])
            self.assertEqual(meta["ingestedSha256"], h(a))
            self.assertTrue(meta["corpusSnapshotId"].startswith("sha256:"))
            lines = [json.loads(line) for line in a.decode().splitlines()]
            self.assertGreater(len(lines), 2)
            self.assertEqual(meta["chunkCount"], len(lines))
            self.assertTrue(all(row["metadata"]["corpusSnapshotId"] == meta["corpusSnapshotId"]
                                for row in lines))
            ids = [row["metadata"]["chunkId"] for row in lines]
            self.assertEqual(len(ids), len(set(ids)))
            self.assertTrue(all(row["metadata"]["reviewStatus"] == "approved" for row in lines))
            self.assertTrue(all(row["metadata"]["pageNumber"] == 1 for row in lines))
            self.assertTrue(all(row["metadata"]["documentVersion"] == "fictional-approved-v1" for row in lines))
            self.assertTrue(any(row["metadata"]["year"] == 2024 for row in lines))
            self.assertTrue(any(row["metadata"]["year"] == 2025 for row in lines))
            self.assertFalse(any("No structured" in row["text"] for row in lines))
            self.assertTrue(any(row["metadata"]["subsection"] == "1.2" for row in lines))
            self.assertEqual(len({row["metadata"]["documentId"] for row in lines}), 2)

    def test_partial_snapshot_is_labeled_partial(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = SyntheticWorkspace(Path(tmp))
            folder, _, _ = w.add_document("fictional_pdf_1")
            w.sources.append({
                "id": "missing_pdf_2", "sourceUrl": "https://example.org/missing.pdf",
                "documentTitle": "Missing fictional document", "scrapedAt": "2026-11-18",
            })
            data, manifest = snapshot.prepare_snapshot(w.manifest_bytes(), w.raw_pdf, [folder])
            meta = json.loads(manifest)
            self.assertFalse(meta["completeForPdfManifest"])
            self.assertEqual(meta["missingPdfDocumentIds"], ["missing_pdf_2"])
            self.assertEqual(meta["documentCount"], 1)
            self.assertEqual(len(data.splitlines()), 1)

    def test_export_creates_new_folder_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = SyntheticWorkspace(Path(tmp))
            folder, _, _ = w.add_document("fictional_pdf_1")
            data, manifest = snapshot.prepare_snapshot(w.manifest_bytes(), w.raw_pdf, [folder])
            dest = Path(tmp) / "corpus_snapshots" / "reviewed-v1"
            snapshot.export_snapshot(dest, data, manifest)
            self.assertEqual((dest / "ingested_corpus.jsonl").read_bytes(), data)
            self.assertEqual((dest / "snapshot_manifest.json").read_bytes(), manifest)
            with self.assertRaises(FileExistsError):
                snapshot.export_snapshot(dest, data, manifest)
            with self.assertRaisesRegex(ValueError, "output must be"):
                snapshot.export_snapshot(Path(tmp) / "university_corpus" / "bad", data, manifest)
            self.assertFalse((Path(tmp) / "data" / "ingested_corpus.jsonl").exists())

    def test_reject_tampering_and_missing_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = SyntheticWorkspace(Path(tmp))
            folder, pdf_file, sidecar = w.add_document("fictional_pdf_1")
            manifest = w.manifest_bytes()
            provenance_file = folder / "fictional_pdf_1.provenance.json"
            txt_file = folder / "fictional_pdf_1.txt"
            original_sidecar = provenance_file.read_bytes()
            original_txt = txt_file.read_bytes()

            def error_if_invalid(pattern):
                with self.assertRaisesRegex(ValueError, pattern):
                    snapshot.prepare_snapshot(manifest, w.raw_pdf, [folder])

            txt_file.write_bytes(original_txt + b"\nInauthentic extra sentence")
            error_if_invalid("exported TXT SHA-256 mismatch")
            txt_file.write_bytes(original_txt)

            changed = json.loads(original_sidecar)
            changed["pageDecisions"][0]["reviewedText"] = "injected"
            provenance_file.write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8", newline="\n")
            error_if_invalid("reviewed text SHA-256 mismatch")

            changed = json.loads(original_sidecar)
            changed["pageDecisions"].pop()
            provenance_file.write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8", newline="\n")
            error_if_invalid("incomplete page decisions")

            changed = json.loads(original_sidecar)
            changed["documentVersion"] = ""
            provenance_file.write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8", newline="\n")
            error_if_invalid("documentVersion")

            changed = json.loads(original_sidecar)
            changed["sourceUrl"] = "https://other.example.org/wrong.pdf"
            provenance_file.write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8", newline="\n")
            error_if_invalid("source URL does not match")

            provenance_file.write_bytes(original_sidecar)
            pdf_file.write_bytes(b"%PDF-forged")
            error_if_invalid("original PDF SHA-256 mismatch")

    def test_duplicate_and_unreviewed_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = SyntheticWorkspace(Path(tmp))
            folder, _, _ = w.add_document("fictional_pdf_1")
            manifest = w.manifest_bytes()
            with self.assertRaisesRegex(ValueError, "duplicate reviewed document ID"):
                snapshot.prepare_snapshot(manifest, w.raw_pdf, [folder, folder])

            with self.assertRaisesRegex(ValueError, "reviewed source directory"):
                snapshot.prepare_snapshot(manifest, w.raw_pdf, [Path(tmp) / "raw_pdf"])

            extra = folder / "unapproved.txt"
            extra.write_text("fictional unapproved", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "exactly one TXT"):
                snapshot.prepare_snapshot(manifest, w.raw_pdf, [folder])

            with self.assertRaisesRegex(ValueError, "at least one"):
                snapshot.prepare_snapshot(manifest, w.raw_pdf, [])


    def test_snapshot_verification_and_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            w = SyntheticWorkspace(Path(tmp))
            folder, _, _ = w.add_document("fictional_pdf_1")
            data, manifest = snapshot.prepare_snapshot(w.manifest_bytes(), w.raw_pdf, [folder])
            output = Path(tmp) / "corpus_snapshots" / "v1"
            snapshot.export_snapshot(output, data, manifest)
            report = verifier.verify_snapshot_directory(output)
            self.assertTrue(report["valid"])
            self.assertEqual(report["documentCount"], 1)
            self.assertEqual(report["chunkCount"], 1)
            self.assertEqual(report["corpusSnapshotId"], json.loads(manifest)["corpusSnapshotId"])

            jsonl_file = output / "ingested_corpus.jsonl"
            jsonl_file.write_bytes(data + b"{}\n")
            with self.assertRaisesRegex(ValueError, "JSONL SHA-256 mismatch"):
                verifier.verify_snapshot_directory(output)
            jsonl_file.write_bytes(data)

            manifest_file = output / "snapshot_manifest.json"
            bad = json.loads(manifest)
            bad["corpusSnapshotId"] = "sha256:" + "0" * 64
            manifest_file.write_text(json.dumps(bad))
            with self.assertRaisesRegex(ValueError, "snapshot ID mismatch"):
                verifier.verify_snapshot_directory(output)
            manifest_file.write_bytes(manifest)

            bad = json.loads(manifest)
            bad["completeForPdfManifest"] = True if bad["missingPdfDocumentIds"] else False
            manifest_file.write_text(json.dumps(bad))
            with self.assertRaisesRegex(ValueError, "completeness flag"):
                verifier.verify_snapshot_directory(output)
            manifest_file.write_bytes(manifest)

            (output / "unexpected.txt").write_text("unauthorized")
            with self.assertRaisesRegex(ValueError, "expected only"):
                verifier.verify_snapshot_directory(output)



if __name__ == "__main__":
    unittest.main()
