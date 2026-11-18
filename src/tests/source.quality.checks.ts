import assert from "assert/strict";
import { isNonEvidenceLine } from "../modules/normalizer/evidence.quality";
import { buildSectionsFromPdfText } from "../modules/scraper/pdf.parser";
import { chunkDocument } from "../modules/ingest/ingest_corpus";

// All input here is synthetic: tests do not claim legal-document correctness.
function testNoiseOnlyLines(): void {
  assert.equal(isNonEvidenceLine("-- 1 of 68 --"), true);
  assert.equal(isNonEvidenceLine(" --   68 of 68  -- "), true);
  assert.equal(isNonEvidenceLine("No structured content extracted."), true);
  assert.equal(isNonEvidenceLine("no structured content extracted"), true);
  assert.equal(isNonEvidenceLine("Мова освітнього процесу"), false);
  assert.equal(isNonEvidenceLine("15"), false);
  assert.equal(isNonEvidenceLine("Подання заяв здійснюється до 15 серпня."), false);
}

function structured(body: string): string {
  return [
    "Document: Умовний документ",
    "Source: example.org",
    "Year: 2026",
    "Category: regulations",
    "URL: https://example.org/fictional",
    "ScrapedAt: 2026-01-01",
    "",
    "Section 1. Умовні положення",
    body,
  ].join("\n");
}

function testIngestDoesNotIndexPlaceholders(): void {
  const scanned = structured(
    Array.from({ length: 68 }, (_, i) => `1.${i + 1} -- ${i + 1} of 68 --`).join("\n")
  );
  assert.deepEqual(chunkDocument(scanned), []);
  assert.deepEqual(chunkDocument(structured("1.1 No structured content extracted.")), []);
  assert.deepEqual(chunkDocument(structured("")), []);

  const metadataOnly = [
    "Document: Умовний документ",
    "Source: example.org",
    "Year: 2026",
    "Category: regulations",
    "URL: https://example.org/fictional",
    "ScrapedAt: 2026-01-01",
    "",
  ].join("\n");
  assert.deepEqual(chunkDocument(metadataOnly), []);
}

function testIngestPreservesEvidence(): void {
  const mixed = chunkDocument(structured([
    "1.1 -- 1 of 2 --",
    "1.2 Подання документів здійснюється до 15 серпня.",
    "1.3 No structured content extracted.",
    "1.4 Мова освітнього процесу",
    "1.5 -- 2 of 2 --",
  ].join("\n")));
  assert.equal(mixed.length, 2);
  assert.equal(mixed[0].chunkText, "Подання документів здійснюється до 15 серпня.");
  assert.equal(mixed[1].chunkText, "Мова освітнього процесу");
  assert.equal(mixed[0].section, "1");
}

function testPdfParserNoiseFiltering(): void {
  const scanOnly = Array.from({ length: 68 }, (_, i) =>
    `-- ${i + 1} of 68 --`
  ).join("\n");
  assert.deepEqual(buildSectionsFromPdfText(scanOnly, "Умовний документ"), []);

  const mixed = buildSectionsFromPdfText([
    "-- 1 of 2 --",
    "Розділ 1. Загальні положення",
    "Робоча програма містить перелік навчальних тем.",
    "-- 2 of 2 --",
    "Мова освітнього процесу",
  ].join("\n"), "Умовний документ");

  const allLines = mixed.flatMap(section => section.lines);
  assert.equal(allLines.includes("-- 1 of 2 --"), false);
  assert.equal(allLines.includes("-- 2 of 2 --"), false);
  assert.ok(allLines.some(x => x.includes("Робоча програма")));
  assert.ok(allLines.some(x => x.includes("Мова освітнього процесу")));
}

testNoiseOnlyLines();
testIngestDoesNotIndexPlaceholders();
testIngestPreservesEvidence();
testPdfParserNoiseFiltering();
console.log("Source content quality checks passed (synthetic fixtures only).");
