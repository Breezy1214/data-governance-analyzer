"""Workspace reviews use the same verified identity and private database as saved assessments."""
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from psycopg import Error as DatabaseError
from pydantic import BaseModel, ConfigDict, Field

from app.register.models import ReviewQueueEntry, ReviewRole, Status
from app.register.routes import Claims, Store, _require
from app.register.store import AssessmentNotFound

router = APIRouter(prefix="/reviews", tags=["reviews"])

INVALID = "Check the selected account, workspace, and comment."
# Database messages, account existence and submitted comments are never passed through.
REVIEW_ERRORS = {
    "42501": (403, "You do not have permission to do this."),
    "40001": (409, "This record changed. Reload before trying again."),
    "22023": (400, INVALID),
    "23514": (400, INVALID),
    "23503": (400, INVALID),
    "RV001": (400, "You can’t change your own role. As admin you can already review teammates’ submissions."),
}


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CreateWorkspace(ReviewRequest):
    action: Literal["create"]
    name: str = Field(min_length=1, max_length=100)


class SetMember(ReviewRequest):
    action: Literal["member"]
    workspaceId: UUID
    userId: UUID
    role: ReviewRole | None


class Transition(ReviewRequest):
    action: Literal["transition"]
    versionId: UUID
    workspaceId: UUID | None
    status: Literal["in_review", "approved", "rejected", "changes_requested"]
    expectedStatus: Status
    note: str = Field(max_length=2000)


Action = Annotated[CreateWorkspace | SetMember | Transition, Field(discriminator="action")]


@router.post("")
def change_review(payload: Action, response: Response, claims: Claims, store: Store):
    response.headers["Cache-Control"] = "no-store"
    store, user = _require(store), claims["sub"]
    try:
        match payload:
            case CreateWorkspace():
                store.create_workspace(user, payload.name)
            case SetMember():
                store.set_member(user, payload.workspaceId, payload.userId, payload.role)
            case Transition():
                store.transition(user, payload.versionId, payload.workspaceId, payload.status, payload.note,
                                 payload.expectedStatus)
    except DatabaseError as error:
        if (mapped := REVIEW_ERRORS.get(error.sqlstate)) is None:
            raise
        raise HTTPException(*mapped) from None
    return {"ok": True}


@router.get("/workspaces")
def workspaces(response: Response, claims: Claims, store: Store):
    response.headers["Cache-Control"] = "no-store"
    return _require(store).review_workspaces(claims["sub"])


@router.get("/queue", response_model=list[ReviewQueueEntry])
def queue(response: Response, claims: Claims, store: Store):
    response.headers["Cache-Control"] = "no-store"
    return [ReviewQueueEntry(id=row["id"], assessmentId=row["assessment_id"], version=row["version"], score=row["score"],
                             level=row["risk_level"], answers=row["answers"], savedAt=row["created_at"],
                             workspace=row["workspace"])
            for row in _require(store).review_queue(claims["sub"])]


@router.get("/versions/{version_id}")
def context(version_id: UUID, response: Response, claims: Claims, store: Store):
    response.headers["Cache-Control"] = "no-store"
    try:
        return _require(store).review_context(claims["sub"], version_id)
    except AssessmentNotFound:
        raise HTTPException(404, "Assessment not found.") from None
