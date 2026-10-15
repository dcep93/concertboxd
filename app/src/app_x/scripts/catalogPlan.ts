import { isDeepStrictEqual as equal } from "node:util";
import { catalogTables, fields, projectRequest, requireThat, sha256, type CatalogRequest } from "../data/catalogRequest";
import type { TableBackup } from "../data/migrateTables";
import { decode, encode, documentRoot, type FirestoreDocument } from "./firestoreRest";

export function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
export const documentHash = (docs: FirestoreDocument[]) => sha256(canonical([...docs].sort((a, b) => a.name.localeCompare(b.name))));
export function projectDocuments(docs: FirestoreDocument[], request: CatalogRequest, hash: string) {
  requireThat(docs.length === catalogTables.length, "Missing catalog tables");
  const current = { users: {}, user_concerts: {} } as TableBackup;
  const envelopes: Record<string, any> = {};
  for (const table of catalogTables) {
    const found = docs.filter(doc => doc.name === `${documentRoot}/tables/${table}`);
    requireThat(found.length === 1 && found[0].updateTime, "Unexpected catalog document");
    const envelope = decode({ mapValue: { fields: found[0].fields } });
    requireThat(envelope.schema_version === 1 && envelope.records && !Array.isArray(envelope.records), "Catalog migration required");
    envelopes[table] = envelope; current[table] = envelope.records;
  }
  const result = projectRequest(current, request, hash, envelopes.concerts.applied_revisions || {});
  const diff = result.pending.length ? request.operations.map(op => {
    const before = current[op.table][op.id]; const after = result.prepared[op.table][op.id];
    // Only public requested fields, never complete table envelopes or private data.
    const publicRow = (row: any) => row ? Object.fromEntries(Object.entries(row).filter(([key]) => fields[op.table].includes(key as never)).map(([key, value]) => [key, encode(value)])) : null;
    return { table: op.table, id: op.id, before: publicRow(before), after: publicRow(after), sources: op.sources };
  }) : [];
  const writes = result.pending.length ? (["artists", "venues", "concerts"] as const).filter(table => table === "concerts" || !equal(result.prepared[table], current[table])).map(table => {
    const doc = docs.find(doc => doc.name === `${documentRoot}/tables/${table}`)!;
    const envelope = { ...envelopes[table], records: result.prepared[table], ...(table === "concerts" ? { applied_revisions: result.receipts } : {}) };
    const encoded = encode(envelope).mapValue.fields;
    requireThat(Buffer.byteLength(JSON.stringify(encoded)) < 950_000, "Table plus receipts exceeds safe size");
    return { update: { name: doc.name, fields: encoded }, currentDocument: { updateTime: doc.updateTime } };
  }) : [];
  return { diff, writes, alreadyApplied: !result.pending.length };
}

export interface CatalogIO {
  begin(): Promise<string>;
  read(transaction?: string): Promise<FirestoreDocument[]>;
  backup(docs: FirestoreDocument[]): Promise<void>;
  recheck(): Promise<void>;
  commit(writes: ReturnType<typeof projectDocuments>["writes"], transaction: string): Promise<void>;
  rollback(transaction: string): Promise<void>;
}
export async function applyReviewed(io: CatalogIO, request: CatalogRequest, hash: string, baseline: string, diff: unknown) {
  requireThat(request.mode === "apply", "Smoke requests never enter the writer");
  const transaction = await io.begin();
  let committed = false;
  try {
    const docs = await io.read(transaction);
    const projected = projectDocuments(docs, request, hash);
    if (projected.alreadyApplied) { await io.recheck(); return "already-applied"; }
    requireThat(documentHash(docs) === baseline && equal(projected.diff, diff), "Live catalog changed after preview; submit a fresh issue");
    await io.backup(docs);
    await io.recheck(); // Last external check before atomic commit. No issue/Firestore distributed transaction exists.
    await io.commit(projected.writes, transaction); committed = true;
    const verified = await io.read();
    for (const write of projected.writes) {
      const doc = verified.find(doc => doc.name === write.update.name);
      requireThat(doc && equal(decode({ mapValue: { fields: doc.fields } }), decode({ mapValue: { fields: write.update.fields } })), "Post-commit verification failed; inspect receipt and private backup before retrying");
    }
    return "verified";
  } finally {
    if (!committed) await io.rollback(transaction);
  }
}
