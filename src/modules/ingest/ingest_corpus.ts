import fs from "fs";
import path from "path";

const CORPUS_DIR = path.join(__dirname, "../../../data/university_corpus");
const OUTPUT_FILE = path.join(__dirname, "../../../data/ingested_corpus.jsonl");

const docTypeMap: Record<string, string> = {
  admission_rules: "admission",
  admission_documents: "admission_documents",
  scholarships_regulation: "scholarship",
  academic_integrity_policy: "integrity_policy",
  exam_retake_policy: "exam_retake",
  expulsion_policy: "expulsion",
  thesis_regulation: "thesis",
  academic_calendar: "calendar",
  lute_regulations: "regulations",
  lute_material_base: "material_base",
};

function extractYear(fileName: string): number | null {
  const match = fileName.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function detectReferences(text: string): string[] {
  const refs: string[] = [];
  const patterns = [
    /see\s+([a-z\s]+?)\s+section\s+(\d+(?:\.\d+)?)/gi,
    /див\.?\s+розділ\s+(\d+(?:\.\d+)?)/gi,
    /згідно\s+з\s+розділом\s+(\d+(?:\.\d+)?)/gi,
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match[2]) {
        refs.push(`${match[1].trim()} Section ${match[2]}`);
      } else if (match[1]) {
        refs.push(`Section ${match[1]}`);
      }
    }
  }
  return refs;
}

interface ParsedHeader {
  documentTitle?: string;
  source?: string;
  year?: number;
  category?: string;
  url?: string;
  scrapedAt?: string;
  bodyStartIndex: number;
}

function parseStructuredHeader(lines: string[]): ParsedHeader {
  const parsed: ParsedHeader = { bodyStartIndex: 0 };

  let index = 0;
  for (; index < lines.length; index++) {
    const raw = lines[index].trim();
    if (!raw) {
      index++;
      break;
    }

    const match = raw.match(/^([A-Za-z][A-Za-z ]+):\s*(.+)$/);
    if (!match) break;

    const key = match[1].toLowerCase().replace(/\s+/g, "");
    const value = match[2].trim();

    if (key === "document") parsed.documentTitle = value;
    if (key === "source") parsed.source = value;
    if (key === "year") {
      const parsedYear = Number(value);
      if (Number.isFinite(parsedYear)) parsed.year = parsedYear;
    }
    if (key === "category") parsed.category = value;
    if (key === "url") parsed.url = value;
    if (key === "scrapedat") parsed.scrapedAt = value;
  }

  parsed.bodyStartIndex = index;
  return parsed;
}

function normalizeChunkText(lines: string[]): string {
  return lines
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkDocument(text: string): Array<{
  chunkText: string;
  section: string;
  subsection?: string;
  title: string;
}> {
  const lines = text.split(/\r?\n/);
  const header = parseStructuredHeader(lines);
  const contentLines = lines.slice(header.bodyStartIndex);
  const chunks: Array<{
    chunkText: string;
    section: string;
    subsection?: string;
    title: string;
  }> = [];

  let currentSection = "";
  let currentTitle = "";
  let currentSubsection: string | undefined;
  let currentBuffer: string[] = [];
  let sectionLooseBuffer: string[] = [];

  const flushSubsection = () => {
    if (!currentSection || !currentSubsection) return;
    const textValue = normalizeChunkText(currentBuffer);
    if (!textValue) return;
    chunks.push({
      chunkText: textValue,
      section: currentSection,
      subsection: currentSubsection,
      title: currentTitle,
    });
    currentBuffer = [];
  };

  const flushSectionLoose = () => {
    if (!currentSection) return;
    const textValue = normalizeChunkText(sectionLooseBuffer);
    if (!textValue) return;
    chunks.push({
      chunkText: textValue,
      section: currentSection,
      subsection: `${currentSection}.0`,
      title: currentTitle,
    });
    sectionLooseBuffer = [];
  };

  for (const lineRaw of contentLines) {
    const line = lineRaw.trim();
    if (!line) continue;

    const sectionMatch = line.match(/^Section\s+(\d+)\.\s*(.+)$/i);
    if (sectionMatch) {
      flushSubsection();
      flushSectionLoose();
      currentSection = sectionMatch[1];
      currentTitle = sectionMatch[2];
      currentSubsection = undefined;
      continue;
    }

    const pointMatch = line.match(/^(\d+\.\d+(?:\.\d+)?)\s+(.+)$/);
    if (pointMatch) {
      flushSubsection();
      currentSubsection = pointMatch[1];
      if (!currentSection) {
        currentSection = currentSubsection.split(".")[0];
      }
      currentBuffer = [pointMatch[2].trim()];
      continue;
    }

    if (!currentSection) {
      currentSection = "1";
      currentTitle = header.documentTitle ?? "General";
    }

    if (currentSubsection) {
      currentBuffer.push(line);
    } else {
      sectionLooseBuffer.push(line);
    }
  }

  flushSubsection();
  flushSectionLoose();

  if (chunks.length === 0) {
    const compact = text.replace(/\s+/g, " ").trim();
    if (compact) {
      chunks.push({
        chunkText: compact,
        section: "1",
        subsection: "1.1",
        title: header.documentTitle ?? "General",
      });
    }
  }

  return chunks;
}

function domainFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function normalizeDocumentId(base: string): string {
  const withoutYearSuffix = base.replace(/_\d{4}$/, "");
  return withoutYearSuffix.replace(/\.txt$/i, "");
}

function main() {
  const files = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith(".txt"));
  if (files.length === 0) {
    console.warn(`No TXT files found in corpus directory: ${CORPUS_DIR}`);
  }

  const out = fs.createWriteStream(OUTPUT_FILE, { flags: "w" });
  for (const fileName of files) {
    const filePath = path.join(CORPUS_DIR, fileName);
    const text = fs.readFileSync(filePath, "utf-8");
    const base = fileName.replace(/\.txt$/, "");
    const lines = text.split(/\r?\n/);
    const header = parseStructuredHeader(lines);
    const year = header.year ?? extractYear(fileName);
    const normalizedBase = normalizeDocumentId(base);
    const inferredType = docTypeMap[normalizedBase] || docTypeMap[base] || "other";
    const category = header.category || inferredType;
    const documentType = category;
    const documentTitle = header.documentTitle || normalizedBase;
    const source = header.source || domainFromUrl(header.url) || "local";
    const chunks = chunkDocument(text);

    for (const chunk of chunks) {
      const detectedReferences = detectReferences(chunk.chunkText);
      const metadata = {
        documentId: normalizedBase,
        fileName,
        year,
        documentType,
        category,
        source,
        documentTitle,
        url: header.url,
        scrapedAt: header.scrapedAt,
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
