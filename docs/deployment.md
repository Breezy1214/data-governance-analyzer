# Deployment and environments

## Recommended topology

| Layer | Local | Preview / staging | Production |
| --- | --- | --- | --- |
| Next.js + TypeScript frontend | `next dev` | Vercel preview deployment | Vercel production deployment |
| FastAPI service | Uvicorn | Render preview/staging service | Render web service |

FastAPI calculates assessments in memory and is required for scoring. Supabase Auth manages
accounts and sessions; assessment content is not stored in its database. Next.js uses
`@supabase/ssr` with server-only HttpOnly cookies. FastAPI independently verifies Supabase
access JWTs using the project's public signing keys. There is no application session database
or shared frontend/backend secret. Render runs the backend directly with Python (no Docker).

## Frontend (Vercel)

### Project

| Setting | Value |
| --- | --- |
| Vercel project | `data-governance-analyzer` (`prj_94He62gpSaD2mc8c5WYBUbN88b27`, scope `breezy1214s-projects`) |
| Production URL | https://data-governance-analyzer.vercel.app |
| Git repository | `bsu-capstone/data-governance-analyzer-3-f26` |
| Production branch | `main` — every push to `main` deploys to production |
| Preview deployments | Every other branch and every pull request |
| Root directory | `frontend` |
| Framework / install / build | Next.js / `npm ci` / `npm run build` (from `frontend/vercel.json`) |
| Output | Vercel's Next.js builder (default `.next`) |
| Node.js | 22.x (matches `engines` and CI) |

The Vercel GitHub app must be installed on the `bsu-capstone` organisation with access to this repository; otherwise Vercel cannot see the repo or receive push events.

Deployment Protection is on the team default: the production URL is public, while preview URLs require a Vercel login with team access. To share a preview with a reviewer, use the deployment's *Share* link.

### Connecting the repository

The project already exists with the settings above. Once the GitHub app has access to the org repo, run from the repository root:

```bash
vercel link --yes --project data-governance-analyzer --scope breezy1214s-projects
```

```bash
vercel git connect https://github.com/bsu-capstone/data-governance-analyzer-3-f26.git
```

Then add the API URL for each environment (the CLI prompts for the value, so it never lands in shell history):

```bash
vercel env add API_BASE_URL production
```

```bash
vercel env add API_BASE_URL preview
```

Vercel uses the repository's default branch (`main`) as the production branch. Trigger the first production build by pushing or merging to `main`, or with `vercel --prod` from the repository root.

Day-to-day flow: work lands on `dev` in `origin`, is reviewed, then merged into `main` on the organisation remote. That merge is the production release.

### Environment variables

| Name | Production | Preview | Notes |
| --- | --- | --- | --- |
| `API_BASE_URL` | Production FastAPI URL | Staging FastAPI URL | Server-only; use HTTPS on hosted environments |
| `SUPABASE_URL` | Production Auth project origin | Staging Auth project origin | Must match the corresponding backend |
| `SUPABASE_PUBLISHABLE_KEY` | Production publishable key | Staging publishable key | Not a service-role or secret key |
| `SUPABASE_SECRET_KEY` | Production server-only secret key | Staging server-only secret key | Only for admin account management; never public or sent to FastAPI |
| `APP_ORIGIN` | Optional canonical HTTPS origin | Optional canonical preview origin | Same-origin requests work without it; use for a trusted reverse proxy |

Add the Supabase variables to both Vercel environments as well, then redeploy.
See [the login and admin setup guide](../README_SUPABASE.md) for creating confirmed accounts
and granting the first admin role. Admin pages and routes authorize against current Auth
app metadata on every request. Ordinary users cannot manage accounts. The separate admin
client does not reuse SSR cookies and never exposes its secret key to the browser.
None of these variables needs a `NEXT_PUBLIC_` prefix. Provider sessions stay in HttpOnly
cookies and are never returned in browser JSON. Missing configuration produces a generic
service-unavailable response, not a silent redirect to login. There is no browser scoring fallback.

### Request boundaries

The browser calls only the same-origin Next.js `/api/*` routes. Next.js calls FastAPI
server-to-server, so FastAPI no longer grants browser CORS access. This does not replace
authorization: direct backend requests must carry a valid signed user access token.
POST handlers check Origin and reject cross-site Fetch Metadata. They accept the request
origin, optional `APP_ORIGIN`, and the exact Vercel-provided `VERCEL_URL`, never arbitrary
Vercel subdomains. Reverse proxies must sanitize forwarded host headers.

FastAPI enforces `MAX_REQUEST_BYTES`; assessment bodies are streamed to it rather than
buffered and validated twice. Set platform-level request-body limits for the Next.js login
route and edge abuse protection. Supabase owns login rate limiting; there is no shared
application-wide login counter that can lock every user out.

