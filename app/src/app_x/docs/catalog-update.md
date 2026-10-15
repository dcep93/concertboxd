# Issue-driven catalog approval

Status: implementation prepared for review; **not production-ready**. No merge, environment configuration, Google IAM change, or production write is authorized by this document. Ask dcep93 separately for each of those steps. The task-specific AGENTS.md exception covers only `.github/workflows/catalog-update.yml`; all other changes are under `app/src/app_x`.

## Verified facts and remaining access work

On 2026-10-15, authenticated GitHub GET requests confirmed `dcep93/concertboxd`, numeric repository ID **1409422243**, public visibility, and default branch `main`. `users/dcep93` returned numeric user ID **12521665**. The environment listing was empty and GET `catalog-production` returned 404. No environment gate or Google access has been configured or tested by this change. Google IAM was not inspected; the deployer's effective read-only database access still needs verification before enabling this path.

The existing deployment workflow and its service account are unchanged. Do not give `deployer-github@concertboxd.iam.gserviceaccount.com` database writes. The old deployment workflow currently uploads full database backups to Actions artifacts. That existing behavior is outside this task's single-workflow exception; this new workflow never uploads full backups. Remediation of the old workflow/artifacts needs a separately scoped review.

This is one repeatable workflow on `main`, triggered by `issues: opened`, not a `workflow_call` entry or `workflow_dispatch`. It cannot receive requests until separately approved and merged. Creating it on a branch alone does not enable it.

## Assistant request contract

Create an issue in **dcep93/concertboxd** using the owner's connector, with title exactly **`[catalog-change:v1]`**. Its entire body must be the JSON request, with no Markdown fences, narrative, attachments, labels, or later edits required. The executable template is [catalog-update-issue.json](catalog-update-issue.json). Replace its example facts, six-character IDs, public source URLs and unique `request_id`; do not submit example facts to production.

Only use independently checked **public catalog facts**. Never put private email content, personal notes, ticket/order/seat details, private links, credentials, or signed URLs in the issue. Do not paste an email to ask the workflow to extract facts. The `public_catalog_only: true` attestation is required. Field validation is not a semantic privacy classifier: the assistant must make this check before creating the public issue, and the human reviewer must check the preview.

Allowed operations are `add` and `update`. Target tables are `artists`, `venues`, and `concerts`. Schedules are read for reference validation but cannot be requested or changed. Add referenced artists/venues in the same request or reference existing IDs. Maximum 25 operations, 32 KiB UTF-8, one operation per table/ID, at most five source URLs per operation. IDs are exactly six lowercase letters/digits. Request IDs use lowercase letters, digits and hyphens, 6–80 characters, beginning with a letter.

| Table | Allowed public fields |
| --- | --- |
| artists | name, image |
| venues | name, timezone, location, image |
| concerts | name, date, date_precision, end_date, venue_id, artist_id, supporting_artist_ids, setlist_fm_url, purchase_link |

No deletes, arbitrary paths, executable expressions, extra fields, admin data, user tables, or historical import selection. HTTPS URLs must have public DNS hostnames and no credentials, query, fragment or nondefault port. URLs are displayed as evidence, never fetched or executed by the importer. URL syntax alone cannot prove a source is truthful, public, or free of secrets in its path; review the sources. Labels cannot contain control characters, markup/code delimiters, email addresses or URLs. An empty image/link string can explicitly clear that public value; removing fields is unsupported.

Dates require seconds and an explicit ISO offset or `Z`. `date_precision: day` requires UTC midnight; `time` uses an actual instant. Non-UTC explicit offsets must agree with the venue's valid IANA timezone at that instant, including DST. End dates must be valid calendar dates no earlier than the venue-local start day. Concert identity rejects another concert at the same venue and instant with the same headliner (or normalized festival title). Distinct showtimes are allowed; fuzzy real-world duplicates still require human review.

