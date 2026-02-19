import fs from "fs";
import path from "path";

const CORPUS_DIR = path.join(__dirname, "../../../data/university_corpus");
const OUTPUT_FILE = path.join(__dirname, "../../../data/ingested_corpus.jsonl");

const docTypeMap: Record<string, string> = {
  admission_rules: "admission",
  scholarships_regulation: "scholarship",
  academic_integrity_policy: "integrity_policy",
  exam_retake_policy: "exam_retake",
  expulsion_policy: "expulsion",
  thesis_regulation: "thesis",
  academic_calendar: "calendar",
};

function extractYear(fileName: string): number | null {
  const match = fileName.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function detectReferences(text: string): string[] {
  const refs: string[] = [];
  // Case-insensitive, matches both 'See' and 'see', and allows for optional period
  const refRegex = /see ([a-z ]+?)(?: section (\d+))?/gi;
  let match;
  while ((match = refRegex.exec(text))) {
    refs.push(match[1].trim() + (match[2] ? ` Section ${match[2]}` : ""));
  }
  return refs;
}

function chunkDocument(text: string): Array<{
  chunkText: string;
  section: string;
  subsection: string;
  title: string;
}> {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let currentSection = "";
  let currentTitle = "";
  for (const line of lines) {
    const sectionMatch = line.match(/^Section (\d+)\. (.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      currentTitle = sectionMatch[2];
      continue;
    }
    const pointMatch = line.match(/^(\d+\.\d+) (.+)$/);
    if (pointMatch) {
      chunks.push({
        chunkText: line.trim(),
        section: currentSection,
        subsection: pointMatch[1],
        title: currentTitle,
      });
    }
  }
  return chunks;
}

function main() {
  const files = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith(".txt"));
  const out = fs.createWriteStream(OUTPUT_FILE, { flags: "w" });
  for (const fileName of files) {
    const filePath = path.join(CORPUS_DIR, fileName);
    const text = fs.readFileSync(filePath, "utf-8");
    const base = fileName.replace(/\.txt$/, "");
    const year = extractYear(fileName);
    const documentType = docTypeMap[base.replace(/_\d{4}$/, "")] || "other";
    const chunks = chunkDocument(text);
    for (const chunk of chunks) {
      const detectedReferences = detectReferences(chunk.chunkText);
      const metadata = {
        documentId: base.replace(/_\d{4}$/, ""),
        fileName,
        year,
        documentType,
        section: chunk.section,
        subsection: chunk.subsection,
        title: chunk.title,
        detectedReferences,
      };
      out.write(JSON.stringify({ text: chunk.chunkText, metadata }) + "\n");
    }
  }
  out.end();
  console.log(`Ingestion complete. Output: ${OUTPUT_FILE}`);
}

if (require.main === module) {
  main();
}
