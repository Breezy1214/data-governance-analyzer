"""Versioned answer-to-recommendation catalog, independent of scoring weights.

Recommendations are selected by the rules and signals an assessment fires, and
may cite regulatory guidance. The catalog is a reviewed snapshot; nothing here
calls an external service at request time.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.scoring.models import Recommendation, RecommendationResult, Reference
from app.scoring.rules import duplicates, get_ruleset

CURRENT_MAPPING_VERSION = "2.0"
MAPPING_FILES = {"2.0": "v2.0.json"}


class CatalogSource(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    publisher: str = Field(min_length=1)
    title: str = Field(min_length=1)
    url: str = Field(pattern=r"^https://")


class CatalogCitation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    sourceId: str = Field(min_length=1)
    statement: str = Field(min_length=1)


class CatalogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    action: str = Field(min_length=1)
    rationale: str = Field(min_length=1)
    # Selected on every assessment when baseline, otherwise when any trigger fires.
    # Fired triggers are always reported as the basis for the recommendation.
    baseline: bool = False
    triggers: tuple[str, ...] = ()
    references: tuple[CatalogCitation, ...] = ()

    @model_validator(mode="after")
    def must_be_selectable(self) -> CatalogEntry:
        if not self.baseline and not self.triggers:
            raise ValueError("A recommendation needs a trigger or baseline")
        return self


class MappingCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: str
    approvalStatus: Literal["pending", "approved"]
    source: str
    sourcesCheckedOn: str
    rulesVersions: tuple[str, ...] = Field(min_length=1)
    sources: dict[str, CatalogSource]
    recommendations: tuple[CatalogEntry, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_references(self) -> MappingCatalog:
        repeated = duplicates(tuple(entry.id for entry in self.recommendations))
        if repeated:
            raise ValueError(f"Duplicate recommendation IDs: {repeated}")
        referenced = set()
        for entry in self.recommendations:
            referenced.update(entry.triggers)
            if any(citation.sourceId not in self.sources for citation in entry.references):
                raise ValueError("Unknown source reference")
        for version in self.rulesVersions:
            ruleset = get_ruleset(version)
            known = {item.id for item in (*ruleset.rules, *ruleset.signals)}
            if referenced != known:
                raise ValueError("Catalog must cover exactly the supported rules and signals")
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


def _reference(source: CatalogSource, citation: CatalogCitation) -> Reference:
    return Reference(
        publisher=source.publisher,
        statement=citation.statement,
        sourceTitle=source.title,
        sourceUrl=source.url,
    )


def map_recommendations(
    active_labels: dict[str, str],
    rules_version: str,
    mapping_version: str = CURRENT_MAPPING_VERSION,
) -> RecommendationResult:
    """Select catalog entries for the fired rules and signals, given as ``{id: label}``."""
    catalog = get_mapping(mapping_version)
    if rules_version not in catalog.rulesVersions:
        raise ValueError("Mapping does not support these scoring rules")

    selected = []
    for entry in catalog.recommendations:
        based_on = [label for item, label in active_labels.items() if item in entry.triggers]
        if not entry.baseline and not based_on:
            continue
        selected.append(Recommendation(
            id=entry.id,
            priority=len(selected) + 1,
            title=entry.title,
            action=entry.action,
            rationale=entry.rationale,
            basedOn=based_on,
            references=[_reference(catalog.sources[citation.sourceId], citation) for citation in entry.references],
        ))

    return RecommendationResult(
        mappingVersion=catalog.version,
        mappingApprovalStatus=catalog.approvalStatus,
        sourcesCheckedOn=catalog.sourcesCheckedOn,
        recommendations=selected,
    )
