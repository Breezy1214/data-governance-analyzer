"""Workspace reviews use the same verified identity and private database as saved assessments."""
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from psycopg import Error as DatabaseError
from pydantic import BaseModel, ConfigDict, Field

from app.register.routes import Claims, Store, _require
from app.register.store import AssessmentNotFound

router = APIRouter(prefix="/reviews", tags=["reviews"])


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CreateWorkspace(ReviewRequest):
    action: Literal["create"]
    name: str = Field(min_length=1, max_length=100)


class SetMember(ReviewRequest):
    action: Literal["member"]
    workspaceId: UUID
    userId: UUID
    role: Literal["submitter", "reviewer", "admin"] | None


class Transition(ReviewRequest):
    action: Literal["transition"]
    versionId: UUID
    workspaceId: UUID | None
    status: Literal["in_review", "approved", "rejected", "changes_requested"]
    expectedStatus: Literal["draft", "in_review", "approved", "rejected", "changes_requested"]
    note: str = Field(max_length=2000)


Action = Annotated[CreateWorkspace | SetMember | Transition, Field(discriminator="action")]


@router.post("")
def change_review(payload: Action, response: Response, claims: Claims, store: Store):
    response.headers["Cache-Control"] = "no-store"
    try:
        _require(store).review_write(claims["sub"], payload.model_dump())
    except DatabaseError as error:
        # Do not expose database messages, account existence, or submitted comments.
        status = {"42501": 403, "40001": 409, "22023": 400, "23514": 400, "23503": 400}.get(error.sqlstate)
        if status is None:
            raise
        message = {403: "You do not have permission to do this.",
                   409: "This record changed. Reload before trying again.",
                   400: "Check the selected account, workspace, and comment."}[status]
        raise HTTPException(status, message) from None
    return {"ok": True}


@router.get("/workspaces")
def workspaces(response: Response, claims: Claims, store: Store):
    response.headers["Cache-Control"] = "no-store"
    return _require(store).review_read(claims["sub"], "workspaces")


@router.get("/queue")
def queue(response: Response, claims: Claims, store: Store):
    response.headers["Cache-Control"] = "no-store"
    return _require(store).review_read(claims["sub"], "queue")


@router.get("/versions/{version_id}")
def context(version_id: UUID, response: Response, claims: Claims, store: Store):
    response.headers["Cache-Control"] = "no-store"
    try:
        return _require(store).review_read(claims["sub"], "context", version_id)
    except AssessmentNotFound:
        raise HTTPException(404, "Assessment not found.") from None