For an update, include `expected` and `expected_absent`, covering **every field being changed**. Expected dates should be canonical UTC ISO timestamps (seconds, no fractional seconds). Example operation:

```json
{
  "op": "update",
  "table": "artists",
  "id": "art001",
  "expected": { "name": "Example Artist", "image": "https://example.org/old.jpg" },
  "expected_absent": [],
  "values": { "image": "https://example.org/new.jpg" },
  "sources": ["https://example.org/artist"]
}
```

If `image` is absent, omit it from `expected` and set `expected_absent: ["image"]`. Absent and empty string differ. An existing target is always rejected for `add`, even if it looks identical. A stale update is rejected even if the desired value is already present, unless the exact request receipt exists.

Do not edit, comment on, close/reopen, retitle, or lock a pending request. GitHub `updated_at` changes are conservatively rejected, including unrelated activity; GraphQL `lastEditedAt` and close/reopen history also reject reverted edits and lifecycle changes. Changed facts require a new issue, new request ID and new approval. Both author and initiator, including rerun initiator, must be dcep93/12521665.

**The assistant must never approve its own deployment**, invoke GitHub's deployment approval endpoint, use the owner's browser to click approval, or submit an approval comment on the owner's behalf. GitHub sees both assistant and human as dcep93, so this separation is procedural and cannot be enforced by account identity alone. dcep93 personally reviews and approves every write.

## Where the human approves and verifies

