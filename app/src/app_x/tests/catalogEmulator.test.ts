/** Real REST transaction semantics against localhost only. Never authenticates to Google. */
import test from "node:test";
import assert from "node:assert/strict";
import { applyReviewed, documentHash, projectDocuments, type CatalogIO } from "../scripts/catalogPlan";
import { documentRoot, encode } from "../scripts/firestoreRest";
import { catalogTransport } from "../scripts/catalogCloud";
import { catalogTables, sha256, type CatalogRequest } from "../data/catalogRequest";

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || "", /^127\.0\.0\.1:\d+$/, "Local emulator required; production tests forbidden");
const root = "projects/demo-concertboxd-catalog/databases/(default)/documents";
const endpoint = `http://${host}/v1/${root}`;
async function api(path: string, body?: unknown) {
  const response = await fetch(endpoint + path, { signal: AbortSignal.timeout(30000), method: body ? "POST" : "GET", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `Emulator REST HTTP ${response.status}`);
  return response.json();
}
const req: CatalogRequest = { version: 1, mode: "apply", request_id: "real-rest-test", public_catalog_only: true, operations: [
  { op: "add", table: "artists", id: "abc123", values: { name: "New artist" }, sources: ["https://example.org/artist"] },
] };
const hash = sha256(JSON.stringify(req));
async function reset() {
  await api(":commit", { writes: [...catalogTables, "users"].map(table => ({ update: { name: `${root}/tables/${table}`, fields: encode({ schema_version: 1, records: table === "users" ? { private: { notes: "untouched" } } : {} }).mapValue.fields } })) });
}
function io(): CatalogIO {
  return {
    ...catalogTransport(async (path, body) => {
      const result = await api(path, body ? JSON.parse(JSON.stringify(body).replaceAll(documentRoot, root)) : undefined);
      return JSON.parse(JSON.stringify(result).replaceAll(root, documentRoot));
    }),
    backup: async () => {}, recheck: async () => {},
  };
}
test("real Firestore REST transaction commits the correction and receipt, preserves personal data, and reruns safely", async () => {
  await reset(); const adapter = io(), before = await adapter.read(), plan = projectDocuments(before, req, hash);
  assert.equal(await applyReviewed(adapter, req, hash, documentHash(before), plan.diff), "verified");
  const users = await api("/tables/users"); assert.equal(users.fields.records.mapValue.fields.private.mapValue.fields.notes.stringValue, "untouched");
  assert.equal(await applyReviewed(adapter, req, hash, documentHash(before), plan.diff), "already-applied");
});
test("real commit rejects outdated updateTime atomically, including the receipt", async () => {
  await reset(); const adapter = io(), before = await adapter.read(), plan = projectDocuments(before, req, hash);
  await api(":commit", { writes: [{ update: { name: `${root}/tables/artists`, fields: encode({ schema_version: 1, records: { newer1: { name: "Concurrent" } } }).mapValue.fields } }] });
  await assert.rejects(() => api(":commit", { writes: plan.writes.map(write => ({ ...write, update: { ...write.update, name: write.update.name.replace(documentRoot, root) } })) }));
  const artists = await api("/tables/artists"), concerts = await api("/tables/concerts");
  assert.equal(artists.fields.records.mapValue.fields.newer1.mapValue.fields.name.stringValue, "Concurrent");
  assert.equal(artists.fields.records.mapValue.fields.abc123, undefined); assert.equal(concerts.fields.applied_revisions, undefined);
});
test("real transaction serializes concurrent changes to a read dependency without losing them", async () => {
  await reset(); const adapter = io(), transaction = await adapter.begin(), before = await adapter.read(transaction), plan = projectDocuments(before, req, hash);
  // A read outside the transaction then concurrent write exercises the server's lock/abort behavior.
  // Do not deadlock waiting for a writer blocked by this transaction: start both requests together.
  const edit = api(":commit", { writes: [{ update: { name: `${root}/tables/venues`, fields: encode({ schema_version: 1, records: { venue1: { name: "Concurrent venue", timezone: "America/New_York" } } }).mapValue.fields } }] });
  const result = await Promise.allSettled([edit, adapter.commit(plan.writes, transaction)]);
  // Firestore either serializes the edit after the transaction or aborts the transaction; it cannot lose the edit.
  assert.ok(result.some(item => item.status === "fulfilled"));
  if (result[0].status === "fulfilled") {
    const venues = await api("/tables/venues"); assert.equal(venues.fields.records.mapValue.fields.venue1.mapValue.fields.name.stringValue, "Concurrent venue");
  }
});
