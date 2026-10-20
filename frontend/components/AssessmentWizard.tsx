"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AssessmentInput,
  AssessmentResult,
  AssessmentServiceError,
  DATA_TYPE_LABELS,
  DataType,
  EMPTY_INPUT,
  CAPABILITY_COPY,
  PURPOSE_LABELS,
  QUESTION_LABELS,
  Purpose,
  YesNo,
  requestAssessment,
  validateDescription,
  validateQuestions,
} from "@/lib/assessment";
import { downloadAssessmentReport } from "@/lib/report";
import { riskColor } from "@/lib/risk-color";
import { IDLE_TIMEOUT_MS, clearDraft, loadDraft, purgeLegacyDrafts, saveDraft } from "@/lib/session";

const STEPS = ["Describe", "Answer questions", "Assessment", "Recommendations"] as const;
const RETENTION_NOTICE =
  "Your description stays in this browser tab. Questionnaire answers are sent to our service to calculate your score and are not saved on our servers. Your draft is cleared when you close the tab, start over, or are inactive for 30 minutes.";

function Choice({ selected, children, onClick }: { selected: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="choice" aria-pressed={selected} onClick={onClick}>
      <span aria-hidden="true" className="choice-mark">{selected ? "✓" : ""}</span>
      {children}
    </button>
  );
}

function BinaryQuestion({ legend, value, onChange, detail }: {
  legend: string;
  value: YesNo | "";
  onChange: (value: YesNo) => void;
  detail?: string;
}) {
  return (
    <fieldset className="question-block">
      <legend>{legend}</legend>
      {detail && <p>{detail}</p>}
      <div className="binary-row">
        <Choice selected={value === "yes"} onClick={() => onChange("yes")}>Yes</Choice>
        <Choice selected={value === "no"} onClick={() => onChange("no")}>No</Choice>
      </div>
    </fieldset>
  );
}

