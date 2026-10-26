"""Versioned risk-to-control mappings, independent of scoring weights."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.scoring.models import KarlsgateRecommendation, RecommendationResult, SafeguardRecommendation
from app.scoring.rules import get_ruleset

CURRENT_MAPPING_VERSION = "1.1"
MAPPING_FILES = {"1.0": "v1.0.json", "1.1": "v1.1.json"}


class CatalogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class CapabilityEntry(CatalogEntry):
    label: str = Field(min_length=1)
    conditionId: str = Field(min_length=1)
    anyOfAllFactors: tuple[tuple[str, ...], ...] = Field(min_length=1)


class MappingCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: str
    approvalStatus: Literal["pending", "approved"]
    source: str
    rulesVersions: tuple[str, ...] = Field(min_length=1)
    baselineSafeguardIds: tuple[str, ...]
    safeguards: tuple[CatalogEntry, ...] = Field(min_length=1)
    factorSafeguards: dict[str, tuple[str, ...]]
    karlsgate: tuple[CapabilityEntry, ...]

    @model_validator(mode="after")
    def validate_references(self) -> MappingCatalog:
        safeguard_ids = {entry.id for entry in self.safeguards}
        if len(safeguard_ids) != len(self.safeguards):
            raise ValueError("Duplicate safeguard IDs")
        if len({entry.id for entry in self.karlsgate}) != len(self.karlsgate):
            raise ValueError("Duplicate capability IDs")
        references = set(self.baselineSafeguardIds)
        for safeguards in self.factorSafeguards.values():
            if not safeguards:
                raise ValueError("Every factor needs at least one safeguard")
            references.update(safeguards)
        if references - safeguard_ids:
            raise ValueError("Unknown safeguard reference")
        for entry in self.karlsgate:
            for clause in entry.anyOfAllFactors:
                if set(clause) - self.factorSafeguards.keys():
                    raise ValueError("Unknown applicability factor")
        for version in self.rulesVersions:
            if {rule.id for rule in get_ruleset(version).rules} != self.factorSafeguards.keys():
                raise ValueError("Mapping must cover exactly the supported scoring factors")
        return self


@lru_cache
def get_mapping(version: str = CURRENT_MAPPING_VERSION) -> MappingCatalog:
    if version not in MAPPING_FILES:
        raise ValueError(f"Unsupported mapping version: {version!r}")
    path = Path(__file__).parent / "mappings" / MAPPING_FILES[version]
    catalog = MappingCatalog.model_validate_json(path.read_text(encoding="utf-8"))
    if catalog.version != version:
        raise ValueError("Mapping filename and declared version disagree")
    return catalog


def map_recommendations(
    factor_ids: list[str],
    rules_version: str,
    mapping_version: str = CURRENT_MAPPING_VERSION,
) -> RecommendationResult:
    catalog = get_mapping(mapping_version)
    if rules_version not in catalog.rulesVersions:
        raise ValueError("Mapping does not support these scoring rules")
    active = list(dict.fromkeys(factor_ids))
    if set(active) - catalog.factorSafeguards.keys():
        raise ValueError("Risk factor has no supported safeguard mapping")

    general = []
    for entry in catalog.safeguards:
        related = [factor for factor in active if entry.id in catalog.factorSafeguards[factor]]
        if related or entry.id in catalog.baselineSafeguardIds:
            general.append(SafeguardRecommendation(id=entry.id, text=entry.text, factorIds=related))

    karlsgate = []
    for entry in catalog.karlsgate:
        # OR across clauses, AND within each clause; an empty clause means baseline applicability.
        matched = [clause for clause in entry.anyOfAllFactors if all(factor in active for factor in clause)]
        if not matched:
            continue
        related = [factor for factor in active if any(factor in clause for clause in matched)]
        karlsgate.append(KarlsgateRecommendation(
            id=entry.id, label=entry.label, text=entry.text,
            conditionId=entry.conditionId, factorIds=related,
        ))

    return RecommendationResult(
        mappingVersion=catalog.version,
        mappingApprovalStatus=catalog.approvalStatus,
        generalSafeguards=general,
        karlsgateRecommendations=karlsgate,
    )
