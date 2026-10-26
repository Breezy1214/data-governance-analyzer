"""Versioned request/response schemas for the risk-scoring service."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = "2.0"

DataType = Literal["names", "emails", "phone", "gov", "health", "financial"]
Purpose = Literal["matching", "ai", "analytics", "marketing", "research", "other"]
YesNo = Literal["yes", "no"]
RiskLevel = Literal["LOW", "MEDIUM", "HIGH"]


class AssessmentRequest(BaseModel):
    """Questionnaire responses for a single proposed data use case."""

    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["2.0"] = SCHEMA_VERSION
    dataTypes: list[DataType] = Field(min_length=1, max_length=6)
    externalAccess: YesNo
    rawExchange: YesNo
    dataMovement: YesNo
    combined: YesNo
    secondaryUse: YesNo
    purpose: Purpose

    @field_validator("dataTypes")
    @classmethod
    def data_types_must_be_unique(cls, value: list[DataType]) -> list[DataType]:
        if len(value) != len(set(value)):
            raise ValueError("data types must be unique")
        return value


class RiskFactor(BaseModel):
    ruleId: str
    category: str
    label: str
    points: int


class RecommendationDetail(BaseModel):
    id: str
    priority: int = Field(ge=1)
    title: str
    action: str
    rationale: str
    riskFactorIds: list[str] = Field(min_length=1)


class SafeguardRecommendation(BaseModel):
    id: str
    text: str
    factorIds: list[str]


class KarlsgateRecommendation(SafeguardRecommendation):
    label: str
    conditionId: str


class RecommendationResult(BaseModel):
    mappingVersion: str
    mappingApprovalStatus: Literal["pending", "approved"]
    generalSafeguards: list[SafeguardRecommendation]
    karlsgateRecommendations: list[KarlsgateRecommendation]


class AssessmentResponse(RecommendationResult):
    """Deterministic scoring output with full attribution."""

    schemaVersion: str
    rulesVersion: str
    score: int = Field(ge=0, le=100)
    level: RiskLevel
    guidance: str
    factors: list[RiskFactor]
    recommendationDetails: list[RecommendationDetail]
    capabilities: list[str]
    limitations: list[str]
    assessedAt: str
