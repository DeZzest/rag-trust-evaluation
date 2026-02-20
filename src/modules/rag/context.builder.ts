import { ContextTraceItem, RetrievedChunk } from "./types";

function getSectionLabel(chunk: RetrievedChunk): string {
  if (chunk.subsection && chunk.subsection.trim().length > 0) {
    return chunk.subsection;
  }
  if (chunk.section && chunk.section.trim().length > 0) {
    return chunk.section;
  }
  return "na";
}

export function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk) => {
      const label = `[${chunk.documentId}_${chunk.documentYear ?? "na"} | Section ${getSectionLabel(
        chunk
      )} | Confidence ${chunk.confidence.toFixed(2)}]`;
      return `${label}\n${chunk.text}`;
    })
    .join("\n\n");
}

export function buildContextTrace(chunks: RetrievedChunk[]): ContextTraceItem[] {
  return chunks.map((chunk, index) => {
    const sectionLabel = getSectionLabel(chunk);
    return {
      citationNumber: index + 1,
      sourceId: chunk.id,
      documentId: chunk.documentId,
      documentYear: chunk.documentYear,
      section: chunk.section,
      subsection: chunk.subsection,
      confidence: chunk.confidence,
      label: `${chunk.documentId}_${chunk.documentYear ?? "na"} | Section ${sectionLabel}`,
    };
  });
}
