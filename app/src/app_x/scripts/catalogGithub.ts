/** GitHub checks are deliberately read-only; this module cannot approve deployments. */
import { requireThat, sha256 } from "../data/catalogRequest";
export const repository = "dcep93/concertboxd";
export const repositoryId = 1409422243;
export const ownerId = 12521665;
export const environmentName = "catalog-production";
export const workflowRef = `${repository}/.github/workflows/catalog-update.yml@refs/heads/main`;
type Json = Record<string, any>;
export async function github(path: string) {
  const response = await fetch(`https://api.github.com/${path}`, { headers: {
    Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
  } });
  requireThat(response.ok, `GitHub check failed (${response.status})`);
  return response.json();
}
export function assertIssue(initial: Json, live: Json) {
  requireThat(initial.user?.id === ownerId && live.user?.id === ownerId && initial.user.login === "dcep93"
    && live.user.login === "dcep93" && !initial.pull_request && !live.pull_request, "Unauthorized issue author");
  requireThat(initial.title === "[catalog-change:v1]" && live.title === initial.title && live.number === initial.number
    && live.state === "open" && initial.state === "open" && !live.locked
    && typeof initial.body === "string" && live.body === initial.body
    && initial.created_at === initial.updated_at && live.updated_at === initial.updated_at
    && live.created_at === initial.created_at, "Issue edited, closed, locked or changed; open a fresh request");
}
export function assertGate(environment: Json, branches: Json) {
  const reviewers = environment.protection_rules?.filter((rule: Json) => rule.type === "required_reviewers");
  requireThat(environment.name === environmentName && Number.isSafeInteger(environment.id)
    && environment.can_admins_bypass === false && reviewers?.length === 1
    && reviewers[0].prevent_self_review === false && reviewers[0].reviewers?.length === 1
    && reviewers[0].reviewers[0].type === "User" && reviewers[0].reviewers[0].reviewer?.id === ownerId
    && environment.deployment_branch_policy?.protected_branches === false
    && environment.deployment_branch_policy?.custom_branch_policies === true
    && branches.total_count === 1 && branches.branch_policies?.length === 1
    && branches.branch_policies[0].name === "main" && branches.branch_policies[0].type === "branch", "Approval environment is not safely configured");
}
export async function checkGithub(event: Json, approved = false) {
  const env = process.env;
  requireThat(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "issues" && event.action === "opened"
    && event.repository?.id === repositoryId && event.repository.full_name === repository && event.repository.default_branch === "main"
    && event.sender?.id === ownerId && event.sender.login === "dcep93" && env.GITHUB_ACTOR_ID === String(ownerId)
    && env.GITHUB_REPOSITORY === repository && env.GITHUB_REPOSITORY_ID === String(repositoryId)
    && env.GITHUB_REF === "refs/heads/main" && env.GITHUB_WORKFLOW_REF === workflowRef
    && /^[0-9a-f]{40}$/.test(env.GITHUB_SHA || "") && env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA, "Untrusted workflow origin");
  requireThat(env.GITHUB_TRIGGERING_ACTOR === "dcep93", "Unauthorized run initiator");
  const actor = await github(`users/${env.GITHUB_TRIGGERING_ACTOR}`);
  const repo = await github(`repos/${repository}`);
  requireThat(actor.id === ownerId && repo.id === repositoryId && repo.default_branch === "main", "Repository or initiator identity changed");
  const issue = await github(`repos/${repository}/issues/${event.issue.number}`);
  assertIssue(event.issue, issue);
  // updated_at has second precision. lastEditedAt also catches an edit/revert within that second.
  const graph = await fetch("https://api.github.com/graphql", { method: "POST", headers: {
    Authorization: `Bearer ${env.GH_TOKEN}`, "Content-Type": "application/json",
  }, body: JSON.stringify({ query: "query($number:Int!){repository(owner:\"dcep93\",name:\"concertboxd\"){issue(number:$number){lastEditedAt timelineItems(itemTypes:[CLOSED_EVENT,REOPENED_EVENT],first:1){totalCount}}}}", variables: { number: issue.number } }) });
  requireThat(graph.ok, "Cannot check issue edit history");
  const history = await graph.json();
  const historyIssue = history.data?.repository?.issue;
  requireThat(!history.errors && historyIssue && historyIssue.lastEditedAt === null && historyIssue.timelineItems.totalCount === 0, "Previously edited or closed issue; open a fresh request");
  const environment = await github(`repos/${repository}/environments/${environmentName}`);
  const branches = await github(`repos/${repository}/environments/${environmentName}/deployment-branch-policies?per_page=100`);
  assertGate(environment, branches);
  if (approved) {
    requireThat(/^[a-f0-9]{64}$/.test(env.CATALOG_PLAN_HASH || ""), "Missing approved plan hash");
    const reviews = await github(`repos/${repository}/actions/runs/${env.GITHUB_RUN_ID}/approvals`);
    requireThat(reviews.some((review: Json) => review.state === "approved" && review.user?.id === ownerId
      && review.comment?.trim() === `approve ${env.CATALOG_PLAN_HASH}`
      && review.environments?.some((item: Json) => item.id === environment.id)), "No owner approval recorded for this environment");
  }
  return { issue: issue.number, body: issue.body as string, requestHash: sha256(issue.body), codeCommit: env.GITHUB_SHA! };
}
