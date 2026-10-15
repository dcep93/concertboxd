import test from "node:test";
import assert from "node:assert/strict";
import { parseRequest, projectRequest, sha256, type CatalogRequest } from "../data/catalogRequest";
import { assertGate, assertIssue, checkGithub } from "../scripts/catalogGithub";
import { applyReviewed, documentHash, projectDocuments, type CatalogIO } from "../scripts/catalogPlan";
import { encode, documentRoot, type FirestoreDocument } from "../scripts/firestoreRest";
import type { TableBackup } from "../data/migrateTables";

const source = "https://example.org/events/show";
function request(): CatalogRequest {
  return { version: 1, mode: "apply", request_id: "test-request-001", public_catalog_only: true, operations: [
    { op: "add", table: "artists", id: "art001", values: { name: "Artist" }, sources: [source] },
    { op: "add", table: "venues", id: "ven001", values: { name: "Venue", timezone: "America/New_York" }, sources: [source] },
    { op: "add", table: "concerts", id: "evt001", values: { artist_id: "art001", venue_id: "ven001", date: "2027-05-01T20:00:00-04:00", date_precision: "time" }, sources: [source] },
  ] };
}
const empty = (): TableBackup => ({ artists: {}, venues: {}, concerts: {}, schedules: {}, users: {}, user_concerts: {} });
const parse = (value: unknown) => parseRequest(JSON.stringify(value));
function docs(): FirestoreDocument[] {
  return ["artists", "venues", "concerts", "schedules"].map(table => ({ name: `${documentRoot}/tables/${table}`, updateTime: "2026-10-15T00:00:00Z", fields: encode({ schema_version: 1, records: {}, preserved_metadata: "keep" }).mapValue.fields }));
}
test("strict versioned request adds artist, venue, concert using existing correction engine", () => {
  const req = parse(request()); const before = empty(); before.users = { owner: { user_id: "owner", username: "Owner" } };
  const after = projectRequest(before, req, "hash", {});
  assert.equal(after.prepared.concerts.evt001.date.toDate().toISOString(), "2027-05-02T00:00:00.000Z");
  assert.deepEqual(after.prepared.users, before.users); assert.deepEqual(before.artists, {});
});
test("reject malformed versions, private fields/tables, deletion, paths, injection, invalid dates, URLs and oversized input", () => {
  const changes: ((r: any) => void)[] = [
    r => { r.version = 2; }, r => { r.public_catalog_only = false; }, r => { r.notes = "private"; },
    r => { r.operations[0].table = "users"; }, r => { r.operations[0].op = "delete"; },
    r => { r.operations[0].path = "tables/users"; }, r => { r.operations[0].id = "../users"; },
    r => { r.operations[0].values.notes = "private"; }, r => { r.operations[0].values.name = "$(curl attacker)"; },
    r => { r.operations[0].values.image = "javascript:alert(1)"; },
    r => { r.operations[0].sources = ["https://user:password@example.org/"]; },
    r => { r.operations[0].sources = ["https://example.org/?token=secret"]; },
    r => { r.operations[0].sources = ["https://127.0.0.1/"]; }, r => { r.operations[0].sources = []; },
    r => { r.operations[2].values.date = "2027-02-30T00:00:00Z"; }, r => { r.operations[2].values.date = "2027-05-01"; },
    r => { r.operations[1].values.timezone = "Mars/Olympus"; }, r => { r.operations.push(r.operations[0]); },
    r => { r.operations = Array(26).fill(r.operations[0]); }, r => { r.mode = "smoke"; },
  ];
  for (const change of changes) { const req = request(); change(req); assert.throws(() => parse(req)); }
  assert.throws(() => parseRequest("{")); assert.throws(() => parseRequest(" ".repeat(32769)));
  assert.throws(() => parseRequest('{"__proto__":{}}'), /Unsafe/);
});
test("references, ID collisions, date range and timezone offset fail closed", () => {
  const missing = request(); missing.operations[2].values.artist_id = "absent";
  assert.throws(() => projectRequest(empty(), parse(missing), "hash", {}), /Broken/);
  const before = empty(); before.artists.art001 = { name: "Existing" };
  assert.throws(() => projectRequest(before, request(), "hash", {}), /already exists/);
  const offset = request(); offset.operations[2].values.date = "2027-05-01T20:00:00-05:00";
  assert.throws(() => projectRequest(empty(), parse(offset), "hash", {}), /offset/);
  const range = request(); range.operations[2].values.end_date = "2027-04-01";
  assert.throws(() => projectRequest(empty(), parse(range), "hash", {}), /End date/);
  const day = request(); day.operations[2].values.date_precision = "day";
  day.operations[2].values.date = "2027-05-01T20:30:00Z";
  assert.throws(() => projectRequest(empty(), parse(day), "hash", {}), /UTC midnight/);
});
test("duplicate event identity ignores cosmetic concert title differences", () => {
  const req = request(); req.operations.push({ ...req.operations[2], id: "evt002", values: { ...req.operations[2].values, name: "Other title" } });
  assert.throws(() => projectRequest(empty(), parse(req), "hash", {}), /Duplicate event/);
});
test("every updated field needs expectations; stale values reject even when desired value already exists", () => {
  const before = empty(); before.artists.art001 = { name: "Artist", image: "https://example.org/new.jpg" };
  const req = request(); req.operations = [{ op: "update", table: "artists", id: "art001", values: { image: "https://example.org/new.jpg" }, expected: { image: "https://example.org/old.jpg" }, expected_absent: [], sources: [source] }];
  assert.throws(() => projectRequest(before, parse(req), "hash", {}), /Stale/);
  req.operations[0].expected = {}; assert.throws(() => parse(req), /precondition/);
  req.operations[0].expected_absent = ["image"]; assert.throws(() => projectRequest(before, parse(req), "hash", {}), /Stale/);
  delete before.artists.art001.image;
  assert.equal(projectRequest(before, parse(req), "hash", {}).prepared.artists.art001.image, "https://example.org/new.jpg");
});

