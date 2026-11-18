"""Offline, entirely fictional tests for OCR staging; no external binaries needed."""
import importlib.util
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ocr_stage.py"
spec = importlib.util.spec_from_file_location("ocr_stage", SCRIPT)
ocr = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = ocr
spec.loader.exec_module(ocr)


class OcrStageTests(unittest.TestCase):
    def test_rejects_only_known_noise(self):
        self.assertEqual(ocr.clean_extracted_text(
            "-- 1 of 68 --\nМова освітнього процесу\nNo structured content extracted."
        ), "Мова освітнього процесу")
        self.assertEqual(ocr.clean_extracted_text("-- 2 of 2 --"), "")

    def test_url_hash_and_ambiguous_cache(self):
        url = "https://example.org/doc/Example.PDF?L=6#fragment"
        expected = hashlib.sha1(b"https://example.org/doc/Example.PDF").hexdigest()[:14]
        self.assertEqual(ocr.url_cache_suffix(url), expected)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            pdf = root / ("example_" + expected + ".pdf")
            pdf.write_bytes(b"%PDF synthetic")
            self.assertEqual(ocr.locate_cached_pdf(root, url), pdf)
            (root / ("duplicate_" + expected + ".pdf")).write_bytes(b"%PDF")
            with self.assertRaisesRegex(ValueError, "expected one cached PDF"):
                ocr.locate_cached_pdf(root, url)

    def test_tsv_confidence_is_not_a_trust_score(self):
        tsv = ("level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
               "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t80\tМова\n"
               "5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t60\tосвітнього\n"
               "5\t1\t1\t1\t2\t1\t0\t0\t10\t10\t70\tпроцесу\n")
        content, confidence, words = ocr.parse_tesseract_tsv(tsv)
        self.assertEqual(content, "Мова освітнього\nпроцесу")
        self.assertEqual(confidence, 70.0)
        self.assertEqual(words, 3)
        with self.assertRaisesRegex(ValueError, "TSV"):
            ocr.parse_tesseract_tsv("not tsv")

    def test_native_ocr_and_unreadable(self):
        native = ocr.make_page(1, "Заяви приймаються до 15 серпня 2026 року.", None, 20, 10)
        self.assertEqual(native["extractionMethod"], "native")
        self.assertEqual(native["reviewStatus"], "needs_manual_review")
        scanned = ocr.make_page(2, "-- 2 of 2 --", ("Мова освітнього процесу", 87.2, 3), 20, 10)
        self.assertEqual(scanned["extractionMethod"], "ocr")
        self.assertEqual(scanned["rawOcrMeanWordConfidence"], 87.2)
        blank = ocr.make_page(2, "", ("", None, 0), 20, 10)
        self.assertEqual(blank["reviewStatus"], "unreadable")
        with self.assertRaisesRegex(ValueError, "OCR is required"):
            ocr.make_page(1, "-- 1 of 1 --", None, 20, 10)

    def test_hash_and_incomplete_output(self):
        first = ocr.make_page(1, "Мова освітнього процесу", None, 15, 10)
        base = dict(schemaVersion=ocr.SCHEMA, pageCount=2, complete=False, pages=[first])
        ocr.validate_staging(base)
        with self.assertRaisesRegex(ValueError, "completeness"):
            ocr.validate_staging({**base, "complete": True})
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            ocr.validate_staging({**base, "pages": [{**first, "text": "fake"}]})
        with self.assertRaisesRegex(ValueError, "page sequence"):
            ocr.validate_staging({**base, "pages": [{**first, "pageNumber": 2}]})

    def test_never_overwrites_or_exports_unreviewed_text_to_corpus(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            pdf_dir, output = root/"pdf", root/"ocr_staging"
            pdf_dir.mkdir()
            url = "https://example.org/test.pdf"
            suffix = ocr.url_cache_suffix(url)
            (pdf_dir/("test_" + suffix + ".pdf")).write_bytes(b"%PDF dummy")
            entry = dict(id="test_pdf_1", sourceUrl=url, year=2026, documentTitle="fictional")
            fake = dict(schemaVersion=ocr.SCHEMA, pageCount=1, processedPages=1,
                        complete=True, pages=[ocr.make_page(
                            1, "Мова освітнього процесу", None, 15, 10)])
            with patch.object(ocr, "process_document", return_value=fake):
                report = ocr.stage_manifest(dict(documents=[entry]), pdf_dir,
                                            output, None, 1, 220, 40, 10)
                self.assertEqual(report["documents"][0]["processedPages"], 1)
                self.assertTrue((output/"test_pdf_1.ocr.json").is_file())
                self.assertFalse((output/"test_pdf_1.txt").exists())
                with self.assertRaises(FileExistsError):
                    ocr.stage_manifest(dict(documents=[entry]), pdf_dir,
                                       output, None, 1, 220, 40, 10)


if __name__ == "__main__":
    unittest.main()
