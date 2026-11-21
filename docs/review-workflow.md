# Review and approval workflow

Apply the saved-assessment migrations and `20261115120000_register_service.sql` before `20261118090000_review_workflow.sql`. Deploy the database migration, backend, and matching frontend together; the new screens require the private review tables and FastAPI review endpoints. No service-role key is used by the application.

## Using reviews

1. Sign in and open **My assessments**, then **Workspace reviews**. Create a workspace; its creator becomes that workspace's admin.
2. Members share their account ID from the Workspace reviews page. An admin assigns submitter, reviewer, or admin membership to an existing registered account. Admins cannot modify their own membership through this operation.
3. Save an assessment, open its saved version, select a workspace, and submit for review. Private drafts are not exposed to workspace colleagues.
4. Another reviewer or admin finds the submitted version under **Awaiting your decision** on Workspace reviews (the oldest 100 are listed), then approves, rejects, or requests changes with a required comment. An admin cannot decide their own submission.
5. A submitter can respond to a changes-requested decision and resubmit the same immutable result with clarification, or re-assess to create a separate draft version. Changed scoring answers always require a new version and fresh approval.
6. Download the report from the saved version. An approved version includes the reviewer's account email and account ID, approval time, decision comment, version identity, rubric, and recommendation catalog version. A version approved before this workflow was installed says that no reviewer is on record. Unapproved versions have no sign-off.

## Authorization and audit

Next.js validates the authenticated session and request origin, then forwards to FastAPI. FastAPI verifies the access token, validates and bounds the request, and scopes its database transaction to the verified user. The `register_api` role is the only application role with access to the private `register` schema; browsers cannot submit fabricated saved scores or call workflow functions directly. PostgreSQL independently enforces permissions through RLS and restricted transactional functions. Membership is read from database rows rather than user-editable metadata. Workspace admins have authority within their workspace only.

The transition RPC locks the version, checks its expected state, changes its status, and appends an audit event in one transaction. Direct status updates and audit inserts/updates/deletes are not granted to application users. Initial saved status is recorded by a trigger. Existing records receive an explicitly labeled migration snapshot rather than fabricated historical events.

Submitted versions cannot be deleted, including after rejection: the delete policy refuses any assessment with a version that has left draft, and the restrictive foreign key from the review link backs it up. Private drafts may still be deleted; minimal audit metadata is retained without answers or free-text descriptions. Workspace membership and user-account removal must respect restrictive foreign keys. A database owner can administer or migrate the database; immutability is an application permission guarantee, not protection against a privileged database operator.

Review comments and actor account IDs are intentionally retained as approval evidence. The audit record stores no email addresses; a version's owner and its workspace reviewers see the actors' account emails, resolved when the history is read. The screen warns against placing personal or sensitive use-case details in comments. Agree audit retention and authorized administrative deletion procedures with the team before production use.

## Verification

`frontend/tests/review-database.test.ts` executes the actual migrations against embedded PostgreSQL with verified-user transaction settings and the restricted `register_api` role, checking RLS and permission failures directly. The route tests check authentication, input validation, safe error responses, and forwarding. Database tests enforce workspace authorization, self-review prevention, and immutable history. Report tests check sign-off inclusion and omission. These local tests do not substitute for staging verification with the team's real Supabase roles and two confirmed accounts.

Before deployment, run the full frontend checks, apply the migrations to staging, and test a submitter and separate reviewer through submission, changes requested, resubmission, approval, and PDF download. Revoke the reviewer's workspace membership and confirm access is denied. Verify rejected records cannot be deleted. Existing saved results must remain readable. Do not apply the migration to the shared project without the team's deployment coordination.

## Scope

The register service now scores and saves assessments in FastAPI. The workflow preserves that trust boundary and does not restore client-callable save functions. Report sign-off applies to the saved result only; any what-if simulation is included separately and is not approved by that sign-off.

This is a review workflow, not email invitations or notifications. Membership uses an existing user's account ID. Decisions are final for approved/rejected versions; reassessment produces a new draft. No deployed project, account password, or shared production data is changed by the local implementation.
