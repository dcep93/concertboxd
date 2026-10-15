/** Only four fixed public table documents; no user-table reads or arbitrary paths. */
import { readFile } from "node:fs/promises";
import { catalogTables, requireThat, sha256 } from "../data/catalogRequest";
import { adminRest, googleAuth, documentRoot, type FirestoreDocument } from "./firestoreRest";

export async function catalogCloud() {
  const credentials = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS!, "utf8"));
  requireThat(credentials.type === "external_account" && !credentials.private_key, "Catalog access requires keyless federation");
  const api = await adminRest(["https://www.googleapis.com/auth/datastore"]);
  return catalogTransport(api.request);
}

/** Injectable HTTP transport for localhost integration tests; document paths stay fixed. */
export function catalogTransport(request: (path: string, body?: Record<string, any>) => Promise<any>) {
  return {
    begin: async () => {
      const { transaction } = await request(":beginTransaction", { options: { readWrite: {} } });
      requireThat(typeof transaction === "string" && transaction.length > 0, "Missing Firestore transaction");
      return transaction;
    },
    read: async (transaction?: string): Promise<FirestoreDocument[]> => {
      const result = await request(":batchGet", { documents: catalogTables.map(table => `${documentRoot}/tables/${table}`), ...(transaction ? { transaction } : {}) });
      requireThat(Array.isArray(result) && result.length === catalogTables.length && result.every(item => item.found && !item.missing), "Missing catalog batch result");
      return result.map(item => item.found);
    },
    commit: async (writes: unknown[], transaction: string) => { await request(":commit", { writes, transaction }); },
    rollback: async (transaction: string) => { await request(":rollback", { transaction }); },
  };
}

export async function privateBackup(docs: FirestoreDocument[], requestHash: string) {
  const bucket = process.env.CATALOG_BACKUP_BUCKET;
  requireThat(bucket && /^[a-z0-9][a-z0-9._-]{2,62}$/.test(bucket), "Private backup bucket required");
  const auth = googleAuth(["https://www.googleapis.com/auth/devstorage.read_write"]);
  const token = await auth.getAccessToken(); requireThat(token, "No backup credential");
  const headers = { Authorization: `Bearer ${token}` };
  const root = `https://storage.googleapis.com/storage/v1/b/${bucket}`;
  const response = await fetch(root, { headers });
  requireThat(response.ok, "Cannot verify private backup bucket");
  const metadata = await response.json();
  requireThat(metadata.iamConfiguration?.publicAccessPrevention === "enforced"
    && metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled === true, "Backup bucket must enforce private uniform access");
  requireThat(docs.every(doc => catalogTables.some(table => doc.name === `${documentRoot}/tables/${table}`)), "Backup contains unexpected documents");
  const contents = JSON.stringify({ version: 1, requestHash, codeCommit: process.env.GITHUB_SHA, fetchedAt: new Date().toISOString(), tables: docs });
  const backupHash = sha256(contents);
  const name = `catalog/${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT}/${backupHash}.json`;
  const upload = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(name)}`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: contents,
  });
  requireThat(upload.ok, "Private backup upload failed; no database writes attempted");
  const saved = await upload.json(); requireThat(saved.generation && saved.name === name, "Backup acknowledgement missing");
  const readback = await fetch(`${root}/o/${encodeURIComponent(name)}?alt=media&generation=${saved.generation}`, { headers });
  requireThat(readback.ok && sha256(await readback.text()) === backupHash, "Private backup readback failed");
}
