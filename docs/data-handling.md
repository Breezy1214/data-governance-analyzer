# Data handling and retention (v1.0)

Implements SCRUM-16. The analyzer assesses potentially sensitive use cases, so it applies the same data-minimization principle it recommends.

## Decision

Assessments remain **stateless**: answers and reports are not retained on the server.
Supabase manages authenticated accounts and session metadata. The application has no
local session database. Next.js stores Supabase session tokens in HttpOnly, SameSite=Lax
cookies (Secure on hosted HTTPS deployments); browser JavaScript cannot read them.
FastAPI verifies JWT signature, issuer, audience, expiry, and authenticated user claims.

## Field inventory

| Field | Purpose | Sent to API | Stored |
| --- | --- | --- | --- |
| `description` | Gives the person context and appears in their on-screen record and downloaded report. Not scored. | **No** | This tab's `sessionStorage` only |
| `dataTypes` | Data-sensitivity rules (`DATA_SENSITIVITY_*`), de-identification, and HIPAA/PCI limitations | Yes | This tab's `sessionStorage` only |
| `externalAccess` | `EXTERNAL_ACCESS` rule and protected-matching fit | Yes | This tab's `sessionStorage` only |
| `rawExchange` | `RAW_EXCHANGE` rule and protected-matching fit | Yes | This tab's `sessionStorage` only |
| `dataMovement` | `DATA_MOVEMENT` rule | Yes | This tab's `sessionStorage` only |
| `combined` | `COMBINED_REIDENTIFICATION` rule and re-identification remediation | Yes | This tab's `sessionStorage` only |
| `secondaryUse` | `SECONDARY_USE` rule and secondary-use approval gate | Yes | This tab's `sessionStorage` only |
| `purpose` | `PURPOSE_*` rules and protected-matching fit | Yes | This tab's `sessionStorage` only |
| `schemaVersion` | API contract versioning | Yes | No |

The API schema does not accept `description`; it remains exclusively in the browser for the on-screen record and local PDF report.

## Data flow

1. The person types into the wizard. Input is held in React state and mirrored to `sessionStorage` (`governance-assessment-draft-v2`) so a refresh does not lose work.
2. On **Assess risk**, the browser sends only the scored fields to same-origin `POST /api/assessments`.
   The Next.js server forwards the request to FastAPI `POST /assessments` with the user's verified access token.
   Nothing goes in the URL or query string. FastAPI verifies the session and is the only scoring implementation;
   if it is unavailable, the browser displays an error and does not produce a score.
3. The API scores the request in memory and returns the result with `Cache-Control: no-store`.
   Assessment answers and results are not written to a database. Supabase separately retains
   account/session metadata; authentication and token refresh can update that metadata.
4. The PDF report is generated entirely in the browser (jsPDF) and downloaded with a generic filename (`data-governance-assessment.pdf`). It is never uploaded, and it carries no author or keyword metadata and no internal rule identifiers. See `frontend/lib/report.ts`.

## Session lifetime and deletion

| Event | Effect |
| --- | --- |
| Tab or window closed | Browser discards `sessionStorage`, so the draft is gone |
| 30 minutes without interaction | Draft and result cleared; the person sees an expiry message |
| Draft older than 30 minutes found on load | Discarded, not restored |
| **Start over** | Draft and result cleared immediately |
| Earlier-build draft in `localStorage` (`-v1`) | Deleted on next visit |

Constants live in `frontend/lib/session.ts` (`IDLE_TIMEOUT_MS`).

The draft timer is not the login lifetime. Logout clears drafts across tabs; login lifetime and
token revocation are covered under "Supabase setup" in [deployment.md](deployment.md).

## Logs, analytics, URLs, and errors

- **Application logs** (`backend/app/logging_config.py`) record only a random request ID, schema/rules versions, score, level, and fired rule IDs. Raw answers and free text are never logged. Covered by `test_scoring_logs_exclude_questionnaire_input`.
- **Validation errors** report field names only, never submitted values or unknown field names. Covered by `test_invalid_input_returns_clear_client_error_without_echoing_input` and `test_user_controlled_extra_field_name_is_not_echoed_or_logged`.
- **URLs:** assessment content and credentials never appear in paths or query strings.
  Routes include `/`, `/login`, and same-origin `/api/*` handlers.
- **Analytics and error reporting:** none are installed. Any tool added later must not capture request bodies, form values, or `sessionStorage`.

## Hosted environments

- **Vercel (frontend):** dynamic server-rendered protected pages and same-origin API handlers.
  Free-text descriptions stay in the browser; responses containing identity or assessments are not cached.
- **Render (FastAPI):** Uvicorn access logs contain the client address, method, path (`/assessments`), and status, never request bodies. Do not enable request-body logging or debug middleware in staging or production.

## Administrator account data

The `/admin` page shows authorized admins a paginated list of account IDs, email addresses,
application roles, and disabled status. Every admin request checks the current Auth user and
server-controlled `app_metadata.app_role`; user-editable metadata cannot grant access.
Creating or changing an account sends its details to Supabase Auth. Passwords are cleared
from submitted form fields, not logged or stored by this app, and never included in responses.
Supabase stores account credentials and metadata under its own retention policy.

Admin access does not add assessment storage or access to other users' browser drafts.
An issued assessment access token may remain valid until expiry after disabling an account;
the admin routes also perform a live user/role check. See [admin setup](../README_SUPABASE.md).

## What we tell users

The describe step explains that the description stays in the browser, questionnaire answers are sent for scoring without server storage, and the draft clears after 30 minutes of inactivity. The draft also clears on tab close and on start over; the copy leaves those out as self-evident. If retention changes, update that copy in `frontend/components/AssessmentWizard.tsx` in the same change.