function issue() { return { number: 7, title: "[catalog-change:v1]", body: JSON.stringify(request()), state: "open", user: { id: 12521665, login: "dcep93" }, created_at: "now", updated_at: "now" }; }
test("issue checks reject unauthorized, edited, closed, replaced and PR requests", async () => {
  assertIssue(issue(), issue());
  for (const change of [{ user: { id: 1, login: "dcep93" } }, { state: "closed" }, { body: "changed" }, { updated_at: "later" }, { title: "changed" }, { number: 8 }, { pull_request: {} }, { locked: true }]) {
    assert.throws(() => assertIssue(issue(), { ...issue(), ...change }));
  }
  assert.throws(() => assertIssue({ ...issue(), updated_at: "later" }, { ...issue(), updated_at: "later" }));
  await assert.rejects(() => checkGithub({}), /Untrusted workflow/);
});
function gate() { return { id: 42, name: "catalog-production", can_admins_bypass: false, protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { id: 12521665 } }] }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }; }
const branches = () => ({ total_count: 1, branch_policies: [{ name: "main", type: "branch" }] });
test("gate must require only owner, no bypass, main branch only, self-review available", () => {
  assertGate(gate(), branches());
  for (const mutation of [
    (g: any) => { g.can_admins_bypass = true; }, (g: any) => { delete g.can_admins_bypass; },
    (g: any) => { g.protection_rules = []; }, (g: any) => { g.protection_rules[0].prevent_self_review = true; },
    (g: any) => { g.protection_rules[0].reviewers[0].reviewer.id = 1; },
    (g: any) => { g.protection_rules[0].reviewers.push({ type: "Team", reviewer: { id: 8 } }); },
  ]) { const g = gate(); mutation(g); assert.throws(() => assertGate(g, branches())); }
  assert.throws(() => assertGate(gate(), { ...branches(), total_count: 2 }));
  assert.throws(() => assertGate(gate(), { total_count: 1, branch_policies: [{ name: "main", type: "tag" }] }));
});

