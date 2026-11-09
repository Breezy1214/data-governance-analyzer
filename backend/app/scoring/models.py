"""Versioned request/response schemas for the risk-scoring service."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = "3.0"

DataType = Literal["names", "emails", "phone", "postal", "device", "adId", "gov", "health", "financial"]
Purpose = Literal["overlap", "enrichment", "healthResearch", "fraud", "advertising", "ai", "analytics", "other"]
Participants = Literal["internal", "onePartner", "multiplePartners"]
IdentifierProtection = Literal["notExchanged", "cleartext", "hashedTokenized", "encryptedDecrypted", "cleanRoom", "notSure"]
EnvironmentControl = Literal["own", "partner", "thirdParty", "notSure"]
Regulation = Literal["gdpr", "hipaa", "ccpa", "none", "notSure"]
YesNo = Literal["yes", "no"]
YesNoUnsure = Literal["yes", "no", "notSure"]
RiskLevel = Literal["LOW", "MEDIUM", "HIGH"]


def _require_unique(values: list[str], name: str) -> None:
    if len(values) != len(set(values)):
        raise ValueError(f"{name} must be unique")


class AssessmentRequest(BaseModel):
    """Questionnaire responses for a single proposed data use case."""

    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["3.0"] = SCHEMA_VERSION
    dataTypes: list[DataType] = Field(min_length=1, max_length=9)
    purpose: Purpose
    participants: Participants
    identifierProtection: IdentifierProtection
    custodyChange: YesNoUnsure
    environmentControl: EnvironmentControl
    reusableKeys: YesNoUnsure
    smallResults: YesNoUnsure
    combined: YesNo
    retainedArtifacts: YesNoUnsure
    secondaryUse: YesNo
    regulations: list[Regulation] = Field(min_length=1, max_length=5)
    identifierConsistency: YesNoUnsure

    @field_validator("dataTypes")
    @classmethod
    def data_types_must_be_unique(cls, value: list[DataType]) -> list[DataType]:
        _require_unique(value, "data types")
        return value

    @field_validator("regulations")
    @classmethod
    def regulations_must_be_consistent(cls, value: list[Regulation]) -> list[Regulation]:
        _require_unique(value, "regulations")
        if len(value) > 1 and {"none", "notSure"} & set(value):
            raise ValueError("'none' and 'notSure' cannot be combined with other regulations")
        return value


class RiskFactor(BaseModel):
    ruleId: str
    category: str
    label: str
    points: int


class Reference(BaseModel):
    """Regulatory guidance a recommendation cites."""

    publisher: str
    statement: str
    sourceTitle: str
    sourceUrl: str


class Recommendation(BaseModel):
    id: str
    priority: int = Field(ge=1)
    title: str
    action: str
    rationale: str
    basedOn: list[str]
    references: list[Reference]


class RecommendationResult(BaseModel):
    mappingVersion: str
    mappingApprovalStatus: Literal["pending", "approved"]
    sourcesCheckedOn: str
    recommendations: list[Recommendation]


class AssessmentResponse(RecommendationResult):
    """Deterministic scoring output with full attribution."""

    schemaVersion: str
    rulesVersion: str
    score: int = Field(ge=0, le=100)
    level: RiskLevel
    guidance: str
    factors: list[RiskFactor]
    limitations: list[str]
    assessedAt: str
