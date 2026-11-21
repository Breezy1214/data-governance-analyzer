from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import Error as DatabaseError
from psycopg_pool import PoolTimeout

from app.auth import TokenVerifier
from app.config import Settings
from app.logging_config import configure_logging, logger
from app.rate_limit import ScoredClaims, SlidingWindowLimiter, require_demo_quota
from app.register.reviews import router as review_router
from app.register.routes import UNAVAILABLE, RegisterUnavailable
from app.register.routes import router as register_router
from app.register.store import PostgresRegisterStore
from app.request_limits import RequestBodyLimitMiddleware
from app.scoring import AssessmentRequest, AssessmentResponse
from app.scoring.models import Simulation
from app.service import score_and_log, simulate_and_log

configure_logging()

ERROR_CODES = {401: "unauthorized", 404: "not_found", 409: "conflict", 429: "rate_limited", 503: "auth_unavailable"}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    store = PostgresRegisterStore(settings.database_url) if settings.database_url else None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.token_verifier = TokenVerifier(settings)
        if store is None:
            logger.warning("register_unconfigured", extra={"fields": {"reason": "DATABASE_URL is not set"}})
        else:
            store.open()
        yield
        if store is not None:
            store.close()

    app = FastAPI(
        title="Data Governance Readiness API",
        description="Transparent rule-based privacy risk-scoring service.",
        version=settings.version,
        lifespan=lifespan,
        # Outside local development the routes are not registered at all, so /docs, /redoc and
        # /openapi.json return 404 instead of advertising the API's shape.
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )

    app.state.settings = settings
    app.state.register_store = store
    app.state.demo_limiter = SlidingWindowLimiter(settings.demo_rate_per_client, settings.demo_rate_total)
    app.state.scoring_limiter = SlidingWindowLimiter(settings.scoring_rate_per_user, settings.scoring_rate_total)
    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=settings.max_request_bytes)

    def error_response(status: int, message: str, error: str | None = None,
                       headers: dict[str, str] | None = None) -> JSONResponse:
        request_id = str(uuid.uuid4())
        error = error or ERROR_CODES.get(status, "request_failed")
        logger.warning("request_rejected", extra={"fields": {"requestId": request_id, "error": error}})
        return JSONResponse(
            status_code=status,
            content={"error": error, "message": message, "requestId": request_id},
            headers={**(headers or {}), "Cache-Control": "no-store"},
        )

    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return error_response(exc.status_code, exc.detail, headers=exc.headers)

    @app.exception_handler(RegisterUnavailable)
    @app.exception_handler(DatabaseError)
    @app.exception_handler(PoolTimeout)
    async def handle_register_unavailable(request: Request, exc: Exception) -> JSONResponse:
        return error_response(503, UNAVAILABLE, "register_unavailable")
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

    # Public so visitors can try sample scenarios without an account. Demo results are never saved and
    # the description never reaches the API, so the only protection needed is a rate limit.
    @app.post("/demo/assessments", response_model=AssessmentResponse, tags=["assessment"],
              dependencies=[Depends(require_demo_quota)])
    def create_demo_assessment(payload: AssessmentRequest, response: Response) -> AssessmentResponse:
        return score_and_log(payload, response, demo=True, api_version=settings.version)

    # What-if re-scoring for the result on screen. Neither route touches the register, so a simulation can
    # never change a saved assessment. One call returns every combination, so toggling needs no more requests.
    @app.post("/simulations", response_model=Simulation, tags=["simulation"])
    def create_simulation(payload: AssessmentRequest, response: Response, _claims: ScoredClaims) -> Simulation:
        return simulate_and_log(payload, response, demo=False)

    @app.post("/demo/simulations", response_model=Simulation, tags=["simulation"],
              dependencies=[Depends(require_demo_quota)])
    def create_demo_simulation(payload: AssessmentRequest, response: Response) -> Simulation:
        return simulate_and_log(payload, response, demo=True)

    app.include_router(register_router)
    app.include_router(review_router)
    return app


app = create_app()
