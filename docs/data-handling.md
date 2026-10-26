# Data handling and retention (v1.0)

> Historical baseline. On the SCRUM 22 review branch, authentication is required and session metadata
> is stored separately. See [SCRUM 22](../README-SCRUM-22.md) for the current account/session policy.
> Assessment answers remain unsaved on the server. Logout and account changes also clear local drafts.

Implements SCRUM-16. The analyzer assesses potentially sensitive use cases, so it applies the same data-minimization principle it recommends.

## Decision

Assessments remain **stateless**: answers and reports are not retained on the server.
SCRUM-22 adds authenticated accounts and a separate local session database containing
identity/session metadata and encrypted provider tokens, not assessment content.

- Authentication is required on this review branch. Hosted deployment remains blocked until
  production session storage and real-provider HTTPS checks are complete; see [SCRUM-22](../README-SCRUM-22.md).

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
   The Next.js server forwards the request to FastAPI `POST /assessments` with server-only credentials.
   Nothing goes in the URL or query string. FastAPI verifies the session and is the only scoring implementation;
   if it is unavailable, the browser displays an error and does not produce a score.
3. The API scores the request in memory and returns the result with `Cache-Control: no-store`. Nothing is written to a database.
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

## Logs, analytics, URLs, and errors

- **Application logs** (`backend/app/logging_config.py`) record only a random request ID, schema/rules versions, score, level, and fired rule IDs. Raw answers and free text are never logged. Covered by `test_scoring_logs_exclude_questionnaire_input`.
- **Validation errors** report field names only, never submitted values or unknown field names. Covered by `test_invalid_input_returns_clear_client_error_without_echoing_input` and `test_user_controlled_extra_field_name_is_not_echoed_or_logged`.
- **URLs:** assessment content never appears in paths or query strings. The only route is `/`.
- **Analytics and error reporting:** none are installed. Any tool added later must not capture request bodies, form values, or `sessionStorage`.

## Hosted environments

- **Vercel (frontend):** static page. Input stays in the browser.
- **Render (FastAPI):** Uvicorn access logs contain the client address, method, path (`/assessments`), and status, never request bodies. Do not enable request-body logging or debug middleware in staging or production.

## What we tell users

The describe step explains that the description stays in the browser, questionnaire answers are sent for scoring without server storage, and the draft clears after 30 minutes of inactivity. The draft also clears on tab close and on start over; the copy leaves those out as self-evident. If retention changes, update that copy in `frontend/components/AssessmentWizard.tsx` in the same change.
