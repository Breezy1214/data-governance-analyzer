# Data Governance Readiness Analyzer

A guided, plain-language assessment for identifying privacy and governance risks before a proposed data use case moves forward.

## Architecture

- `frontend/` — Next.js App Router, React, TypeScript, and Tailwind CSS; collects answers and renders backend results
- `backend/` — FastAPI service and the single source of truth for assessment scoring
- `docs/` — versioned scoring rubric, capability language, deployment guidance, [data handling and retention](docs/data-handling.md), the [accessibility review](docs/accessibility-review.md), and the [usability scenarios](docs/usability-scenarios.md)
- [Scoring verification](docs/scoring-verification.md) — the SCRUM-14 correctness matrix, reproducible commands, performance conditions, results, and limitations
- `.github/workflows/ci.yml` — frontend and backend quality gates

## Local development

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000
```

Check `http://localhost:8000/health` or `http://localhost:8000/version`.

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`. `NEXT_PUBLIC_API_BASE_URL` is required and the example configuration points it to `http://localhost:8000`.

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

## SCRUM 12 Integration

The approved risk-to-safeguard mapping is integrated with assessment API schema v2.
See [mapping v1.1](docs/recommendation-mapping-v1.1.md) for approval, applicability,
and result traceability. Scoring remains server-only; general safeguards and
Karlsgate-specific recommendations are kept separate.
