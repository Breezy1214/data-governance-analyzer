from __future__ import annotations

import uuid

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import Settings
from app.logging_config import configure_logging, logger
from app.request_limits import RequestBodyLimitMiddleware
from app.scoring import AssessmentRequest, AssessmentResponse, score_assessment

configure_logging()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    app = FastAPI(
        title="Data Governance Readiness API",
        description="Transparent rule-based privacy risk-scoring service.",
        version=settings.version,
    )

    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=settings.max_request_bytes)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_origin_regex=settings.allowed_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
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

    @app.post("/assessments", response_model=AssessmentResponse, tags=["assessment"])
    def create_assessment(payload: AssessmentRequest, response: Response) -> AssessmentResponse:
        request_id = str(uuid.uuid4())
        # Results describe a sensitive use case; keep them out of browser and proxy caches.
        response.headers["Cache-Control"] = "no-store"
        result = score_assessment(payload)
        logger.info(
            "assessment_scored",
            extra={
                "fields": {
                    "requestId": request_id,
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

    return app


app = create_app()
