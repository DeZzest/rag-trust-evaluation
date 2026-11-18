import "dotenv/config";
import { generateEmbedding } from "../embeddings/embedding.service";
import {
  addDocuments,
  createExclusiveSnapshotCollection,
  getCollectionCount,
} from "../vector-db/chroma.service";
import {
  executeSnapshotIndex,
  loadVerifiedSnapshotIndexPlan,
} from "./snapshot.index";

interface CliArguments {
  snapshotDir: string;
  expectedSnapshotId: string;
  execute: boolean;
  allowPartial: boolean;
}

function readArgs(argv: string[]): CliArguments {
  let snapshotDir: string | undefined;
  let expectedSnapshotId: string | undefined;
  let execute = false;
  let allowPartial = false;
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (!["--snapshot-dir", "--expected-snapshot", "--execute", "--allow-partial"].includes(option)) {
      throw new Error("Unknown argument: " + option);
    }
    if (seen.has(option)) throw new Error("Duplicate argument: " + option);
    seen.add(option);
    if (option === "--execute") { execute = true; continue; }
    if (option === "--allow-partial") { allowPartial = true; continue; }
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error("Missing value for " + option);
    if (option === "--snapshot-dir") snapshotDir = value;
    if (option === "--expected-snapshot") expectedSnapshotId = value;
  }
  if (!snapshotDir || !expectedSnapshotId) {
    throw new Error(
      "Usage: npm run corpus:index-snapshot -- --snapshot-dir data/corpus_snapshots/<label> " +
      "--expected-snapshot sha256:<64hex> [--execute] [--allow-partial]"
    );
  }
  return { snapshotDir, expectedSnapshotId, execute, allowPartial };
}

async function main(): Promise<void> {
  try {
    const options = readArgs(process.argv.slice(2));
    // Python and Node verify the snapshot before any Ollama/Chroma interaction.
    const plan = loadVerifiedSnapshotIndexPlan(
      options.snapshotDir, options.expectedSnapshotId
    );
    const result = await executeSnapshotIndex(
      plan,
      {
        embed: generateEmbedding,
        createExclusiveCollection: createExclusiveSnapshotCollection,
        addDocuments,
        getCount: getCollectionCount,
      },
      {
        execute: options.execute,
        allowPartial: options.allowPartial,
        activeCollection: process.env.CHROMA_COLLECTION ?? "lute_university_docs",
      }
    );
    console.log(JSON.stringify({
      ...result,
      note: options.execute
        ? "Snapshot indexed into a NEW collection only; active RAG retrieval was not changed."
        : "DRY RUN: validated locally, no network requests, embeddings, or Chroma writes.",
      warning: "Embedding correctness and expert verification of source validity require separate experiments.",
    }, null, 2));
  } catch (error) {
    console.error("Snapshot indexing refused or incomplete:",
      error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) void main();