export function AssessmentWizard() {
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [input, setInput] = useState<AssessmentInput>(EMPTY_INPUT);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const pendingAssessment = useRef<AbortController | null>(null);
  const pendingReport = useRef<AbortController | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const factorLabelsById = useMemo(
    () => new Map(result?.factors.map((factor) => [factor.ruleId, factor.label]) ?? []),
    [result],
  );

  const cancelPendingWork = useCallback(() => {
    pendingAssessment.current?.abort();
    pendingAssessment.current = null;
    pendingReport.current?.abort();
    pendingReport.current = null;
    setLoading(false);
    setDownloading(false);
  }, []);

  useEffect(() => () => {
    pendingAssessment.current?.abort();
    pendingAssessment.current = null;
    pendingReport.current?.abort();
    pendingReport.current = null;
  }, []);

  useEffect(() => {
    purgeLegacyDrafts();
    const restored = loadDraft();
    const restoreDraft = window.setTimeout(() => {
      if (restored) setInput(restored);
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(restoreDraft);
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    if (input === EMPTY_INPUT) clearDraft();
    else saveDraft(input);
  }, [input, draftReady]);

  // Clear the draft after a period of inactivity, even if the tab stays open.
  useEffect(() => {
    let idle: number;
    const restart = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        cancelPendingWork();
        clearDraft();
        setInput(EMPTY_INPUT);
        setResult(null);
        setStep(0);
        setMaxReached(0);
        setReportError(null);
        setError("Your session expired after 30 minutes of inactivity, so your answers were cleared.");
      }, IDLE_TIMEOUT_MS);
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((name) => window.addEventListener(name, restart, { passive: true }));
    restart();
    return () => {
      window.clearTimeout(idle);
      events.forEach((name) => window.removeEventListener(name, restart));
    };
  }, [cancelPendingWork]);

  useEffect(() => {
    mainHeading.current?.focus();
  }, [step]);

  const update = <K extends keyof AssessmentInput>(key: K, value: AssessmentInput[K]) => {
    cancelPendingWork();
    setInput((current) => ({ ...current, [key]: value }));
    if (result) {
      setResult(null);
      setMaxReached((current) => Math.min(current, 1));
    }
    setError(null);
    setReportError(null);
  };

  const moveTo = (nextStep: number) => {
    cancelPendingWork();
    if (nextStep === 1) {
      const message = validateDescription(input.description);
      if (message) { setError(message); return; }
    }
    setError(null);
    setStep(nextStep);
    setMaxReached((current) => Math.max(current, nextStep));
  };

  const assess = async () => {
    if (pendingAssessment.current) return;
    const message = validateQuestions(input);
    if (message) { setError(message); return; }
    const controller = new AbortController();
    pendingAssessment.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await requestAssessment(input, controller.signal);
      if (controller.signal.aborted || pendingAssessment.current !== controller) return;
      setResult(response);
      moveTo(2);
    } catch (failure) {
      if (controller.signal.aborted || pendingAssessment.current !== controller) return;
      setError(failure instanceof AssessmentServiceError && failure.status === 422
        ? "The assessment service could not accept these answers. Review them and try again."
        : "The assessment service is unavailable. Your answers are still in this tab—please try again.");
    } finally {
      if (pendingAssessment.current === controller) {
        pendingAssessment.current = null;
        setLoading(false);
      }
    }
  };

  const reset = () => {
    cancelPendingWork();
    setInput(EMPTY_INPUT);
    setResult(null);
    setStep(0);
    setMaxReached(0);
    setError(null);
    setReportError(null);
    clearDraft();
  };

  const download = async () => {
    if (!result || pendingReport.current) return;
    const controller = new AbortController();
    pendingReport.current = controller;
    setDownloading(true);
    setReportError(null);
    try {
      await downloadAssessmentReport(input, result, controller.signal);
    } catch {
      if (controller.signal.aborted || pendingReport.current !== controller) return;
      setReportError("The report could not be generated. Your assessment is still here—please try again.");
    } finally {
      if (pendingReport.current === controller) {
        pendingReport.current = null;
        setDownloading(false);
      }
    }
  };

  return (
    <main>
      <a className="skip-link" href="#assessment">Skip to the assessment</a>
      <header className="masthead">
        <a className="brand" href="#top" aria-label="Data Governance Readiness Analyzer home">DATA GOVERNANCE</a>
        <span className="edition">READINESS / 01</span>
      </header>

      <div className="shell" id="top">
        <aside className="orientation" aria-label="Assessment progress">
          <p className="eyebrow">Data Governance Readiness Analyzer</p>
          <h1>Know the risk<br />before data moves.</h1>
          <p className="intro">Describe the initiative in ordinary language. We’ll surface governance concerns and the controls needed to proceed.</p>
          <ol className="step-list">
            {STEPS.map((label, index) => (
              <li key={label} className={index === step ? "current" : index < step ? "complete" : ""}>
                <button
                  type="button"
                  onClick={() => index <= maxReached && moveTo(index)}
                  disabled={index > maxReached}
                  aria-current={index === step ? "step" : undefined}
                >
                  <span>0{index + 1}</span>{label}
                </button>
              </li>
            ))}
          </ol>
          <div className="progress-copy">
            <span>Step {step + 1} of {STEPS.length}</span>
            <span>{Math.round(((step + 1) / STEPS.length) * 100)}%</span>
          </div>
          <div className="progress-track" aria-hidden="true"><i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
        </aside>

        <section className="workspace" id="assessment">
          <p className="sr-only" role="status">
            {loading ? "Assessing your answers." : `Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}
          </p>
          {step === 0 && (
            <div className="step-panel">
              <p className="section-number">01 / DESCRIBE</p>
              <h2 ref={mainHeading} tabIndex={-1}>What are you proposing?</h2>
              <p className="lede">Include what data is involved, who needs it, and the outcome you want.</p>
              <label className="text-field" htmlFor="description">
                <span>Use-case description <b>Required</b></span>
                <textarea
                  id="description"
                  value={input.description}
                  onChange={(event) => update("description", event.target.value)}
                  maxLength={1000}
                  aria-describedby="description-help description-error retention-notice"
                  aria-invalid={Boolean(error)}
                  placeholder="For example: We want to compare our customer database with a partner’s records to understand which customers we share."
                />
              </label>
              <div className="field-meta" id="description-help"><span>A clear sentence or two is enough. Avoid names or other identifying details.</span><span>{input.description.length} / 1,000</span></div>
              {error && <p className="error" id="description-error" role="alert">{error}</p>}
              <p className="method-note" id="retention-notice">{RETENTION_NOTICE}</p>
              <div className="actions end"><button className="primary" type="button" onClick={() => moveTo(1)}>Continue <span>→</span></button></div>
            </div>
          )}

          {step === 1 && (
            <div className="step-panel">
              <p className="section-number">02 / ANSWER QUESTIONS</p>
              <h2 ref={mainHeading} tabIndex={-1}>How will the data be handled?</h2>
              <p className="lede">Answer based on the planned operating model—not the best-case outcome.</p>

              <fieldset className="question-block">
                <legend>{QUESTION_LABELS.dataTypes}</legend>
                <p>Select every type that applies.</p>
                <div className="choice-grid">
                  {(Object.entries(DATA_TYPE_LABELS) as [DataType, string][]).map(([key, label]) => (
                    <Choice key={key} selected={input.dataTypes.includes(key)} onClick={() => update("dataTypes", input.dataTypes.includes(key) ? input.dataTypes.filter((item) => item !== key) : [...input.dataTypes, key])}>{label}</Choice>
                  ))}
                </div>
              </fieldset>

              <BinaryQuestion legend={QUESTION_LABELS.externalAccess} detail="Another organization means anyone outside your own—a partner, vendor, agency, or research group." value={input.externalAccess} onChange={(value) => update("externalAccess", value)} />
              <BinaryQuestion legend={QUESTION_LABELS.rawExchange} detail="Raw means unmasked values that directly identify a person." value={input.rawExchange} onChange={(value) => update("rawExchange", value)} />
              <BinaryQuestion legend={QUESTION_LABELS.dataMovement} detail="For example, copying it to a partner’s system, a different cloud account, a spreadsheet, or a laptop." value={input.dataMovement} onChange={(value) => update("dataMovement", value)} />
              <BinaryQuestion legend={QUESTION_LABELS.combined} detail="Joining datasets can make someone identifiable even when neither set identified them on its own." value={input.combined} onChange={(value) => update("combined", value)} />
              <BinaryQuestion legend={QUESTION_LABELS.secondaryUse} detail="Reuse means using the data later for something other than the purpose you described above." value={input.secondaryUse} onChange={(value) => update("secondaryUse", value)} />

              <label className="select-field" htmlFor="purpose">
                <span>{QUESTION_LABELS.purpose}</span>
                <select id="purpose" value={input.purpose} onChange={(event) => update("purpose", event.target.value as Purpose)}>
                  {(Object.entries(PURPOSE_LABELS) as [Purpose, string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="actions"><button className="secondary" type="button" onClick={() => moveTo(0)}>← Back</button><button className="primary" type="button" disabled={loading} onClick={assess}>{loading ? "Assessing…" : "Assess risk"} <span>→</span></button></div>
            </div>
          )}

          {step === 2 && result && (
            <div
              className="step-panel risk-result"
              style={{
                "--risk-color": riskColor(result.score),
                "--risk-position": `${result.score}%`,
              } as React.CSSProperties}
            >
              <p className="section-number">03 / ASSESSMENT</p>
              <h2 ref={mainHeading} tabIndex={-1}>The proposed use case is <em>{result.level.toLowerCase()} risk.</em></h2>
              <div className="score">
                <span className="score-number">{result.score}</span><span className="score-total">/ 100</span>
                <div><b>{result.level} RISK</b><p>{result.guidance}</p></div>
              </div>
              <div className="risk-scale" aria-hidden="true">
                <div className="risk-scale-track"><i /></div>
                <div className="risk-scale-labels"><span>Low risk</span><span>High risk</span></div>
              </div>
              <div className="rule" />
              <h3>What drives this score</h3>
              <ul className="factor-list">
                {result.factors.map((factor) => <li key={factor.label}><span>{factor.label}</span><b>+{factor.points}</b></li>)}
              </ul>
              <p className="method-note">Transparent rules, capped at 100. Review the versioned rubric for assumptions and thresholds.</p>
              <div className="actions"><button className="secondary" type="button" onClick={() => moveTo(1)}>← Back</button><button className="primary" type="button" onClick={() => moveTo(3)}>See recommendations <span>→</span></button></div>
            </div>
          )}

          {step === 3 && result && (
            <div
              className="step-panel recommendation-result"
              style={{ "--risk-color": riskColor(result.score) } as React.CSSProperties}
            >
              <p className="section-number">04 / RECOMMENDATIONS</p>
              <h2 ref={mainHeading} tabIndex={-1}>Controls before approval.</h2>
              <p className="lede">Use this record to begin privacy, security, and business-owner review.</p>
              <div className="recommendation-outcome">
                <b>{result.level} RISK · {result.score}/100</b>
                <p>{result.guidance}</p>
              </div>
              <h3>Recommended protections</h3>
              {result.recommendationDetails.length > 0 ? (
                <ol className="recommendation-list">
                  {result.recommendationDetails.map((item) => {
                    const factorLabels = item.riskFactorIds.flatMap((ruleId) => {
                      const label = factorLabelsById.get(ruleId);
                      return label ? [label] : [];
                    });
                    return (
                      <li key={item.id}>
                        <span>{String(item.priority).padStart(2, "0")}</span>
                        <div>
                          <h4>{item.title}</h4>
                          <p>{item.action}</p>
                          <p className="recommendation-rationale"><b>Why this applies:</b> {item.rationale}</p>
                          <p className="recommendation-trace"><b>Triggered by:</b> {factorLabels.join(", ")}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="empty-state">No tailored safeguards were returned. Apply standard access, minimization, retention, and governance controls before proceeding.</p>
              )}
              {result.capabilities.length > 0 && (
                <div className="capability-panel">
                  <p className="section-number">PRIVACY-ENHANCING CAPABILITY FIT</p>
                  <h3>Applicable privacy-enhancing controls</h3>
                  <p>Only capabilities whose documented applicability rules are satisfied are shown.</p>
                  <ul className="capability-list">
                    {result.capabilities.map((capability) => (
                      <li key={capability}><b>{capability}</b><p>{CAPABILITY_COPY[capability] ?? ""}</p></li>
                    ))}
                  </ul>
                </div>
              )}
              {result.limitations.length > 0 && <div className="limitations"><h3>Specialist review required</h3>{result.limitations.map((item) => <p key={item}>{item}</p>)}</div>}
              <details className="summary"><summary>Assessment record</summary><dl><div><dt>Use case</dt><dd>{input.description}</dd></div><div><dt>Data</dt><dd>{input.dataTypes.map((item) => DATA_TYPE_LABELS[item]).join(", ")}</dd></div><div><dt>Purpose</dt><dd>{PURPOSE_LABELS[input.purpose]}</dd></div><div><dt>Assessed</dt><dd>{new Date(result.assessedAt).toLocaleString()}</dd></div></dl></details>
              {reportError && <p className="error" role="alert">{reportError}</p>}
              <div className="actions wrap"><button className="secondary" type="button" onClick={() => moveTo(2)}>← Back</button><div><button className="secondary" type="button" onClick={reset}>Start over</button><button className="primary" type="button" disabled={downloading} onClick={download}>{downloading ? "Preparing report…" : "Download report (PDF) ↓"}</button></div></div>
            </div>
          )}
        </section>
      </div>
      <footer><span>Decision support, not legal advice. Assessments are not retained.</span><span>Rubric v1.0</span></footer>
    </main>
  );
}
