import { cleanTextLines } from "./text.cleaner";

export interface SectionSeed {
  heading?: string;
  lines: string[];
}

export interface StructuredDocumentInput {
  documentTitle: string;
  source: string;
  year?: number;
  category: string;
  url: string;
  scrapedAt: string;
  sections: SectionSeed[];
}

function sanitizeHeading(heading?: string): string {
  if (!heading) return "";
  return heading
    .replace(/^section\s+\d+\.?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLongSentence(line: string, maxLength = 500): string[] {
  if (line.length <= maxLength) return [line];

  const parts = line
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) return [line];
  return parts;
}

function normalizeSectionLines(lines: string[]): string[] {
  const cleaned = cleanTextLines(lines);
  const normalized: string[] = [];
  for (const line of cleaned) {
    for (const split of splitLongSentence(line)) {
      const compact = split.replace(/\s+/g, " ").trim();
      if (compact.length > 0) normalized.push(compact);
    }
  }
  return normalized;
}

export function buildStructuredDocument(input: StructuredDocumentInput): string {
  const docTitle = input.documentTitle.trim() || "Untitled document";
  const source = input.source.trim() || "unknown";
  const category = input.category.trim() || "other";

  const out: string[] = [];
  out.push(`Document: ${docTitle}`);
  out.push(`Source: ${source}`);
  if (typeof input.year === "number" && Number.isFinite(input.year)) {
    out.push(`Year: ${input.year}`);
  }
  out.push(`Category: ${category}`);
  out.push(`URL: ${input.url}`);
  out.push(`ScrapedAt: ${input.scrapedAt}`);
  out.push("");

  const usableSections = input.sections
    .map((section) => ({
      heading: sanitizeHeading(section.heading),
      lines: normalizeSectionLines(section.lines),
    }))
    .filter((section) => section.lines.length > 0);

  if (usableSections.length === 0) {
    const fallbackHeading = sanitizeHeading(docTitle) || "General";
    out.push(`Section 1. ${fallbackHeading}`);
    out.push("1.1 No structured content extracted.");
    return out.join("\n");
  }

  for (let sectionIndex = 0; sectionIndex < usableSections.length; sectionIndex++) {
    const sectionNumber = sectionIndex + 1;
    const section = usableSections[sectionIndex];
    const sectionHeading = section.heading || `Section ${sectionNumber}`;
    out.push(`Section ${sectionNumber}. ${sectionHeading}`);

    for (let itemIndex = 0; itemIndex < section.lines.length; itemIndex++) {
      const subsection = `${sectionNumber}.${itemIndex + 1}`;
      out.push(`${subsection} ${section.lines[itemIndex]}`);
    }

    if (sectionIndex < usableSections.length - 1) {
      out.push("");
    }
  }

  return out.join("\n");
}
