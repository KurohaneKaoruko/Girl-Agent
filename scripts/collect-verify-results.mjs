import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const targetDir = path.resolve(process.cwd(), "target");
const fallbackDir = path.resolve(process.cwd());
const tempDir = os.tmpdir();
const searchDirs = [targetDir, fallbackDir, tempDir];

const entries = [
  { key: "smoke", file: "verify-headless-smoke.json" },
  { key: "full", file: "verify-headless-full.json" },
  { key: "fullAbort", file: "verify-headless-full-abort.json" },
];

async function readResult(fileName) {
  for (const baseDir of searchDirs) {
    const filePath = path.join(baseDir, fileName);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        exists: true,
        path: filePath,
        status: parsed.status ?? "unknown",
        failureCode: parsed.failureCode ?? null,
        message: parsed.message ?? "",
        mode: parsed.mode ?? null,
        startedAt: parsed.startedAt ?? null,
        finishedAt: parsed.finishedAt ?? null,
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw new Error(`failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    exists: false,
    path: path.join(targetDir, fileName),
    status: "missing",
    failureCode: null,
    message: "result file not found",
    mode: null,
    startedAt: null,
    finishedAt: null,
  };
}

async function main() {
  const files = {};
  for (const entry of entries) {
    files[entry.key] = await readResult(entry.file);
  }

  const values = Object.values(files);
  const totals = {
    passed: values.filter((item) => item.status === "passed").length,
    failed: values.filter((item) => item.status === "failed").length,
    missing: values.filter((item) => item.status === "missing").length,
  };

  let overallStatus = "passed";
  if (totals.failed > 0) {
    overallStatus = "failed";
  } else if (totals.missing === values.length) {
    overallStatus = "missing";
  } else if (totals.missing > 0) {
    overallStatus = "partial";
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    targetDir,
    searchDirs,
    summaryPath: null,
    overallStatus,
    totals,
    files,
  };

  const candidatePaths = [
    path.join(targetDir, "verify-headless-summary.json"),
    path.resolve(process.cwd(), "verify-headless-summary.json"),
    path.join(os.tmpdir(), "verify-headless-summary.json"),
  ];

  let writtenSummary = null;
  for (const candidate of candidatePaths) {
    try {
      const candidateSummary = {
        ...summary,
        summaryPath: candidate,
      };
      const payload = JSON.stringify(candidateSummary, null, 2);
      await fs.mkdir(path.dirname(candidate), { recursive: true });
      await fs.writeFile(candidate, payload, "utf8");
      writtenSummary = candidateSummary;
      break;
    } catch {
      continue;
    }
  }

  if (!writtenSummary) {
    throw new Error("all summary output paths are not writable");
  }

  console.log(`[verify-summary] wrote ${writtenSummary.summaryPath}`);
  console.log(JSON.stringify(writtenSummary));
}

main().catch((error) => {
  console.error(`[verify-summary] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
