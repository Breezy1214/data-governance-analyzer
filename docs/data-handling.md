# Data handling and retention (v1.1)

Implements SCRUM-16, updated for SCRUM-30 (saved assessments). The analyzer assesses potentially sensitive use cases, so it applies the same data-minimization principle it recommends.

## Decision

**Scoring is stateless; signed-in results are saved to the person's own register.** FastAPI scores in memory and
stores nothing. When a signed-in person completes an assessment, the Next.js server saves the scored answers and
FastAPI's result to that person's governance register in Supabase Postgres (see [Governance register](#governance-register)).
The free-text **description is never saved**: it stays in the browser tab. Demo mode (`/demo`) saves nothing.
Supabase manages authenticated accounts and session metadata. The application has no
local session database. Next.js stores Supabase session tokens in HttpOnly, SameSite=Lax
cookies (Secure on hosted HTTPS deployments); browser JavaScript cannot read them.
FastAPI verifies JWT signature, issuer, audience, expiry, and authenticated user claims.
New passwords are checked against Pwned Passwords; only the first five characters of the
password's SHA-1 hash leave the server.

## Field inventory

"Draft" is this tab's `sessionStorage`. "Register" is the signed-in person's saved assessments (`assessment_versions.answers`); demo mode never writes there.

| Field | Purpose | Sent to API | Stored |
| --- | --- | --- | --- |
| `description` | Gives the person context and appears in their on-screen record and downloaded report. Not scored. | **No** | Draft only. **Never in the register** |
| `dataTypes` | Data-sensitivity rules (`DATA_SENSITIVITY_*`), de-identification guidance, and HIPAA/PCI limitations | Yes | Draft; register |
| `purpose` | `PURPOSE_*` rules and purpose-specific guidance | Yes | Draft; register |
| `participants` | `PARTICIPANTS_*` rules and partner onboarding guidance | Yes | Draft; register |
| `environmentControl` | `ENVIRONMENT_NOT_OWNED` rule and enforcement guidance | Yes | Draft; register |
| `identifierProtection` | `IDENTIFIERS_*` rules and identifier-handling guidance | Yes | Draft; register |
| `custodyChange` | `CUSTODY_CHANGE` rule and custody guidance | Yes | Draft; register |
| `reusableKeys` | `REUSABLE_KEYS` rule and match-key guidance | Yes | Draft; register |
| `retainedArtifacts` | `RETAINED_ARTIFACTS` rule and deletion guidance | Yes | Draft; register |
| `smallResults` | `SMALL_RESULTS` rule and minimum-result guidance | Yes | Draft; register |
| `combined` | `COMBINED_REIDENTIFICATION` rule and combination guidance | Yes | Draft; register |
| `secondaryUse` | `SECONDARY_USE` rule and secondary-use approval gate | Yes | Draft; register |
| `regulations` | Specialist-review notes. Not scored. | Yes | Draft; register |
| `identifierConsistency` | `IDENTIFIERS_INCONSISTENT` signal and data-preparation guidance. Not scored. | Yes | Draft; register |
| `schemaVersion` | API contract versioning | Yes | Register |

The API schema does not accept `description`; it remains exclusively in the browser for the on-screen record and local PDF report.
The register enforces the same rule: a database check rejects any saved answers containing a `description` key.

### Personal details in the description

The description must describe kinds of data ("customer email addresses"), not contain them. `frontend/lib/sensitive-data.ts` screens it for names, email addresses, phone numbers, dates of birth, ages, street addresses and postcodes, Social Security and other government ID numbers, payment card and bank account numbers, labelled ID and account numbers, IP and device/advertising IDs, and passwords, keys and access tokens. Text is normalized first (NFKC, invisible characters removed, dash variants unified) so look-alike characters cannot slip a value past the checks.

- **Continue is blocked** while the description contains any of these. The message names only the kinds found, never the values, and offers to replace them with placeholders such as `[email]`.
- **Imported documents** are redacted before the text reaches the form, and the person is told placeholders were inserted.
- **The draft in `sessionStorage`** only ever holds the redacted description, and drafts saved before screening are redacted on load.
- **The PDF report** redacts the use case again as a last line of defence.

Pattern-based values (emails, numbers, IDs, keys) are caught reliably. Names are found three ways, so they don't depend on a first-name list that favours some cultures over others:

- compromise's name lexicon and cues such as "customer …", "Dr. …", "my wife …" and "Name: …";
- any capitalized word that is not common English (SCOWL size 50, via `wordlist-english`), a known organization, product or place, or an industry term (`frontend/lib/known-words.ts`), together with any first or last name beside it;
- lower-case names in positions that take a person ("my husband …", "ask …", "send it to …", "submitted by …", "…'s records"), and any two non-English lower-case words together ("adaeze okeke");
- names in ALL CAPS, in pasted table rows (lines of short fields; prose with commas is not a table), in lists next to another name ("Chidinma, segun and ngozi"), and words in scripts without capital letters (Chinese, Arabic, Devanagari and others). @handles are caught as their own kind.

A capitalized phrase is left alone when it names an organization ("Grant Thornton"), a product written in CamelCase ("PostHog"), a programme, team or place ("Wellness Program", "RevOps teams", "Ikeja and Lekki stores", "in Lagos and Abuja"), a system introduced by a system verb ("sync with Airtable"), or a brand the text itself describes ("Company 1: Airtasker", "Smartsheet, a saas company", "AWS Graviton"). Once a word is shown to be a brand, every mention of it is left alone. An unfamiliar brand with no such context can still be flagged; the person can then describe it generically ("our CRM vendor").

`frontend/tests/fixtures/name-detection.json` holds the sentences used to measure this: every listed name must be redacted and no safe sentence flagged. Add a sentence there whenever a miss or a false block is reported. A single lower-case name with no cue before it ("forward to segun later" is caught; "segun approved it" is not) can still pass, so the help text continues to ask people to leave names out.

## Data flow

1. The person types into the wizard. Input is held in React state and mirrored to `sessionStorage` (`governance-assessment-draft-v2`) so a refresh does not lose work.
2. On **Assess risk**, the browser sends only the scored fields to same-origin `POST /api/assessments`
   (or `POST /api/assessments/{id}/versions` when re-assessing). The Next.js server forwards them to FastAPI
   `POST /assessments` with the user's verified access token. Nothing goes in the URL or query string. FastAPI
   verifies the session and is the only scoring implementation; if it is unavailable, the browser displays an error
   and does not produce a score.
3. FastAPI scores the request in memory, stores nothing, and returns the result, plus the answers it accepted,
   with `Cache-Control: no-store`.
4. The Next.js server saves those accepted answers and FastAPI's result to the register as the signed-in user, so
   row-level security applies. The browser never supplies the score. If saving fails, the person still gets the
   result and is told it wasn't saved. Demo scoring (`POST /api/demo/assessments`) skips this step entirely.
5. The PDF report is generated entirely in the browser (jsPDF) and downloaded with a generic filename (`data-governance-assessment.pdf`). It is never uploaded, and it carries no author or keyword metadata and no internal rule identifiers. See `frontend/lib/report.ts`.

## Governance register

Signed-in people get a register of their completed assessments at `/assessments` (SCRUM-30). Schema and access
rules: `supabase/migrations/`; isolation tests: `supabase/tests/database/assessments_rls.test.sql`.

**What is saved** (Supabase Postgres, project region us-west-2):

| Table | Holds |
| --- | --- |
| `assessments` | One row per assessment: ID, owner's user ID, created time |
| `assessment_versions` | One row per scoring: the scored answers, FastAPI's full result (score, level, guidance, factors, recommendation IDs and text, specialist-review notes), the rubric, catalog, API-contract and API versions, a status (`draft`, `in_review`, `approved`, `rejected`), and created/updated times |

Never saved: the use-case description, imported documents, the PDF report, names, emails or any other free text.
Assessments are titled from their answers (for example "Overlap analysis · Email addresses").

**Who can see it.** Only the owner. Row-level security limits every read and write to rows whose `user_id` is the
signed-in user; logged-out visitors and anonymous sign-ins have no access, and the app holds no service key that
could bypass it. Answers and results can't be edited after saving. Owners can move a version between `draft` and
`in_review`; approving and rejecting are reserved for the review workflow.

**How long it is kept.** Until the owner deletes it or their account is deleted:

| Event | Effect |
| --- | --- |
| Re-assessing | Adds a new version; earlier versions are kept unchanged |
| Owner deletes an assessment | All its versions are permanently deleted. Refused while any version is in review or approved, so decisions can't disappear |
| Account deleted | All the account's assessments and versions are deleted (cascade) |
| Logout, idle timeout, tab close, **Start over** | Clear the browser draft only; the register is unaffected |

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
token revocation are set in Supabase. These rules cover the browser draft; saved assessments follow the
[register's retention](#governance-register).

## Logs, analytics, URLs, and errors

- **Application logs** (`backend/app/logging_config.py`) record only a random request ID, schema, rules and API versions, score, level, and fired rule IDs. Raw answers and free text are never logged. Covered by `test_scoring_logs_exclude_questionnaire_input`.
- **Validation errors** report field names only, never submitted values or unknown field names. Covered by `test_invalid_input_returns_clear_client_error_without_echoing_input` and `test_user_controlled_extra_field_name_is_not_echoed_or_logged`.
- **URLs:** assessment content and credentials never appear in paths or query strings.
  Routes include `/`, `/demo`, `/login`, `/signup`, `/forgot-password`, `/update-password`, `/assessments`,
  `/assessments/{id}` (optionally `?version=n`), `/assessments/{id}/reassess`, `/assessments/{id}/duplicate`, and
  same-origin `/api/*` handlers. Register URLs carry only a random assessment ID and a version number.
  Emailed `/auth/confirm` links carry a single-use token and no other personal data.
- **Analytics and error reporting:** none are installed. Any tool added later must not capture request bodies, form values, or `sessionStorage`.

## Hosted environments

- **Vercel (frontend):** dynamic server-rendered protected pages and same-origin API handlers.
  Free-text descriptions stay in the browser; responses containing identity or assessments are not cached.
- **Supabase:** accounts, sessions and the governance register. Register access uses the signed-in user's token
  through the Data API, with row-level security; only `authenticated` users have grants on the register tables.
- **Render (FastAPI):** Uvicorn access logs contain the client address, method, path (`/assessments`), and status, never request bodies. Do not enable request-body logging or debug middleware in staging or production.

## What we tell users

The describe step's summary cards say the draft clears after 30 minutes of inactivity and that the description is never saved: only answers and results go to My assessments. After scoring, the result says which version it was saved as, or that it wasn't saved. Saved assessments show "Not saved" in place of the description. Demo mode says nothing is saved. The draft also clears on tab close and on start over; the copy leaves those out as self-evident. If retention changes, update that copy in `frontend/components/AssessmentWizard.tsx`, `frontend/lib/register.ts` and this document in the same change.
