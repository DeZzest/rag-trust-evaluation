import { PDFParse } from "pdf-parse";
import { SectionSeed } from "../normalizer/structure.builder";
import { cleanText } from "../normalizer/text.cleaner";

export interface ParsedPdfDocument {
  title: string;
  rawText: string;
  sections: SectionSeed[];
}

const MAJOR_HEADING_PATTERNS: RegExp[] = [
  /^\d+\.\s+.+/,
  /^(section|розділ)\s+\d+/i,
];

const SUB_HEADING_PATTERN = /^\d+\.\d+(\.\d+)?\s+.+/;

function isMajorHeading(line: string): boolean {
  return MAJOR_HEADING_PATTERNS.some((pattern) => pattern.test(line));
}

function inferTitle(rawText: string, fallback?: string): string {
  if (fallback && fallback.trim().length > 0) return fallback.trim();
  const firstLines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  return firstLines[0] || "PDF document";
}

function buildSectionsFromPdfText(rawText: string, documentTitle: string): SectionSeed[] {
  const normalized = cleanText(rawText);
  if (!normalized) return [];

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sections: SectionSeed[] = [];
  let currentHeading = documentTitle;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length === 0) return;
    sections.push({
      heading: currentHeading,
      lines: currentLines,
    });
    currentLines = [];
  };

  for (const line of lines) {
    if (isMajorHeading(line)) {
      flush();
      currentHeading = line;
      continue;
    }

    if (SUB_HEADING_PATTERN.test(line)) {
      currentLines.push(line);
      continue;
    }

    currentLines.push(line);
  }
  flush();

  if (sections.length > 0) return sections;

  // Fallback: split the document into logical blocks of lines.
  const fallbackSections: SectionSeed[] = [];
  const blockSize = 12;
  for (let i = 0; i < lines.length; i += blockSize) {
    const chunk = lines.slice(i, i + blockSize);
    if (chunk.length === 0) continue;
    fallbackSections.push({
      heading: `${documentTitle} (part ${Math.floor(i / blockSize) + 1})`,
      lines: chunk,
    });
  }

  return fallbackSections;
}

export async function parsePdfBuffer(
  pdfBuffer: Buffer,
  fallbackTitle?: string
): Promise<ParsedPdfDocument> {
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });

  let rawText = "";
  let title = fallbackTitle;
  try {
    const textResult = await parser.getText();
    rawText = textResult.text || textResult.pages.map((page) => page.text).join("\n");

    try {
      const infoResult = await parser.getInfo();
      const docTitle =
        typeof infoResult.info?.Title === "string"
          ? infoResult.info.Title
          : undefined;
      if (docTitle && docTitle.trim().length > 0) title = docTitle;
    } catch {
      // Metadata can be missing in many PDFs; text extraction is still usable.
    }
  } finally {
    await parser.destroy();
  }

  title = inferTitle(rawText, title);
  const sections = buildSectionsFromPdfText(rawText, title);

  return {
    title,
    rawText,
    sections,
  };
}
