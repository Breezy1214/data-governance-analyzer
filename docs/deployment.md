# Deployment and environments

## Recommended topology

| Layer | Local | Preview / staging | Production |
| --- | --- | --- | --- |
| Next.js + TypeScript frontend | `next dev` | Vercel preview deployment | Vercel production deployment |
| FastAPI service | Uvicorn | Render preview/staging service | Render web service |

FastAPI calculates assessments in memory and is required for scoring. There is no database or authentication service. Render builds and runs the backend directly with Python (no Docker); local development runs it with Uvicorn.

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
vercel env add NEXT_PUBLIC_API_BASE_URL production
```

```bash
vercel env add NEXT_PUBLIC_API_BASE_URL preview
```

Vercel uses the repository's default branch (`main`) as the production branch. Trigger the first production build by pushing or merging to `main`, or with `vercel --prod` from the repository root.

Day-to-day flow: work lands on `dev` in `origin`, is reviewed, then merged into `main` on the organisation remote. That merge is the production release.

### Environment variables

| Name | Production | Preview | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Production FastAPI URL | Staging FastAPI URL (or production if no staging) | Public by design; embedded in the browser bundle at build time |

`NEXT_PUBLIC_*` values are visible to every visitor, so never put secrets in them. Changing the value only takes effect after a redeploy. The frontend has no server-side secrets, and there is no browser scoring fallback: if the variable is missing the app shows "The assessment service is unavailable" without revealing configuration.

### Cross-origin access

The backend only accepts browser requests from approved origins:

- `ALLOWED_ORIGINS`: exact origins, including the production URL `https://data-governance-analyzer.vercel.app`.
- `ALLOWED_ORIGIN_REGEX`: optional full-match pattern for preview URLs, scoped to this project and team:
  `https://data-governance-analyzer-[a-z0-9-]+-breezy1214s-projects\.vercel\.app`

Leave `ALLOWED_ORIGIN_REGEX` unset on the production backend if previews use a separate staging backend.

### Verification

For both a preview and the production URL:

1. Open the site; the assessment wizard loads without console errors.
2. Complete an assessment; a score and explanation appear.
3. In DevTools → Network, `POST /assessments` returns 200 and only the scored fields are sent (no free-text description).
4. Download the PDF report.
5. Record the deployment URL and commit SHA on SCRUM-18 / release notes.

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "Assessment service is unavailable" on every submit | `NEXT_PUBLIC_API_BASE_URL` missing or wrong for that environment | Set it in Vercel for the right environment, then redeploy |
| Browser console shows a CORS error | Frontend origin not in `ALLOWED_ORIGINS` / `ALLOWED_ORIGIN_REGEX` | Add the origin on the backend host and restart it |
| First request is slow or times out | Backend host cold start | Retry; consider a paid instance for demos |
| Build fails on `npm ci` | `package-lock.json` out of sync | Run `npm install` locally and commit the lockfile |
| Push to `main` doesn't deploy | Vercel GitHub app lacks access to the org repo | Re-grant the app access to `bsu-capstone/data-governance-analyzer-3-f26` |

### Rollback

- **Fastest:** Vercel dashboard → Deployments → choose the last good production deployment → *Instant Rollback* (or `vercel rollback <deployment-url>`). Auto-assignment of the production domain pauses until a deployment is promoted again.
- **Durable:** revert the bad commit on `main` (`git revert`) and push; Vercel deploys the reverted state. Then promote it to resume normal auto-deploys.

## Backend

The root `render.yaml` defines the FastAPI service as a native Python web service: Render runs `pip install .` and starts `uvicorn app.main:app --host 0.0.0.0 --port $PORT` from `backend/`, on Python 3.12. Set these environment variables in the host dashboard:

- `ALLOWED_ORIGINS`: comma-separated exact frontend origins.
- `ALLOWED_ORIGIN_REGEX`: optional regex for Vercel preview origins (see above).
- `MAX_REQUEST_BYTES`: maximum accepted request-body size; defaults to `16384` bytes. Keep the platform proxy limit at or below this value when possible.

The service exposes `/health`, `/version`, `/docs`, and `POST /assessments`.

## Secrets

- Commit only `.env.example` files.
- Store environment values in Vercel, Render, and GitHub encrypted settings.
- Keep staging and production configuration separate.
- Vercel build logs never print environment values; do not `echo` them in build scripts.
- The backend logs request IDs, scores and invalid field names only — never assessment answers or free text.
