import "dotenv/config";
import {
  getCollectionCount,
  getExistingSnapshotCollection,
  getSnapshotRecordsPage,
} from "../vector-db/chroma.service";
import { loadVerifiedSnapshotIndexPlan } from "./snapshot.index";
import { auditExistingSnapshotIndex } from "./snapshot.audit";

interface CliOptions {
  snapshotDir: string;
  expectedSnapshot: string;
}

export function parseAuditArgs(args: string[]): CliOptions {
  let snapshotDir: string | undefined;
  let expectedSnapshot: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const field = args[i];
    if (!["--snapshot-dir", "--expected-snapshot"].includes(field) ||
        seen.has(field)) throw new Error("Unknown or duplicate argument: " + field);
    seen.add(field);
    const value = args[++i];
    if (!value || value.startsWith("--")) {
      throw new Error("Missing value for " + field);
    }
    if (field === "--snapshot-dir") snapshotDir = value;
    else expectedSnapshot = value;
  }
  if (!snapshotDir || !expectedSnapshot) {
    throw new Error("Usage: npm run corpus:audit-index -- " +
      "--snapshot-dir data/corpus_snapshots/<label> " +
      "--expected-snapshot sha256:<64-lowercase-hex>");
  }
  return { snapshotDir, expectedSnapshot };
}

async function main(): Promise<void> {
  try {
    const args = parseAuditArgs(process.argv.slice(2));
    const result = await auditExistingSnapshotIndex(
      args.snapshotDir,
      args.expectedSnapshot,
      {
        verifySnapshot: loadVerifiedSnapshotIndexPlan,
        findExistingCollection: getExistingSnapshotCollection,
        getCollectionCount,
        getPage: getSnapshotRecordsPage,
      }
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Read-only snapshot collection audit failed:",
      error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
if (require.main === module) void main();
