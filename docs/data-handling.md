# Data handling and retention (v1.0)

Implements SCRUM-16. The analyzer assesses potentially sensitive use cases, so it applies the same data-minimization principle it recommends.

## Decision

Assessments remain **stateless**: answers and reports are not retained on the server.
Supabase manages authenticated accounts and session metadata. The application has no
local session database. Next.js stores Supabase session tokens in HttpOnly, SameSite=Lax
cookies (Secure on hosted HTTPS deployments); browser JavaScript cannot read them.
FastAPI verifies JWT signature, issuer, audience, expiry, and authenticated user claims.
New passwords are checked against Pwned Passwords; only the first five characters of the
password's SHA-1 hash leave the server.

## Field inventory

| Field | Purpose | Sent to API | Stored |
| --- | --- | --- | --- |
| `description` | Gives the person context and appears in their on-screen record and downloaded report. Not scored. | **No** | This tab's `sessionStorage` only |
| `dataTypes` | Data-sensitivity rules (`DATA_SENSITIVITY_*`), de-identification guidance, and HIPAA/PCI limitations | Yes | This tab's `sessionStorage` only |
| `purpose` | `PURPOSE_*` rules and purpose-specific guidance | Yes | This tab's `sessionStorage` only |
| `participants` | `PARTICIPANTS_*` rules and partner onboarding guidance | Yes | This tab's `sessionStorage` only |
| `environmentControl` | `ENVIRONMENT_NOT_OWNED` rule and enforcement guidance | Yes | This tab's `sessionStorage` only |
| `identifierProtection` | `IDENTIFIERS_*` rules and identifier-handling guidance | Yes | This tab's `sessionStorage` only |
| `custodyChange` | `CUSTODY_CHANGE` rule and custody guidance | Yes | This tab's `sessionStorage` only |
| `reusableKeys` | `REUSABLE_KEYS` rule and match-key guidance | Yes | This tab's `sessionStorage` only |
| `retainedArtifacts` | `RETAINED_ARTIFACTS` rule and deletion guidance | Yes | This tab's `sessionStorage` only |
| `smallResults` | `SMALL_RESULTS` rule and minimum-result guidance | Yes | This tab's `sessionStorage` only |
| `combined` | `COMBINED_REIDENTIFICATION` rule and combination guidance | Yes | This tab's `sessionStorage` only |
| `secondaryUse` | `SECONDARY_USE` rule and secondary-use approval gate | Yes | This tab's `sessionStorage` only |
| `regulations` | Specialist-review notes. Not scored. | Yes | This tab's `sessionStorage` only |
| `identifierConsistency` | `IDENTIFIERS_INCONSISTENT` signal and data-preparation guidance. Not scored. | Yes | This tab's `sessionStorage` only |
| `schemaVersion` | API contract versioning | Yes | No |

The API schema does not accept `description`; it remains exclusively in the browser for the on-screen record and local PDF report.

### Personal details in the description

The description must describe kinds of data ("customer email addresses"), not contain them. `frontend/lib/sensitive-data.ts` screens it for names, email addresses, phone numbers, dates of birth, ages, street addresses and postcodes, Social Security and other government ID numbers, payment card and bank account numbers, labelled ID and account numbers, IP and device/advertising IDs, and passwords, keys and access tokens. Text is normalized first (NFKC, invisible characters removed, dash variants unified) so look-alike characters cannot slip a value past the checks.

- **Continue is blocked** while the description contains any of these. The message names only the kinds found, never the values, and offers to replace them with placeholders such as `[email]`.
- **Imported documents** are redacted before the text reaches the form, and the person is told placeholders were inserted.
- **The draft in `sessionStorage`** only ever holds the redacted description, and drafts saved before screening are redacted on load.
- **The PDF report** redacts the use case again as a last line of defence.

Pattern-based values (emails, numbers, IDs, keys) are caught reliably. Names are matched against a name lexicon and contextual cues such as "customer …", "Dr. …" and "Name: …"; an unlabelled name the lexicon doesn't know can still pass, so the help text continues to ask people to leave names out.

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
token revocation are set in Supabase.

## Logs, analytics, URLs, and errors

- **Application logs** (`backend/app/logging_config.py`) record only a random request ID, schema/rules versions, score, level, and fired rule IDs. Raw answers and free text are never logged. Covered by `test_scoring_logs_exclude_questionnaire_input`.
- **Validation errors** report field names only, never submitted values or unknown field names. Covered by `test_invalid_input_returns_clear_client_error_without_echoing_input` and `test_user_controlled_extra_field_name_is_not_echoed_or_logged`.
- **URLs:** assessment content and credentials never appear in paths or query strings.
  Routes include `/`, `/login`, `/signup`, `/forgot-password`, `/update-password`, and same-origin `/api/*` handlers.
  Emailed `/auth/confirm` links carry a single-use token and no other personal data.
- **Analytics and error reporting:** none are installed. Any tool added later must not capture request bodies, form values, or `sessionStorage`.

## Hosted environments

- **Vercel (frontend):** dynamic server-rendered protected pages and same-origin API handlers.
  Free-text descriptions stay in the browser; responses containing identity or assessments are not cached.
- **Render (FastAPI):** Uvicorn access logs contain the client address, method, path (`/assessments`), and status, never request bodies. Do not enable request-body logging or debug middleware in staging or production.

## What we tell users

The describe step explains that the description stays in the browser, questionnaire answers are sent for scoring without server storage, and the draft clears after 30 minutes of inactivity. The draft also clears on tab close and on start over; the copy leaves those out as self-evident. If retention changes, update that copy in `frontend/components/AssessmentWizard.tsx` in the same change.