### Supabase setup

Enable email/password authentication, provision a confirmed test account, and use an
asymmetric signing key (ES256 or RS256). Legacy HS256 tokens are intentionally rejected;
migrate signing keys before rollout. The backend validates issuer, audience, expiry,
user/session identifiers, and the authenticated non-anonymous role.

Agree the session lifetime, idle policy, account provisioning, and recovery procedure with
the team. Configure supported session controls in Supabase; available controls depend on
the plan. The browser's 30-minute draft timer is not an authentication lifetime.
Sign-out revokes the current refresh session. Copied access JWTs remain valid until their
expiry, so choose a short appropriate access-token lifetime. Immediate token revocation
would need an additional online session/revocation check.

### Verification

For both a preview and the production URL:

1. Without a session, opening the site redirects to sign-in; a direct backend assessment returns 401.
2. Verify wrong credentials produce the same error regardless of account existence. Sign in with a confirmed account.
3. Complete an assessment; `POST /api/assessments` returns 200 and only scored fields are sent (no free-text description).
4. Switch tabs, return, and simulate a temporary session-check outage: the current step and result must remain.
   Refresh, verify cookie renewal across access-token expiry, then download the browser-generated PDF.
5. Record the deployment URL and commit SHA on SCRUM-18 / release notes.
6. Sign out, verify private drafts clear across tabs, and confirm protected navigation redirects.
   Verify expired refresh sessions prompt sign-in. Check Secure/HttpOnly cookies, no-store headers,
   cross-site POST rejection, and 413 responses for oversized assessments.

Automated tests use mocked Auth responses and real locally signed JWTs, not a live Supabase
project. These deployed checks are still required; passing unit tests does not establish them.

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "Assessment service is unavailable" on every submit | `API_BASE_URL` missing or wrong | Set it in Vercel for the right environment, then redeploy |
| Authentication returns 503 | Missing Supabase configuration or Auth/JWKS outage | Check host configuration and provider status without logging credentials |
| Backend exits during startup | Missing or invalid `SUPABASE_URL` | Set an HTTPS project origin before deployment |
| Login POST returns 403 | Reverse-proxy origin mismatch | Configure the canonical `APP_ORIGIN`; do not disable origin checks |
| First request is slow or times out | Backend host cold start | Retry; consider a paid instance for demos |
| Build fails on `npm ci` | `package-lock.json` out of sync | Run `npm install` locally and commit the lockfile |
| Push to `main` doesn't deploy | Vercel GitHub app lacks access to the org repo | Re-grant the app access to `bsu-capstone/data-governance-analyzer-3-f26` |

### Rollback

- **Fastest:** Vercel dashboard → Deployments → choose the last good production deployment → *Instant Rollback* (or `vercel rollback <deployment-url>`). Auto-assignment of the production domain pauses until a deployment is promoted again.
- **Durable:** revert the bad commit on `main` (`git revert`) and push; Vercel deploys the reverted state. Then promote it to resume normal auto-deploys.

## Backend

The root `render.yaml` defines the FastAPI service as a native Python web service: Render runs `pip install .` and starts `uvicorn app.main:app --host 0.0.0.0 --port $PORT` from `backend/`, on Python 3.12. Set these environment variables in the host dashboard:

- `SUPABASE_URL`: HTTPS project origin matching the frontend's Supabase project.
- `SUPABASE_JWT_AUDIENCE`: defaults to `authenticated`.
- `MAX_REQUEST_BYTES`: maximum accepted request-body size; defaults to `16384` bytes. Keep the platform proxy limit at or below this value when possible.

The service exposes `/health`, `/version`, `/docs`, and `POST /assessments`.

Configuration is validated at application startup in every environment, including staging.
The health endpoint indicates the process started; it is not a live Supabase availability check.
Public signing keys are fetched lazily and cached for five minutes, with refresh for unknown key IDs.

Remove the obsolete `NEXT_PUBLIC_API_BASE_URL`, `ALLOWED_ORIGINS`, and `ALLOWED_ORIGIN_REGEX`
settings from hosts.

## Secrets

- Commit only `.env.example` files.
- Store environment values in Vercel, Render, and GitHub encrypted settings.
- Keep staging and production configuration separate.
- Vercel build logs never print environment values; do not `echo` them in build scripts.
- The backend logs request IDs, scores and invalid field names only — never assessment answers or free text.
- Never enable request-body, Cookie, or Authorization-header logging on login/API routes or proxies.

Implementation references: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys),
and [PyJWT verification](https://pyjwt.readthedocs.io/en/stable/usage.html).
