import type { AssessmentInput, AssessmentResult, Reference, RiskLevel } from "@/lib/assessment";
import { DATA_TYPE_LABELS, PURPOSE_LABELS, RISK_THRESHOLDS } from "@/lib/assessment";
import { BASED_ON_LABEL, EVERY_ASSESSMENT_LABEL, REFERENCE_HEADING, formatCheckedOn } from "@/lib/report";
import { LocalTime } from "./LocalTime";

/** Shared by the wizard and a saved assessment, so a result reads the same in both. */

const { lowMax, mediumMax } = RISK_THRESHOLDS;
export const RISK_LABELS: Record<RiskLevel, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
export const RISK_BANDS: { level: RiskLevel; label: string; range: string }[] = [
  { level: "LOW", label: RISK_LABELS.LOW, range: `0–${lowMax}` },
  { level: "MEDIUM", label: RISK_LABELS.MEDIUM, range: `${lowMax + 1}–${mediumMax}` },
  { level: "HIGH", label: RISK_LABELS.HIGH, range: `${mediumMax + 1}–100` },
];

const RING_RADIUS = 70;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function ScoreRing({ score }: { score: number }) {
  const filled = (score / 100) * RING_LENGTH;
  return (
    <div className="score-ring">
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <circle className="ring-track" cx="90" cy="90" r={RING_RADIUS} />
        <circle
          className="ring-value"
          cx="90"
          cy="90"
          r={RING_RADIUS}
          strokeDasharray={`${filled} ${RING_LENGTH}`}
          transform="rotate(-90 90 90)"
        />
      </svg>
      <div><span className="score-number">{score}</span><span className="score-total">out of 100</span></div>
    </div>
  );
}

function ReferenceList({ items }: { items: Reference[] }) {
  return items.length > 0 && (
    <div className="recommendation-references">
      <h5>{REFERENCE_HEADING}</h5>
      <ul>
        {items.map((entry) => (
          <li key={entry.statement}>
            {entry.statement}{" "}
            <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">
              Source: {entry.sourceTitle}<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScoreBreakdown({ result }: { result: AssessmentResult }) {
  return (
    <div className="result-grid">
      <div className="card score-card">
        <h3 className="card-title">Overall risk score</h3>
        <ScoreRing score={result.score} />
        <ul className="band-list">
          {RISK_BANDS.map((band) => (
            <li key={band.level} data-risk={band.level.toLowerCase()} aria-current={band.level === result.level ? "true" : undefined}>
              <span className="risk-icon" aria-hidden="true" />
              <span>{band.label}</span>
              <b>{band.range}</b>
            </li>
          ))}
        </ul>
        <p className="score-guidance">{result.guidance}</p>
      </div>
      <div className="card factor-card">
        <h3 className="card-title">What drives this score</h3>
        <ul className="factor-list">
          {result.factors.map((factor) => (
            <li key={factor.label}>
              <div><span>{factor.label}</span><b>+{factor.points}</b></div>
              <span className="factor-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, factor.points)}%` }} /></span>
            </li>
          ))}
        </ul>
        <p className="method-note">Transparent rules, capped at 100. Review the versioned rubric for assumptions and thresholds.</p>
      </div>
    </div>
  );
}

export function RecommendationsView({ result }: { result: AssessmentResult }) {
  return <>
    <div className="card">
      <div className="outcome-head">
        <b className="risk-label risk-pill"><span className="risk-icon" aria-hidden="true" />{result.level} RISK · {result.score}/100</b>
        <span className="outcome-counts">
          {result.recommendations.length} recommendations
        </span>
      </div>
      <p className="outcome-guidance">{result.guidance}</p>
      {result.limitations.length > 0 && <div className="limitations"><h3>Specialist review required</h3>{result.limitations.map((item) => <p key={item}>{item}</p>)}</div>}
    </div>

    <div className="card safeguards">
      <h3 className="card-title">Recommended actions</h3>
      <ol className="recommendation-list">
        {result.recommendations.map((item) => (
          <li key={item.id}>
            <span className="recommendation-index">{String(item.priority).padStart(2, "0")}</span>
            <div>
              <h4>{item.title}</h4>
              <p className="recommendation-action">{item.action}</p>
              <ReferenceList items={item.references} />
              <details className="recommendation-why">
                <summary>Why this applies</summary>
                <div>
                  <p>{item.rationale}</p>
                  {item.basedOn.length > 0 ? (
                    <div className="recommendation-trace">
                      <b>{BASED_ON_LABEL}</b>
                      <ul>{item.basedOn.map((label) => <li key={label}>{label}</li>)}</ul>
                    </div>
                  ) : <p>{EVERY_ASSESSMENT_LABEL}</p>}
                </div>
              </details>
            </div>
          </li>
        ))}
      </ol>
      <p className="method-note">Recommendation catalog v{result.mappingVersion}: {result.mappingApprovalStatus === "approved" ? "approved" : "approval pending"}. Sources checked {formatCheckedOn(result.sourcesCheckedOn)}.</p>
    </div>
  </>;
}

export function AssessmentRecord({ input, result, description = input.description, status, open }: {
  input: AssessmentInput;
  result: AssessmentResult;
  description?: string;
  status?: string;
  open?: boolean;
}) {
  return (
    <details className="summary card" open={open}>
      <summary>Assessment record</summary>
      <dl>
        <div><dt>Use case</dt><dd>{description}</dd></div>
        <div><dt>Data</dt><dd>{input.dataTypes.map((item) => DATA_TYPE_LABELS[item]).join(", ")}</dd></div>
        <div><dt>Purpose</dt><dd>{PURPOSE_LABELS[input.purpose]}</dd></div>
        {status && <div><dt>Status</dt><dd>{status}</dd></div>}
        <div><dt>Scoring rules version</dt><dd>{result.rulesVersion}</dd></div>
        <div><dt>Recommendation catalog version</dt><dd>{result.mappingVersion}</dd></div>
        <div><dt>API version</dt><dd>{result.apiVersion}</dd></div>
        <div><dt>Assessed</dt><dd><LocalTime value={result.assessedAt} /></dd></div>
      </dl>
    </details>
  );
}
