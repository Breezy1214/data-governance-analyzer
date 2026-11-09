# Data Governance Readiness Analyzer

A guided, plain-language assessment for identifying privacy and governance risks before a proposed data use case moves forward.

## Architecture

- `frontend/` — Next.js App Router, React, TypeScript, and Tailwind CSS; collects answers and renders backend results
- `backend/` — FastAPI service and the single source of truth for assessment scoring
- `docs/` — the [scoring rubric](docs/risk-scoring-rubric-v2.0.md) and [data handling and retention](docs/data-handling.md)
- `.github/workflows/ci.yml` — frontend and backend quality gates

## Local development

Install dependencies below and configure private environment files from the examples.
On macOS/Linux, run both services together with the team's startup script:

```bash
./scripts/start-dev.sh
```

Press `Ctrl+C` to stop the frontend and backend.

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000 --env-file .env
```

Check `http://localhost:8000/health` or `http://localhost:8000/version`.

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000/login`. Set server-only `API_BASE_URL`, `SUPABASE_URL`, and
`SUPABASE_PUBLISHABLE_KEY` in the frontend environment. Set `SUPABASE_URL` in the backend
environment. Use the same Supabase project with an asymmetric signing key (ES256 or RS256)
and a confirmed account, either added in Supabase or created at `/signup` once email is set up. Never use a service-role key or commit private environment
files. Do not overwrite existing environment files when copying the examples.

## Quality checks

```bash
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
```

```bash
cd backend
pytest
ruff check app tests
```

To reproduce the assessment response-time check:

```bash
cd backend
./.venv/bin/pytest -q -s tests/test_api.py::test_assessment_response_time_is_under_two_seconds_for_demo_conditions
```

## Deployment

Deploy `frontend/` and `backend/` separately over HTTPS, set the variables from each `.env.example`,
and point `API_BASE_URL` at the backend. Do not commit credentials or production-sensitive data.

Supabase manages login and refresh sessions. Next.js uses `@supabase/ssr` cookies and
FastAPI verifies access-token signatures through the project's JWKS endpoint.

### Sign-up and password reset

Anyone can create an account at `/signup`. In Supabase Auth:

1. Set the Site URL to the production URL. Emailed links are built from it.
2. Add custom SMTP. The built-in email service only reaches the project's own team.
3. Point both email templates at the app, so links work on any device:
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
4. Keep "Confirm email" on and set the minimum password length to 15.

## Recommendations

Assessments use API schema 3.0, [rubric v2.0](docs/risk-scoring-rubric-v2.0.md), and
recommendation catalog v2.0 (`backend/app/scoring/mappings/v2.0.json`).
Scoring and recommendations are server-only, and recommendations link to regulatory guidance where it applies.
