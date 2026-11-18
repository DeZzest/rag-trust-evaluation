import type { RetrievedChunk } from "./types";

const SHA = /^[a-f0-9]{64}$/;
const CHUNK = /^chunk-[a-f0-9]{24}$/;

/**
 * Fail closed BEFORE giving retrieved context to an LLM.
 * This verifies returned evidence, not every stored vector in ChromaDB.
 */
export function assertSnapshotEvidence(
  sources: ReadonlyArray<RetrievedChunk>,
  expectedSnapshotId: string
): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedSnapshotId)) {
    throw new Error("snapshot evidence: invalid expected snapshot ID");
  }
  for (const [index, item] of sources.entries()) {
    const md = item.metadata;
    if (!md ||
        md.corpusSnapshotId !== expectedSnapshotId ||
        md.reviewStatus !== "approved" ||
        typeof md.documentId !== "string" || !md.documentId.trim() ||
        typeof md.documentVersion !== "string" || !md.documentVersion.trim() ||
        typeof md.chunkId !== "string" || !CHUNK.test(md.chunkId) ||
        item.id !== md.chunkId ||
        typeof md.pageNumber !== "number" || !Number.isInteger(md.pageNumber) ||
        md.pageNumber < 1 ||
        typeof md.sourcePdfSha256 !== "string" || !SHA.test(md.sourcePdfSha256) ||
        typeof md.reviewedTextSha256 !== "string" || !SHA.test(md.reviewedTextSha256)) {
      throw new Error(
        "snapshot evidence: retrieved chunk " + (index + 1) +
        " is missing approved page-level provenance; answer generation blocked"
      );
    }
  }
}
