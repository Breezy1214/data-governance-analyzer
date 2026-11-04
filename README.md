# Data Governance Readiness Analyzer

A guided, plain-language assessment for identifying privacy and governance risks before a proposed data use case moves forward.

## Login and administrator setup

See [Create login accounts and an administrator](README_SUPABASE.md) for the Supabase setup,
first admin account, and team email/password instructions. Admins can use every assessment
feature and manage accounts at `/admin`. Credentials and the server-only admin key stay outside Git.

## Architecture

- `frontend/` — Next.js App Router, React, TypeScript, and Tailwind CSS; collects answers and renders backend results
- `backend/` — FastAPI service and the single source of truth for assessment scoring
- `docs/` — versioned scoring rubric, capability language, deployment guidance, [data handling and retention](docs/data-handling.md), the [accessibility review](docs/accessibility-review.md), and the [usability scenarios](docs/usability-scenarios.md)
- [Scoring verification](docs/scoring-verification.md) — the SCRUM-14 correctness matrix, reproducible commands, performance conditions, results, and limitations
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
and an existing confirmed account. Never use a service-role key or commit private environment
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

To reproduce the documented assessment response-time check:

```bash
cd backend
./.venv/bin/pytest -q -s tests/test_api.py::test_assessment_response_time_is_under_two_seconds_for_demo_conditions
```

## Deployment

Deployment configuration and environment requirements are documented in [docs/deployment.md](docs/deployment.md). Do not commit credentials or production-sensitive data.

Supabase manages login and refresh sessions. Next.js uses `@supabase/ssr` cookies and
FastAPI verifies access-token signatures through the project's JWKS endpoint.
Real-provider and HTTPS smoke tests are required before deploying; see the deployment guide.

## SCRUM 12 Integration

The approved risk-to-safeguard mapping is integrated with assessment API schema v2.
See [mapping v1.1](docs/recommendation-mapping-v1.1.md) for approval, applicability,
and result traceability. Scoring remains server-only; general safeguards and
Karlsgate-specific recommendations are kept separate.