Open [Catalog update approval runs](https://github.com/dcep93/concertboxd/actions/workflows/catalog-update.yml). Select the run for the issue and open its summary. Preview shows exact before/after public records (Firestore typed JSON), source URLs, exact request JSON string, request SHA-256, review-plan SHA-256, and immutable code commit. No full table backup appears in the summary or review artifact. Check the diff and sources, then click **Review deployments**, select **catalog-production**, paste the summary's exact **`approve <64-character review-plan SHA-256>`** as the review comment, and choose **Approve and deploy**. The environment URL links to that same run. Reject if anything is wrong. An empty approval comment fails closed.

The plan hash includes the request, commit, preview and run attempt. An approval for a previous attempt cannot satisfy a new plan. If a run fails, use **Re-run all jobs**, review the new preview and personally approve the new plan; rerunning only failed jobs rejects the old attempt's artifact. A matching applied receipt returns `already-applied` without overwriting later edits. A conflicting hash for a used request ID is an error; never remove a receipt to force a retry.

The result summary must say **verified**, meaning the atomic write and receipt were read back, or **already-applied**, meaning no write happened. A failure after commit or a lost network response is ambiguous: inspect the receipt and the private backup before deciding whether to retry. Verification can also report a mismatch if someone edits immediately after the commit; do not automatically roll back newer edits. Recovery is a new reviewed correction with current expectations, never a blanket restore.

GitHub notification preferences are personal. In the repository's Watch menu select the desired Actions notifications; check account **Settings → Notifications → Actions** and email/web delivery. Use GitHub's approval email/web notification or the run link above. GitHub Mobile push availability and delivery have **not** been tested; do not promise a phone push. Verify the chosen notification channel during the smoke test. See [GitHub's deployment review instructions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments).

## One-time setup, each security/access step requires approval

1. Review this change and ask separately before merging it into `main`. Keep the repository's existing deployment account read-only for database data. Confirm project number `565493109366` against Google before executing setup (currently sourced from the existing workflow).
2. Ask permission to create the environment at [repository environment settings](https://github.com/dcep93/concertboxd/settings/environments). Name it exactly `catalog-production`; set the sole required reviewer to User **12521665 / dcep93**; turn **Prevent self-review off**; disable administrator bypass; choose selected branches and add exactly **main**, type **branch**, with no tags or wildcard policies. If GitHub cannot expose/enforce these settings, stop; don't weaken the runtime checks. Environment reviewers and bypass controls depend on repository visibility/plan; see [GitHub environment documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
3. Read back the environment and branch-policy APIs below. The workflow independently repeats these checks before preview, before writer authentication, and immediately before commit. Require `can_admins_bypass: false`, the sole numeric reviewer, `prevent_self_review: false`, custom branch policies enabled, and exactly one `main` branch rule. Missing fields or inability to read settings fail closed. Test that the ordinary read-only `GITHUB_TOKEN` can read the environment, branch policies, GraphQL issue history and workflow review history.
4. Run the no-Google smoke test below **before granting writer access**. Leave `CATALOG_PRODUCTION_ENABLED` unset or `false`. Record its run URL, approved plan hash and notification delivery. Gate verification is a prerequisite for provisioning production credentials.
5. Ask separately to create the proposed Google identities, pools/provider conditions, custom roles and private bucket below. Review effective inherited IAM grants as well as direct bindings. Do not silently reuse the existing broad deployment provider or grant the deployer additional access. Do not create a service-account JSON key.
6. After the gate smoke succeeds and Google bindings are inspected, configure the repository variable `CATALOG_READER_PROVIDER`. Configure environment variables `CATALOG_WRITER_PROVIDER`, `CATALOG_BACKUP_BUCKET`, and finally `CATALOG_PRODUCTION_ENABLED=true` only with separate permission to enable production access. Provider paths use `projects/565493109366/locations/global/workloadIdentityPools/POOL/providers/github`.
7. With separate permission for a specific production write, submit a small real public correction. Verify the preview, approve personally, confirm private backup readback, atomic commit and receipt readback, then rerun all jobs to prove the exact receipt suppresses writes. Confirm refusal of tokens from other repositories/branches/workflows and a job without the protected environment. Record all run URLs and actual IAM checks before calling this ready. The no-write smoke alone is insufficient.

Read-only inspection commands:

```sh
gh api repos/dcep93/concertboxd --jq '{id,default_branch}'
gh api users/dcep93 --jq '{id,login}'
gh api repos/dcep93/concertboxd/environments/catalog-production
gh api repos/dcep93/concertboxd/environments/catalog-production/deployment-branch-policies
```

## Proposed keyless Google access (not created)

Use separate accounts `catalog-reader@concertboxd.iam.gserviceaccount.com` and `catalog-writer@concertboxd.iam.gserviceaccount.com`. Each gets its own dedicated WIF pool (`catalog-reader` / `catalog-writer`) containing only the GitHub provider. Separate pools prevent another provider's attribute mapping from satisfying the same service-account binding. Issuer: `https://token.actions.githubusercontent.com`. Use the default provider-specific audience checked by Google; no wildcard audiences. Map `google.subject=assertion.sub` and `attribute.repository_id=assertion.repository_id`.

Writer provider CEL condition:

```text
assertion.repository_id == '1409422243' &&
assertion.repository_owner_id == '12521665' &&
assertion.repository == 'dcep93/concertboxd' &&
assertion.actor_id == '12521665' &&
assertion.event_name == 'issues' &&
assertion.ref == 'refs/heads/main' &&
assertion.workflow_ref == 'dcep93/concertboxd/.github/workflows/catalog-update.yml@refs/heads/main' &&
assertion.environment == 'catalog-production' &&
assertion.sub == 'repo:dcep93/concertboxd:environment:catalog-production' &&
assertion.runner_environment == 'github-hosted'
```

The reader uses the same repository/owner/actor/event/ref/workflow/runner restrictions, but replaces the environment/sub conditions with `assertion.sub == 'repo:dcep93/concertboxd:ref:refs/heads/main'` because preview has no protected environment. Use `workflow_ref`, not `job_workflow_ref`: this is a normal issue workflow, not a reusable-workflow call. Inspect real OIDC claim names in the approved integration test; do not log tokens. Provider conditions should fail closed if claims are absent. See [Google's GitHub federation guidance](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines).

Give only `roles/iam.workloadIdentityUser` on each individual service account to the corresponding dedicated pool principal set:

```text
principalSet://iam.googleapis.com/projects/565493109366/locations/global/workloadIdentityPools/catalog-writer/attribute.repository_id/1409422243
principalSet://iam.googleapis.com/projects/565493109366/locations/global/workloadIdentityPools/catalog-reader/attribute.repository_id/1409422243
```

Do not grant project-wide impersonation, service-account key administration, or Token Creator broadly. The provider condition is mandatory in addition to this numeric repository binding. Server-side IAM **bypasses Firestore Security Rules**. IAM does not enforce this workflow's document-field allowlist; the importer restricts itself to four fixed catalog reads and updates only artists/venues/concerts. This is a safeguard for trusted repository operators, not protection against someone controlling repository code, environments, Actions variables, Google IAM or settings.

Proposed custom roles, scoped to the `(default)` Firestore database with the resource IAM condition `resource.name == 'projects/concertboxd/databases/(default)'` (inspect effective access; [database IAM instructions](https://cloud.google.com/firestore/docs/manage-databases)):

| Principal | Database permissions |
| --- | --- |
| catalog-reader | `datastore.entities.get` |
| catalog-writer | `datastore.entities.get`, `datastore.entities.update`, `datastore.databases.get` |

`datastore.databases.get` permits begin/rollback of transactions. All row additions and receipts update already-existing table documents with `updateTime` preconditions, so document create/list/delete permissions are intentionally omitted. If Google's live authorization requires a different permission, fail and review evidence before expanding it. Never use `roles/datastore.user` (includes deletion), Owner or Editor. No Auth administration, IAM administration, Hosting, rules deployment, database deletion, index management, or database export/import permissions. The reader cannot write; the writer cannot create missing tables. Consult the [Firestore IAM API-method matrix](https://docs.cloud.google.com/firestore/native/docs/security/iam).

Create a dedicated backup bucket in an appropriate location with **uniform bucket-level access** and **public access prevention enforced**. No public principals. Use an explicitly reviewed retention/lifecycle policy and separately restricted human backup-reader access. Do not lock retention without separate permission. The writer needs only `storage.buckets.get` on this bucket and `storage.objects.create` / `storage.objects.get` for its `catalog/` prefix (a custom role plus resource conditions). No object deletion, overwrite, list, ACL or bucket IAM permissions. Each object uses generation-match zero and a unique run/attempt/content-hash name; the importer checks privacy settings, upload generation and exact content hash on readback before Firestore commit. Bucket IAM cannot prove that every named reader is appropriate, so inspect its policy during setup.

Backups contain the **four raw catalog tables**, including envelope metadata and receipts, sufficient to recover exactly the tables touched by this path. Personal tables are neither read nor backed up by this workflow. Backups never enter public Actions artifacts, issue comments or logs. Only the validated public request, hashes and public diff enter the short-lived review artifact. The legacy full-database backup mechanism is not invoked.

## No-write approval smoke

After approved merge and gate configuration, create an issue with the exact title and body from [catalog-update-smoke.json](catalog-update-smoke.json). Use a new request ID per smoke. No Google configuration is needed. The preview must succeed and the apply job must remain **Waiting for approval**. Record the run URL. Check notifications, personally approve with the hash comment, and require the `No-write smoke passed` summary. Both Google authentication steps must be skipped; no Firestore or bucket requests occur.

Also exercise rejection: a fresh smoke that is edited, edited-and-reverted, or closed/reopened before approval must fail. Approving without the exact plan-hash comment must fail. A fresh issue by another account must not run the preview. Cancel or reject unwanted pending deployments personally; never have the assistant approve them. Fresh requests are required after any edits.

## Concurrency, recovery and limits

The workflow checks out `github.sha` and requires it to match `GITHUB_WORKFLOW_SHA` for this default-branch issue workflow. Every third-party action is pinned to a full commit. It never evaluates issue text, interpolates it into shell commands, runs code from the issue, or loads historical correction files. Existing `projectCorrections` / `projectRevisions` implement projection, schema validation, expected-value semantics and receipt reuse; the issue wrapper tightens validation and adds venue additions. Existing REST encoding preserves Firestore timestamps and envelope data.

The single `production` concurrency group is shared with the existing deployment workflow and uses `cancel-in-progress: false`. GitHub can replace an older pending run with a newer pending run; it does not guarantee a FIFO queue. An active run/write is never cancelled by a new request. Process requests sequentially; inspect cancelled pending runs and open a fresh issue if needed.

After approval, a read/write transaction rereads all four catalog documents, checks the preview digest and exact public diff, saves and verifies a fresh private backup, rechecks GitHub state/approval/settings, and commits with document `updateTime` preconditions and the transaction token. Firestore aborts concurrent changes to any read dependency; no automatic rebase or blind retry occurs. Unrelated records and envelope fields are preserved. No personal/admin document is a possible write target. A new receipt lives under `tables/concerts.applied_revisions["issue-" + request_id]` with the exact body SHA-256 and commits atomically with catalog changes.

GitHub and Firestore do not share a transaction. There is an unavoidable short interval between the last issue/gate check and Firestore commit; an issue closure/edit in that interval cannot atomically revoke an in-flight commit. Once approved, treat the operation as potentially in flight. Revocation also cannot recall an already accepted write. If this cross-service atomic guarantee is required, this no-server design cannot provide it.

To revoke future access, ask permission to set `CATALOG_PRODUCTION_ENABLED=false`, disable the catalog workflow/provider or service account, and remove the writer's WIF impersonation and database/bucket bindings. Disabling a provider prevents new exchanges; already-issued short-lived tokens may remain usable until expiry, and IAM changes can take time to propagate. Preserve private backups and receipts. Do not delete data or silently restore backups. Removing the environment gate alone is unsafe; runtime checks will refuse it, but revoke Google access before dismantling protections.

## Validation record

Local checks passed: 88 non-emulator TypeScript tests (including 16 request/transaction/GitHub/gate tests), 29 existing Firestore rules/migration emulator tests, 3 new real REST catalog transaction emulator tests, 21 Python tests in UTF-8 mode, TypeScript build, Vite production build, lint and actionlint. Use the app tsconfig for JSX tests. Vite reports the existing large-chunk warning. Java 21 was downloaded to a temporary directory for emulator testing; no system installation or persistent PATH change was made. Browser UI tests were not run for this backend-only change. Live-access results are tracked separately; local tests do not establish production readiness.

The real REST tests cover correction plus receipt commit/readback, personal-table preservation, receipt reruns, outdated `updateTime` rejecting the whole commit, and concurrent writes to a read dependency. Catalog reads use `batchGet` with the transaction token, also avoiding the local emulator's unsupported transaction-bytes GET query handling.

```sh
cd app
npm ci --ignore-scripts
npx tsx --tsconfig tsconfig.app.json --test src/app_x/tests/catalogRequest.test.ts src/app_x/tests/catalogGithub.test.ts src/app_x/tests/catalogCorrections.test.ts src/app_x/tests/firestoreRest.test.ts
npm run lint
npm run build
python -X utf8 -m unittest discover -s src/app_x/tests -p 'test_*.py'
# Firestore emulator only; never point tests at production:
npx firebase emulators:exec --project demo-concertboxd --config src/app_x/backend/firebase.json --only firestore 'npx tsx --tsconfig tsconfig.app.json --test src/app_x/tests/tables.test.ts src/app_x/tests/rules.test.ts src/app_x/tests/catalogEmulator.test.ts'
```

Before readiness, record: approved PR/merge commit, environment readback, smoke run/notification evidence, actual Google project/IAM/provider/bucket inspection, approved end-to-end write run, receipt/backup verification and no-write rerun. None of those live milestones is completed by local tests.
