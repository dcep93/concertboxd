/** Fixed CLI modes; never accepts issue data as command-line arguments. */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { parseRequest, requireThat, sha256 } from "../data/catalogRequest";
import { checkGithub, repository } from "./catalogGithub";
import { applyReviewed, documentHash, projectDocuments } from "./catalogPlan";
import { catalogCloud, privateBackup } from "./catalogCloud";

const mode = process.argv[2];
requireThat(["validate", "preview", "authorize", "apply"].includes(mode), "Unknown CLI mode");
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, "utf8"));
const work = process.env.CATALOG_WORK_DIR!;
requireThat(work && process.env.GITHUB_ACTIONS === "true", "GitHub-only entry point");
const approved = mode === "authorize" || mode === "apply";
const snapshot = await checkGithub(event, approved);
const request = parseRequest(snapshot.body);
await mkdir(work, { recursive: true });
const output = async (key: string, value: string) => appendFile(process.env.GITHUB_OUTPUT!, `${key}=${value}\n`);
const summary = async (value: string) => appendFile(process.env.GITHUB_STEP_SUMMARY!, value);
const escaped = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

if (mode === "validate") {
  await output("mode", request.mode);
} else if (mode === "preview") {
  let baseline = "", diff: unknown = [], alreadyApplied = false;
  if (request.mode === "apply") {
    const api = await catalogCloud(); const docs = await api.read();
    const projected = projectDocuments(docs, request, snapshot.requestHash);
    baseline = documentHash(docs); diff = projected.diff; alreadyApplied = projected.alreadyApplied;
  }
  const plan = { version: 1, ...snapshot, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, baseline, diff, alreadyApplied };
  const contents = JSON.stringify(plan, null, 2);
  await writeFile(`${work}/review.json`, contents, { flag: "wx", mode: 0o600 });
  await output("plan_hash", sha256(contents));
  await summary(`Approval comment required for this exact attempt: \`approve ${sha256(contents)}\`\n\n`);
  await summary(`## Catalog ${request.mode === "smoke" ? "NO-WRITE SMOKE TEST" : "review"}\n\nIssue: https://github.com/${repository}/issues/${snapshot.issue}\n\nRequest SHA-256: \`${snapshot.requestHash}\`\n\nCode commit: \`${snapshot.codeCommit}\`\n\nReview plan SHA-256: \`${sha256(contents)}\`\n\nAlready applied: ${alreadyApplied}\n\nApprove only this diff and these public sources. The assistant must NEVER approve its own deployment.\n\n<pre>${escaped(JSON.stringify(diff, null, 2))}</pre>\n\nExact request (JSON string, preserving whitespace):\n<pre>${escaped(JSON.stringify(snapshot.body))}</pre>\n`);
} else {
  const contents = await readFile(`${work}/review.json`, "utf8");
  requireThat(sha256(contents) === process.env.CATALOG_PLAN_HASH, "Review artifact hash mismatch");
  const plan = JSON.parse(contents);
  requireThat(plan.version === 1 && plan.runId === process.env.GITHUB_RUN_ID && plan.attempt === process.env.GITHUB_RUN_ATTEMPT
    && plan.body === snapshot.body && plan.issue === snapshot.issue && plan.codeCommit === snapshot.codeCommit
    && plan.requestHash === snapshot.requestHash, "Review artifact belongs to a different request, commit or attempt; rerun all jobs");
  if (mode === "authorize") await output("mode", request.mode);
  else if (request.mode === "smoke") await summary("## No-write smoke passed\n\nOwner approval, gate settings, immutable request and artifact verified. No Google authentication or Firestore/storage access occurred. Production access remains untested.\n");
  else {
    requireThat(process.env.CATALOG_PRODUCTION_ENABLED === "true", "Production access has not been enabled after setup verification");
    const api = await catalogCloud();
    const result = await applyReviewed({ ...api,
      backup: docs => privateBackup(docs, snapshot.requestHash),
      recheck: async () => { await checkGithub(event, true); },
    }, request, snapshot.requestHash, plan.baseline, plan.diff);
    await summary(`## Catalog result: ${result}\n\nRequest SHA-256: \`${snapshot.requestHash}\`\n\nCode commit: \`${snapshot.codeCommit}\`\n\n${result === "verified" ? "Atomic write and receipt read back successfully." : "Matching receipt found. No writes; subsequent edits preserved."}\n`);
  }
}
