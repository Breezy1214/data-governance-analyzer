import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AssessmentInput, DATA_TYPE_LABELS, PURPOSE_LABELS, type YesNo } from "../lib/assessment";
import { CAPABILITY_COPY, mapRecommendations, recommendationReason } from "../lib/recommendations";
import catalog from "../lib/mappings/v1.1.json";

const cases = [
  ["DATA_SENSITIVITY_HIGH", "DEIDENTIFY_RECORDS"],
  ["DATA_SENSITIVITY_DIRECT", "FIELD_MINIMIZATION"],
  ["EXTERNAL_ACCESS", "ACCESS_CONTROL"],
  ["RAW_EXCHANGE", "PRIVATE_MATCHING"],
  ["DATA_MOVEMENT", "RETENTION_DELETION"],
  ["COMBINED_REIDENTIFICATION", "REIDENTIFICATION_REVIEW"],
  ["SECONDARY_USE", "SECONDARY_USE_APPROVAL"],
  ["PURPOSE_ANALYTICS", "FIELD_MINIMIZATION"],
  ["PURPOSE_RESEARCH", "PURPOSE_ACCOUNTABILITY"],
  ["PURPOSE_MATCHING", "PRIVATE_MATCHING"],
  ["PURPOSE_OTHER", "PURPOSE_ACCOUNTABILITY"],
  ["PURPOSE_MARKETING", "RETENTION_DELETION"],
  ["PURPOSE_AI", "RETENTION_DELETION"],
];

describe("versioned recommendation mapping", () => {
  it.each(cases)("maps %s to %s with attribution", (factor, safeguard) => {
    const result = mapRecommendations([factor], "1.0");
    expect(result.generalSafeguards).toContainEqual(expect.objectContaining({ id: safeguard, factorIds: [factor] }));
  });

  it("matches the canonical backend catalog and the documented capability wording", () => {
    const root = resolve(import.meta.dirname, "../..");
    const canonical = JSON.parse(readFileSync(resolve(root, "backend/app/scoring/mappings/v1.1.json"), "utf8"));
    expect(catalog).toEqual(canonical);
    const rubric = readFileSync(resolve(root, catalog.source), "utf8");
    Object.values(CAPABILITY_COPY).forEach((copy) => expect(rubric).toContain(copy));
  });

  it("enforces every documented capability condition across 1,152 questionnaire combinations", () => {
    const seenFactors = new Set<string>();
    for (const dataType of Object.keys(DATA_TYPE_LABELS) as AssessmentInput["dataTypes"]) {
      for (const purpose of Object.keys(PURPOSE_LABELS) as AssessmentInput["purpose"][]) {
        for (let bits = 0; bits < 32; bits++) {
          const flags: YesNo[] = Array.from({ length: 5 }, (_, index) => bits & (1 << index) ? "yes" : "no");
          const [externalAccess, rawExchange, dataMovement, combined, secondaryUse] = flags;
          const factorIds = [
            ["gov", "health", "financial"].includes(dataType) ? "DATA_SENSITIVITY_HIGH" : "DATA_SENSITIVITY_DIRECT",
            ...[externalAccess, rawExchange, dataMovement, combined, secondaryUse].flatMap((flag, index) =>
              flag === "yes" ? [["EXTERNAL_ACCESS", "RAW_EXCHANGE", "DATA_MOVEMENT", "COMBINED_REIDENTIFICATION", "SECONDARY_USE"][index]] : []),
            `PURPOSE_${purpose.toUpperCase()}`,
          ];
          const result = mapRecommendations(factorIds, "1.0");
          const capabilities = result.karlsgateRecommendations.map((item) => item.id);
          expect(capabilities.includes("PROTECTED_MATCHING")).toBe(
            externalAccess === "yes" && (rawExchange === "yes" || purpose === "matching"),
          );
          expect(capabilities.includes("REID_REMEDIATION")).toBe(combined === "yes");
          expect(capabilities.includes("DEIDENTIFICATION")).toBe(["gov", "health", "financial"].includes(dataType));
          expect(capabilities).toEqual(expect.arrayContaining(["DATA_MINIMIZATION", "GOVERNANCE_EXECUTION"]));
          const factors = new Set(factorIds);
          factors.forEach((factor) => seenFactors.add(factor));
          expect(new Set(result.generalSafeguards.flatMap((item) => item.factorIds))).toEqual(factors);
          expect(new Set(result.generalSafeguards.map((item) => item.id)).size).toBe(result.generalSafeguards.length);
        }
      }
    }
    expect(seenFactors).toEqual(new Set(Object.keys(catalog.factorSafeguards)));
  });

  it("preserves vendor-independent safeguards when specialist Karlsgate conditions fail", () => {
    const result = mapRecommendations(["RAW_EXCHANGE", "PURPOSE_ANALYTICS"], "1.0");
    expect(result.karlsgateRecommendations.map((item) => item.id)).not.toContain("PROTECTED_MATCHING");
    expect(result.generalSafeguards.map((item) => item.id)).toEqual(expect.arrayContaining([
      "ACCESS_CONTROL", "FIELD_MINIMIZATION", "RETENTION_DELETION", "PRIVATE_MATCHING",
    ]));
    expect(result.generalSafeguards.every((item) => !item.text.includes("Karlsgate"))).toBe(true);
  });

  it("deduplicates controls, preserves reasons, and records an independent mapping version", () => {
    const factors = ["EXTERNAL_ACCESS", "RAW_EXCHANGE", "PURPOSE_MATCHING", "RAW_EXCHANGE"];
    const first = mapRecommendations(factors, "1.0");
    expect(first).toEqual(mapRecommendations(factors, "1.0"));
    expect(first).toMatchObject({ mappingVersion: "1.1", mappingApprovalStatus: "approved" });
    expect(first.karlsgateRecommendations[0]).toMatchObject({
      conditionId: "EXTERNAL_AND_RAW_OR_MATCHING",
      factorIds: ["EXTERNAL_ACCESS", "RAW_EXCHANGE", "PURPOSE_MATCHING"],
    });
  });

  it("rejects unsupported factors and scoring versions without inventing recommendations", () => {
    expect(() => mapRecommendations(["UNKNOWN"], "1.0")).toThrow(/no supported/);
    expect(() => mapRecommendations(["EXTERNAL_ACCESS"], "99.0")).toThrow(/Unsupported/);
  });

  it("explains recommendations using readable factor labels, not internal identifiers", () => {
    expect(recommendationReason({ id: "ACCESS_CONTROL", text: "Control", factorIds: ["EXTERNAL_ACCESS"] }, [
      { ruleId: "EXTERNAL_ACCESS", label: "Access by another organization" },
    ])).toBe("Relevant to: Access by another organization.");
    expect(recommendationReason({ id: "BASELINE", text: "Control", factorIds: [] }, [])).toMatch(/Baseline control/);
  });
});
