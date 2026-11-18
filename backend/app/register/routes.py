"""Signed-in assessments. Scoring and saving happen in one request, so the register only ever holds results
this API produced, owned by the user whose token it verified."""

from __future__ import annotations

import uuid
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from psycopg import Error as DatabaseError
from psycopg_pool import PoolTimeout

from app.auth import require_session
from app.logging_config import logger
from app.rate_limit import ScoredClaims
from app.register.models import (
    AssessmentRecord,
    AssessmentVersion,
    RegisterEntry,
    SavedVersion,
    SignedInAssessmentResponse,
)
from app.register.store import AssessmentLocked, AssessmentNotFound, RegisterStore
from app.scoring import AssessmentRequest
from app.service import score_and_log

NOT_FOUND = "That assessment could not be found."
LOCKED = "This assessment has a version in review or approved, so it can't be deleted."
UNAVAILABLE = "The register is temporarily unavailable."

router = APIRouter(tags=["register"])


class RegisterUnavailable(Exception):
    """No database is configured, so saved assessments can't be read or changed."""


def register_store(request: Request) -> RegisterStore | None:
    return request.app.state.register_store


Claims = Annotated[dict, Depends(require_session)]
Store = Annotated[RegisterStore | None, Depends(register_store)]


def _assessment_id(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise HTTPException(404, NOT_FOUND) from None


def _require(store: RegisterStore | None) -> RegisterStore:
    if store is None:
        raise RegisterUnavailable
    return store


def _score_and_save(request: Request, payload: AssessmentRequest, response: Response, claims: dict,
                    store: RegisterStore | None, assessment_id: UUID | None) -> SignedInAssessmentResponse:
    result = score_and_log(payload, response, demo=False, api_version=request.app.state.settings.version)
    saved = None
    if store is not None:
        try:
            saved_id, version = store.save(claims["sub"], payload.model_dump(), result.model_dump(mode="json"), assessment_id)
            saved = SavedVersion(assessmentId=saved_id, version=version)
        except AssessmentNotFound:
            raise HTTPException(404, NOT_FOUND) from None
        except (DatabaseError, PoolTimeout) as error:
            logger.warning("assessment_save_failed",
                           extra={"fields": {"requestId": str(uuid.uuid4()), "error": type(error).__name__}})
    return SignedInAssessmentResponse(**result.model_dump(), saved=saved)


@router.post("/assessments", response_model=SignedInAssessmentResponse)
def create_assessment(request: Request, payload: AssessmentRequest, response: Response,
                      claims: ScoredClaims, store: Store):
    return _score_and_save(request, payload, response, claims, store, None)


@router.post("/assessments/{assessment_id}/versions", response_model=SignedInAssessmentResponse)
def reassess(assessment_id: str, request: Request, payload: AssessmentRequest, response: Response,
             claims: ScoredClaims, store: Store):
    return _score_and_save(request, payload, response, claims, store, _assessment_id(assessment_id))


@router.get("/assessments", response_model=list[RegisterEntry])
def list_assessments(response: Response, claims: Claims,
                     store: Store):
    response.headers["Cache-Control"] = "no-store"
    return [
        RegisterEntry(assessmentId=row["assessment_id"], version=row["version"], versionCount=row["version_count"],
                      status=row["status"], score=row["score"], level=row["risk_level"], answers=row["answers"],
                      savedAt=row["saved_at"])
        for row in _require(store).entries(claims["sub"])
    ]


@router.get("/assessments/{assessment_id}", response_model=AssessmentRecord)
def get_assessment(assessment_id: str, response: Response, claims: Claims,
                   store: Store):
    response.headers["Cache-Control"] = "no-store"
    record_id = _assessment_id(assessment_id)
    rows = _require(store).versions(claims["sub"], record_id)
    if not rows:
        raise HTTPException(404, NOT_FOUND)
    return AssessmentRecord(assessmentId=record_id, versions=[
        AssessmentVersion(id=row["id"], version=row["version"], status=row["status"], answers=row["answers"],
                          result=row["result"], savedAt=row["created_at"])
        for row in rows
    ])


@router.delete("/assessments/{assessment_id}", status_code=204)
def delete_assessment(assessment_id: str, claims: Claims,
                      store: Store) -> Response:
    try:
        _require(store).delete(claims["sub"], _assessment_id(assessment_id))
    except AssessmentNotFound:
        raise HTTPException(404, NOT_FOUND) from None
    except AssessmentLocked:
        raise HTTPException(409, LOCKED) from None
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
