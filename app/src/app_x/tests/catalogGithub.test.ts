import test from "node:test";
import assert from "node:assert/strict";
import { checkGithub, workflowRef } from "../scripts/catalogGithub";

async function scenario(change: (fixture: any) => void = () => {}, approved = true) {
  const previousEnv = { ...process.env }, originalFetch = globalThis.fetch;
  const issue = { number: 1, title: "[catalog-change:v1]", body: '{"version":1}', user: { id: 12521665, login: "dcep93" }, state: "open", created_at: "now", updated_at: "now" };
  const fixture = {
    env: { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "issues", GITHUB_ACTOR_ID: "12521665", GITHUB_REPOSITORY: "dcep93/concertboxd", GITHUB_REPOSITORY_ID: "1409422243", GITHUB_REF: "refs/heads/main", GITHUB_WORKFLOW_REF: workflowRef, GITHUB_SHA: "a".repeat(40), GITHUB_WORKFLOW_SHA: "a".repeat(40), GITHUB_TRIGGERING_ACTOR: "dcep93", GITHUB_RUN_ID: "123", CATALOG_PLAN_HASH: "b".repeat(64) },
    event: { action: "opened", repository: { id: 1409422243, full_name: "dcep93/concertboxd", default_branch: "main" }, sender: { id: 12521665, login: "dcep93" }, issue },
    live: structuredClone(issue), actor: { id: 12521665 },
    history: { data: { repository: { issue: { lastEditedAt: null, timelineItems: { totalCount: 0 } } } } },
    gate: { id: 42, name: "catalog-production", can_admins_bypass: false, protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { id: 12521665 } }] }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } },
    branches: { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] },
    reviews: [{ state: "approved", user: { id: 12521665 }, environments: [{ id: 42 }], comment: `approve ${"b".repeat(64)}` }],
    failure: "",
  };
  change(fixture); Object.assign(process.env, fixture.env);
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    assert.equal(init?.method || "GET", url.endsWith("/graphql") ? "POST" : "GET");
    if (fixture.failure && url.includes(fixture.failure)) return new Response("Denied", { status: 403 });
    let data: unknown;
    if (url.endsWith("/graphql")) data = fixture.history;
    else if (url.includes("/users/")) data = fixture.actor;
    else if (url.endsWith("/concertboxd")) data = fixture.event.repository;
    else if (url.includes("/issues/")) data = fixture.live;
    else if (url.includes("deployment-branch-policies")) data = fixture.branches;
    else if (url.endsWith("/approvals")) data = fixture.reviews;
    else if (url.includes("/environments/")) data = fixture.gate;
    else throw Error("Unexpected API route");
    return new Response(JSON.stringify(data), { status: 200 });
  };
  try { return { snapshot: await checkGithub(fixture.event, approved), calls }; }
  finally { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]; Object.assign(process.env, previousEnv); }
}
test("GitHub protocol checks both numeric identities and exact hash approval with read-only API calls", async () => {
  const { snapshot, calls } = await scenario();
  assert.equal(snapshot.codeCommit, "a".repeat(40)); assert.equal(snapshot.requestHash.length, 64);
  assert.equal(snapshot.body, '{"version":1}'); assert.equal(calls.length, 7);
});
test("wrong repository, sender, actor, rerun initiator, branch, workflow or mutable code are denied", async () => {
  for (const change of [
    (f: any) => { f.event.repository.id = 1; }, (f: any) => { f.event.sender.id = 1; },
    (f: any) => { f.env.GITHUB_ACTOR_ID = "1"; }, (f: any) => { f.env.GITHUB_TRIGGERING_ACTOR = "other"; },
    (f: any) => { f.actor.id = 1; }, (f: any) => { f.env.GITHUB_REF = "refs/heads/other"; },
    (f: any) => { f.env.GITHUB_WORKFLOW_REF = "other"; }, (f: any) => { f.env.GITHUB_WORKFLOW_SHA = "c".repeat(40); },
    (f: any) => { f.env.GITHUB_EVENT_NAME = "workflow_dispatch"; }, (f: any) => { f.event.action = "edited"; },
  ]) await assert.rejects(() => scenario(change));
});
test("edited-and-reverted and close/reopen histories fail even if current body/timestamps match", async () => {
  await assert.rejects(() => scenario(f => { f.history.data.repository.issue.lastEditedAt = "same-second"; }), /Previously edited/);
  await assert.rejects(() => scenario(f => { f.history.data.repository.issue.timelineItems.totalCount = 2; }), /Previously edited/);
  await assert.rejects(() => scenario(f => { f.history.errors = [{ message: "cannot read" }]; }));
  await assert.rejects(() => scenario(f => { f.failure = "graphql"; }));
});
test("wrong owner/environment, bypass, old hash approval or missing permission fails before credentials", async () => {
  for (const change of [
    (f: any) => { f.reviews[0].user.id = 1; }, (f: any) => { f.reviews[0].environments[0].id = 99; },
    (f: any) => { f.reviews[0].comment = `approve ${"c".repeat(64)}`; },
    (f: any) => { f.reviews[0].comment = ""; }, (f: any) => { f.reviews[0].state = "rejected"; },
    (f: any) => { f.reviews = []; }, (f: any) => { f.gate.can_admins_bypass = true; },
    (f: any) => { f.failure = "environments"; }, (f: any) => { f.failure = "approvals"; },
  ]) await assert.rejects(() => scenario(change));
  const preview = await scenario(f => { f.reviews = []; }, false);
  assert.ok(!preview.calls.some(url => url.endsWith("/approvals")));
});
