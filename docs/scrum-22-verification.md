# SCRUM 22 Local Verification

## October 26: Class Repository Integration

Prepared against `bsu-capstone/data-governance-analyzer-3-f26` dev at acc48d0.
Preserved the team's startup script and dependency fixes; updated startup configuration
for authenticated requests and ports 3022/8022.

- Backend: 89 tests passed; Ruff and mapping synchronization passed.
- Frontend: 141 tests passed; ESLint passed.
- Production build and TypeScript passed with `next build --webpack`.
- The default local Turbopack build encountered a Google Fonts network failure and then
  a worker-startup error. The successful fallback does not claim that default Turbopack
  passed locally; GitHub CI remains a separate check.
- `npm ci` completed and reported zero audit vulnerabilities.
- No real credentials, environment files, session databases, or build artifacts are included.
- The original local SCRUM-22 launcher was independently verified at http://localhost:3022/login.
  That smoke check does not establish real Supabase or hosted acceptance coverage.
- Real provider configuration, shared production session storage, HTTPS testing, and
  session-policy approval remain outstanding. This submission remains a draft for review.

## October 25: GitHub Review Preparation

Integrated the implementation with `dev` at eb1e00b in branch `scrum-22-authentication`.
The draft PR targets `dev`, not `main`. No production deployment is requested.

- Backend: 89 tests passed; Ruff and recommendation-mapping synchronization passed.
- Frontend: 141 tests passed across nine test files, including the team's document-import tests.
- ESLint and TypeScript passed; the Next.js 16.4.3 production build passed.
- Updated Next.js/eslint-config-next from 16.4.0 to 16.4.3 and patched transitive DOMPurify/Zod.
  The npm dependency audit reports zero vulnerabilities after the update.
- Reviewed the tracked file list and scanned for recognizable credential/private-key patterns.
  Real environment files, session databases, dependency directories, and local artifacts are excluded.
- Windows sandbox temporary-file errors were resolved by using a workspace temp directory.
  The successful frontend run used `vitest run --maxWorkers=1`; backend pytest used an isolated `--basetemp`.
- Browser evidence below is from October 21, not a newly repeated end-to-end run on this branch.
- Real Supabase sign-in and hosted HTTPS/storage acceptance checks remain outstanding. Keep the PR draft.

Dependency advisory references: [Next.js](https://github.com/advisories/GHSA-2464-fhr4-w9xw),
[DOMPurify](https://github.com/advisories/GHSA-cg2g-xh64-v4q7),
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
An audit result is a point-in-time dependency check, not a security certification.

## October 21: Original Local Verification

Scope at that date: local implementation only; nothing had been published to GitHub.

## Results

- Backend: 89 passing tests, including 13 authentication tests. Ruff passed.
- Frontend: 126 passing tests, including sign-in, draft isolation, proxy/cookie, and CSRF tests.
- TypeScript and ESLint passed. Next.js 16.4.0 production compilation passed.
- Browser check in headless Microsoft Edge passed using an explicitly launched test-only provider.
- Normal application verified separately: unauthenticated `/` redirects to login; missing Supabase
  configuration returns a generic unavailable message and does not accept the test credentials.

## Browser Coverage

Protected initial navigation; indistinguishable invalid-login errors; successful test login; HttpOnly cookie;
refresh and draft retention; real FastAPI scoring and approved SCRUM 12 recommendations; PDF download;
logout across two tabs; cleared drafts; old-session replay rejected; cross-origin POST rejected;
desktop 1365x900 and mobile 375x812 sign-in layout with no horizontal overflow.

Screenshots and downloaded test PDF are local artifacts under `.local/browser-check/` (not for source control).
The PDF test verifies generation/download; it is not a new full visual audit of every report page.

## Reproducing the Browser Check

The fixture `backend/tests/browser_fixture.py` uses a temporary database and a fake provider from the
backend test suite. It only starts with `SCRUM22_BROWSER_TEST=1`; the normal app never loads it.
Start it from `backend/` with the local virtual environment; it binds 127.0.0.1:8012.

Run a separate Next.js dev server on localhost:3012 with `API_BASE_URL=http://127.0.0.1:8012`
and `APP_ORIGIN=http://localhost:3012`, retaining the generated server-to-server key.
Do not run two dev servers against the same `.next` directory at once.

Run `node scripts/browser-auth-check.cjs` with Playwright available and Microsoft Edge installed.
`PLAYWRIGHT_MODULE` may point to an existing Playwright installation. Stop both test servers afterwards.
They were stopped after verification; the normal local application runs on ports 3002/8002.

## Not Yet Verified / Remaining Decisions

- Real Supabase credentials, login, refresh, password recovery and provider outages against a configured project.
- HTTPS Secure-cookie behavior and deployed frontend/backend connectivity.
- Stakeholder approval of proposed 30-minute idle and eight-hour maximum session duration.
- Account provisioning policy and recovery workflow (currently administrator-managed).
- Production shared session storage, scheduled deletion, infrastructure rate limits and operational monitoring.
- Independent security/accessibility review; this test evidence is not a security certification.
- Saved assessment history and client/team authorization are separate scope. No assessment records exist here.

The local SQLite adapter deliberately refuses hosted APP_ENV values. Do not remove that guard to deploy.
The full ticket should remain in progress until real-provider and hosted acceptance checks are complete.
