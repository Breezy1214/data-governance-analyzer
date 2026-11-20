
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

from app.scoring.models import AssessmentResponse, RiskLevel

Status = Literal["draft", "in_review", "approved", "rejected", "changes_requested"]
ReviewRole = Literal["submitter", "reviewer", "admin"]


class SavedVersion(BaseModel):
    assessmentId: UUID
    version: int


class SignedInAssessmentResponse(AssessmentResponse):
    """None when the result couldn't be saved; the person still gets their result."""

    saved: SavedVersion | None


class RegisterEntry(BaseModel):
    assessmentId: UUID
    version: int
    versionCount: int
    status: Status
    score: int
    level: RiskLevel
    answers: dict[str, Any]
    savedAt: datetime


class AssessmentVersion(BaseModel):
    id: UUID
    version: int
    status: Status
    answers: dict[str, Any]
    result: dict[str, Any]
    savedAt: datetime


class ReviewQueueEntry(BaseModel):
    id: UUID
    assessmentId: UUID
    version: int
    score: int
    level: RiskLevel
    answers: dict[str, Any]
    savedAt: datetime
    workspace: str


class AssessmentRecord(BaseModel):
    assessmentId: UUID
    owned: bool
    versions: list[AssessmentVersion]