function harness() {
  let live = docs(); const calls: string[] = []; let failCommit = false, failBackup = false, failCheck = false, badReadback = false;
  const io: CatalogIO = {
    begin: async () => { calls.push("begin"); return "transaction"; },
    read: async () => { calls.push("read"); return structuredClone(live); },
    backup: async data => { calls.push("backup"); assert.deepEqual(data, live); if (failBackup) throw Error("backup failure"); },
    recheck: async () => { calls.push("check"); if (failCheck) throw Error("issue edited"); },
    commit: async (writes, transaction) => {
      calls.push("commit"); assert.equal(transaction, "transaction");
      if (failCommit) throw Error("ABORTED concurrent edit");
      for (const write of writes) { const index = live.findIndex(doc => doc.name === write.update.name); assert.equal(write.currentDocument.updateTime, live[index].updateTime); live[index] = { ...write.update, updateTime: "2026-10-15T01:00:00Z" }; }
      if (badReadback) live[0].fields = encode({ schema_version: 1, records: {} }).mapValue.fields;
    },
    rollback: async () => { calls.push("rollback"); },
  };
  const req = request(), hash = sha256(JSON.stringify(req)), plan = projectDocuments(live, req, hash), baseline = documentHash(live);
  return { io, calls, req, hash, plan, baseline, live: () => live, failCommit: () => { failCommit = true; }, failBackup: () => { failBackup = true; }, failCheck: () => { failCheck = true; }, badReadback: () => { badReadback = true; } };
}
test("atomic commit follows private backup and final issue check, reads back receipts, preserves envelopes", async () => {
  const h = harness(); assert.equal(await applyReviewed(h.io, h.req, h.hash, h.baseline, h.plan.diff), "verified");
  assert.deepEqual(h.calls, ["begin", "read", "backup", "check", "commit", "read"]);
  assert.equal(h.live()[0].fields.preserved_metadata.stringValue, "keep");
  assert.equal(h.plan.writes.length, 3); assert.ok(h.plan.writes.every(w => !/users|schedules/.test(w.update.name)));
});
test("stale preview or altered diff stops before backup/write", async () => {
  for (const change of ["live", "diff"]) {
    const h = harness(); if (change === "live") h.live()[3].updateTime = "newer";
    await assert.rejects(() => applyReviewed(h.io, h.req, h.hash, h.baseline, change === "diff" ? [] : h.plan.diff), /changed after preview/);
    assert.deepEqual(h.calls, ["begin", "read", "rollback"]);
  }
});
test("backup failure, late issue edits and concurrent commits fail without automatic rebase", async () => {
  for (const fail of ["failBackup", "failCheck", "failCommit"] as const) {
    const h = harness(); h[fail](); await assert.rejects(() => applyReviewed(h.io, h.req, h.hash, h.baseline, h.plan.diff));
    assert.equal(h.calls.at(-1), "rollback"); assert.equal(h.live()[0].fields.records.mapValue.fields.art001, undefined);
    if (fail !== "failCommit") assert.ok(!h.calls.includes("commit"));
  }
});
test("reruns preserve newer edits, receipt conflicts fail and bad readback reports failure", async () => {
  const h = harness(); await applyReviewed(h.io, h.req, h.hash, h.baseline, h.plan.diff);
  h.live()[0].fields.records.mapValue.fields.art001.mapValue.fields.name = { stringValue: "Later edit" };
  h.calls.length = 0;
  assert.equal(await applyReviewed(h.io, h.req, h.hash, h.baseline, h.plan.diff), "already-applied");
  assert.deepEqual(h.calls, ["begin", "read", "check", "rollback"]);
  await assert.rejects(() => applyReviewed(h.io, h.req, "different-hash", h.baseline, h.plan.diff), /Previously applied/);
  const bad = harness(); bad.badReadback(); await assert.rejects(() => applyReviewed(bad.io, bad.req, bad.hash, bad.baseline, bad.plan.diff), /verification failed/);
});
test("smoke requires empty operations and cannot call database writer", async () => {
  const req = parse({ ...request(), mode: "smoke", operations: [] }); const h = harness();
  await assert.rejects(() => applyReviewed(h.io, req, "hash", "", []), /never enter/); assert.deepEqual(h.calls, []);
});
