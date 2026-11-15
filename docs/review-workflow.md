# Review and approval workflow

This implementation depends on the saved-assessment migrations from SCRUM-30 (class PR #16). Apply those migrations before `20261114090000_review_workflow.sql`. Deploy the database migration and matching frontend together; the new screens require the review tables. No service-role key is used by the application.

## Using reviews

1. Sign in and open **My assessments**, then **Workspace reviews**. Create a workspace; its creator becomes that workspace's admin.
2. Members share their account ID from the Workspace reviews page. An admin assigns submitter, reviewer, or admin membership to an existing registered account. Admins cannot modify their own membership through this operation.
3. Save an assessment, open its saved version, select a workspace, and submit for review. Private drafts are not exposed to workspace colleagues.
4. Another reviewer or admin opens the submitted version and approves, rejects, or requests changes with a required comment. An admin cannot decide their own submission.
5. A submitter can respond to a changes-requested decision and resubmit the same immutable result with clarification, or re-assess to create a separate draft version. Changed scoring answers always require a new version and fresh approval.
6. Download the report from the saved version. An approved version includes the reviewer, approval timestamp, decision comment, version identity, rubric, and recommendation catalog version. New/unapproved versions have no sign-off.

## Authorization and audit

Next.js validates the authenticated session, request origin, operation, input bounds, and role before invoking Supabase. PostgreSQL independently enforces permissions through RLS and restricted transactional functions. Membership is read from database rows rather than user-editable metadata. Workspace admins have authority within their workspace only.

The transition RPC locks the version, checks its expected state, changes its status, and appends an audit event in one transaction. Direct status updates and audit inserts/updates/deletes are not granted to application users. Initial saved status is recorded by a trigger. Existing records receive an explicitly labeled migration snapshot rather than fabricated historical events.

Submitted versions reference their review workspace and cannot be deleted, including after rejection. Private drafts may still be deleted; minimal audit metadata is retained without answers or free-text descriptions. Workspace membership and user-account removal must respect restrictive foreign keys. A database owner can administer or migrate the database; immutability is an application permission guarantee, not protection against a privileged database operator.

Review comments and actor email labels are intentionally retained as approval evidence. The screen warns against placing personal or sensitive use-case details in comments. Agree audit retention and authorized administrative deletion procedures with the team before production use.

## Verification

`frontend/tests/review-database.test.ts` executes the actual migrations against embedded PostgreSQL with simulated Supabase auth claims, checking RLS and permission failures directly. The route tests additionally exercise server authorization. Report tests check sign-off inclusion and omission. These local tests do not substitute for staging verification with the team's real Supabase roles and two confirmed accounts.

Before deployment, run the full frontend checks, apply the migrations to staging, and test a submitter and separate reviewer through submission, changes requested, resubmission, approval, and PDF download. Revoke the reviewer's workspace membership and confirm access is denied. Verify rejected records cannot be deleted. Existing saved results must remain readable. Do not apply the migration to the shared project without the team's deployment coordination.

## Scope

Release dependency: the register currently grants authenticated users direct insert/RPC access to supplied scoring results. RLS restricts ownership but does not establish that a result came from the scoring service. The register must enforce trusted scoring provenance before saved results are used for production approvals. Local reproduction confirmed a direct authenticated RPC can persist a fabricated score. This workflow does not resolve that upstream trust boundary.

This is a review workflow, not email invitations or notifications. Membership uses an existing user's account ID. Decisions are final for approved/rejected versions; reassessment produces a new draft. No deployed project, account password, or shared production data is changed by the local implementation.
