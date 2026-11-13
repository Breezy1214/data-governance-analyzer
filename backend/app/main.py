from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.auth import TokenVerifier, require_session
from app.config import Settings
from app.logging_config import configure_logging, logger
from app.rate_limit import SlidingWindowLimiter, require_demo_quota
from app.request_limits import RequestBodyLimitMiddleware
from app.scoring import AssessmentRequest, AssessmentResponse, score_assessment

configure_logging()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.token_verifier = TokenVerifier(settings)
        yield

    app = FastAPI(
        title="Data Governance Readiness API",
        description="Transparent rule-based privacy risk-scoring service.",
        version=settings.version,
        lifespan=lifespan,
    )

    app.state.demo_limiter = SlidingWindowLimiter(settings.demo_rate_per_client, settings.demo_rate_total)
    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=settings.max_request_bytes)

    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
        request_id = str(uuid.uuid4())
        error = {401: "unauthorized", 429: "rate_limited", 503: "auth_unavailable"}.get(
            exc.status_code, "request_failed"
        )
        logger.warning("request_rejected", extra={"fields": {"requestId": request_id, "error": error}})
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": error, "message": exc.detail, "requestId": request_id},
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        request_id = str(uuid.uuid4())
        known_fields = AssessmentRequest.model_fields.keys()
        invalid_fields = sorted(
            {
                str(error["loc"][1])
                if len(error["loc"]) > 1 and error["loc"][1] in known_fields
                else "body"
                for error in exc.errors()
            }
        )
        logger.warning(
            "assessment_validation_failed",
            extra={"fields": {"requestId": request_id, "invalidFields": invalid_fields}},
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": "invalid_input",
                "message": "One or more fields are missing or invalid.",
                "requestId": request_id,
                "fields": invalid_fields,
            },
        )

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok", "environment": settings.environment}

    @app.get("/version", tags=["system"])
    def version() -> dict[str, str]:
        return {"version": settings.version}

    @app.post("/assessments", response_model=AssessmentResponse, tags=["assessment"],
              dependencies=[Depends(require_session)])
    def create_assessment(payload: AssessmentRequest, response: Response) -> AssessmentResponse:
        return _score(payload, response, demo=False)

    # Public so visitors can try sample scenarios without an account. Scoring is stateless and
    # the description never reaches the API, so the only protection needed is a rate limit.
    @app.post("/demo/assessments", response_model=AssessmentResponse, tags=["assessment"],
              dependencies=[Depends(require_demo_quota)])
    def create_demo_assessment(payload: AssessmentRequest, response: Response) -> AssessmentResponse:
        return _score(payload, response, demo=True)

    return app


def _score(payload: AssessmentRequest, response: Response, *, demo: bool) -> AssessmentResponse:
    request_id = str(uuid.uuid4())
    # Results describe a sensitive use case; keep them out of browser and proxy caches.
    response.headers["Cache-Control"] = "no-store"
    result = score_assessment(payload)
    logger.info(
        "assessment_scored",
        extra={
            "fields": {
                "requestId": request_id,
                "demo": demo,
                "schemaVersion": result.schemaVersion,
                "rulesVersion": result.rulesVersion,
                "mappingVersion": result.mappingVersion,
                "score": result.score,
                "riskLevel": result.level,
                "ruleIds": [factor.ruleId for factor in result.factors],
            }
        },
    )
    return result


app = create_app()
