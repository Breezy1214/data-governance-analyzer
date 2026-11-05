# Scoring correctness and performance verification

This document records the reproducible evidence for SCRUM-14. The scoring rubric under test is [v2.0](risk-scoring-rubric-v2.0.md). The timing below was recorded against v1.0 and should be rerun after approval.

## Correctness matrix

The automated suite verifies:

- all threshold boundaries: 0, 29, 30, 59, 60, and 100;
- representative Low, Medium, and High assessments;
- every supported scoring factor, including every intended-use value;
- mutual exclusion of direct-identifier and high-sensitivity scoring;
- deterministic output and score capping;
- recommendation priority, rationale, and links to the answers that selected them;
- catalog text with no first-person wording, and HTTPS sources for all regulatory references;
- API validation, response structure, cache prevention, and privacy-safe logs.

Run the full backend verification from the repository root:

```bash
cd backend
./.venv/bin/pytest -q
./.venv/bin/ruff check app tests
```

## Response-time check

The performance acceptance test submits 25 sequential, valid assessments through FastAPI's in-process `TestClient`. This represents the expected single-user demo workload and includes request validation, scoring, recommendation mapping, response serialization, and application logging.

Run it with timing output:

```bash
cd backend
./.venv/bin/pytest -q -s tests/test_api.py::test_assessment_response_time_is_under_two_seconds_for_demo_conditions
```

Recorded on October 7, 2026:

| Condition | Value |
| --- | --- |
| Operating system | macOS 27.0, arm64 |
| Python | 3.9.6 |
| Requests | 25 sequential assessments |
| 95th percentile | 1.61 ms |
| Slowest response | 5.05 ms |
| Acceptance target | Every response under 2 seconds |
| Result | Pass |

## Limitations

This check deliberately isolates application response time. It does not include public-network latency, TLS termination, container cold starts, proxy queues, or host saturation. Deployment smoke tests should therefore repeat the timing check against the staged API before release. Timing varies by machine; the automated assertion is the authoritative pass/fail signal and reports the slowest observed request when it fails.

Assessment descriptions and questionnaire values are never printed by the performance test. Application diagnostics contain a generated request ID, version, score, level, and fired rule IDs only.
