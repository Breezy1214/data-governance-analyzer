"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AssessmentInput,
  AssessmentResult,
  AssessmentServiceError,
  BINARY_FIELDS,
  DATA_TYPE_LABELS,
  DESCRIPTION_MAX_LENGTH,
  DataType,
  EMPTY_INPUT,
  PURPOSE_LABELS,
  QUESTION_LABELS,
  Purpose,
  RISK_THRESHOLDS,
  RiskLevel,
  YesNo,
  requestAssessment,
  validateDescription,
  validateQuestions,
} from "@/lib/assessment";
import { downloadAssessmentReport, formatAssessedAt } from "@/lib/report";
import {
  ACCEPTED_FILE_TYPES,
  ACCEPTED_LABEL,
  DocumentImportError,
  extractDocumentText,
} from "@/lib/document-import";
import { pairCapabilities, recommendationReason } from "@/lib/recommendations";
import { IDLE_TIMEOUT_MS, clearDraft, loadDraft, purgeLegacyDrafts, saveDraft } from "@/lib/session";
import { BrandMark, Icon, IconName } from "@/components/Icons";

const STEPS: { label: string; icon: IconName }[] = [
  { label: "Describe", icon: "describe" },
  { label: "Answer questions", icon: "questions" },
  { label: "Assessment", icon: "assessment" },
  { label: "Recommendations", icon: "recommendations" },
];
const { lowMax, mediumMax } = RISK_THRESHOLDS;
const RISK_BANDS: { level: RiskLevel; label: string; range: string }[] = [
  { level: "LOW", label: "Low", range: `0–${lowMax}` },
  { level: "MEDIUM", label: "Medium", range: `${lowMax + 1}–${mediumMax}` },
  { level: "HIGH", label: "High", range: `${mediumMax + 1}–100` },
];
const IDLE_MINUTES = IDLE_TIMEOUT_MS / 60_000;

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

type Stat = { title: string; badge: string; value: string | number; unit?: string; detail: React.ReactNode };

function StatCard({ title, badge, value, unit, detail }: Stat) {
  return (
    <div className="stat-card">
      <div className="stat-head"><span>{title}</span><span className="badge">{badge}</span></div>
      <p className="stat-value">{value}{unit && <small>{unit}</small>}</p>
      <p className="stat-detail">{detail}</p>
    </div>
  );
}

const INTRO_STATS: Stat[] = [
  { title: "Questions", badge: "Step 2", value: Object.keys(QUESTION_LABELS).length, detail: <>About data, <b>access</b> and use</> },
  { title: "Risk score", badge: "Step 3", value: "0–100", detail: <>Across <b>{RISK_BANDS.length}</b> risk bands</> },
  { title: "Draft retention", badge: "This tab", value: IDLE_MINUTES, unit: "min", detail: <>Cleared when <b>idle</b></> },
  { title: "Answers stored", badge: "Private", value: 0, detail: <>Answers are <b>scored, not stored</b></> },
];

function statsFor(step: number, input: AssessmentInput, result: AssessmentResult | null): Stat[] {
  if (step === 0) return INTRO_STATS;
  if (step === 1) {
    const answers = BINARY_FIELDS.map((field) => input[field]);
    const answered = (input.dataTypes.length > 0 ? 1 : 0) + answers.filter(Boolean).length;
    const complete = validateQuestions(input) === null;
    return [
      {
        title: "Questions answered",
        badge: complete ? "Complete" : "In progress",
        value: answered,
        unit: `/ ${BINARY_FIELDS.length + 1}`,
        detail: complete ? <>Ready to <b>assess</b></> : <>All required <b>before scoring</b></>,
      },
      { title: "Data types", badge: "Question 1", value: input.dataTypes.length, unit: `/ ${Object.keys(DATA_TYPE_LABELS).length}`, detail: <>Types <b>selected</b> so far</> },
      { title: "Yes answers", badge: "So far", value: answers.filter((answer) => answer === "yes").length, detail: <>Of <b>{BINARY_FIELDS.length}</b> handling questions</> },
    ];
  }
  if (!result) return [];
  return [
    { title: "Safeguards", badge: "Next step", value: result.recommendationDetails.length, detail: <>Tailored to <b>this use case</b></> },
    { title: "Capability fit", badge: "Mapped", value: result.karlsgateRecommendations.length, detail: <>Privacy-enhancing <b>controls</b></> },
    { title: "Specialist review", badge: "Flagged", value: result.limitations.length, detail: <>Areas needing <b>expert sign-off</b></> },
  ];
}

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

export function AssessmentWizard() {
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [input, setInput] = useState<AssessmentInput>(EMPTY_INPUT);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{ kind: "notice" | "error"; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const pendingAssessment = useRef<AbortController | null>(null);
  const pendingReport = useRef<AbortController | null>(null);
  const pendingImport = useRef<AbortController | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const factorLabelsById = useMemo(
    () => new Map(result?.factors.map((factor) => [factor.ruleId, factor.label]) ?? []),
    [result],
  );
  const capabilities = useMemo(() => result && pairCapabilities(result), [result]);

  const cancelPendingWork = useCallback(() => {
    pendingAssessment.current?.abort();
    pendingAssessment.current = null;
    pendingReport.current?.abort();
    pendingReport.current = null;
    pendingImport.current?.abort();
    pendingImport.current = null;
    setLoading(false);
    setDownloading(false);
    setImporting(false);
  }, []);

  useEffect(() => cancelPendingWork, [cancelPendingWork]);

  const reset = useCallback(() => {
    cancelPendingWork();
    setInput(EMPTY_INPUT);
    setResult(null);
    setStep(0);
    setMaxReached(0);
    setError(null);
    setReportError(null);
    setImportStatus(null);
    clearDraft();
  }, [cancelPendingWork]);

  useEffect(() => {
    purgeLegacyDrafts();
    const restored = loadDraft();
    // Deferred: sessionStorage is client-only, and react-hooks/set-state-in-effect bans sync setState here.
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
        reset();
        setError(`Your session expired after ${IDLE_MINUTES} minutes of inactivity, so your answers were cleared.`);
      }, IDLE_TIMEOUT_MS);
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((name) => window.addEventListener(name, restart, { passive: true }));
    restart();
    return () => {
      window.clearTimeout(idle);
      events.forEach((name) => window.removeEventListener(name, restart));
    };
  }, [reset]);

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

  const importDocument = async (file: File | undefined) => {
    if (!file || pendingImport.current) return;
    // Parsing cannot be interrupted, so a reset or idle timeout discards the result instead.
    const controller = new AbortController();
    pendingImport.current = controller;
    setImporting(true);
    setImportStatus(null);
    try {
      const imported = await extractDocumentText(file);
      if (controller.signal.aborted) return;
      update("description", imported.text);
      setImportStatus({
        kind: "notice",
        message: imported.truncated
          ? `Imported ${imported.fileName} (first ${DESCRIPTION_MAX_LENGTH.toLocaleString("en-US")} characters).`
          : `Imported ${imported.fileName}.`,
      });
    } catch (failure) {
      if (controller.signal.aborted) return;
      setImportStatus({
        kind: "error",
        message: failure instanceof DocumentImportError
          ? failure.message
          : "That file could not be read. Try another, or type the description instead.",
      });
    } finally {
      if (pendingImport.current === controller) {
        pendingImport.current = null;
        setImporting(false);
      }
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const progress = ((step + 1) / STEPS.length) * 100;
  const stats = statsFor(step, input, result);

  return (
    <div className="app">
      <a className="skip-link" href="#assessment">Skip to the assessment</a>

      <aside className="sidebar" aria-label="Assessment progress">
        <a className="brand" href="#top" aria-label="Data Governance Readiness Analyzer home">
          <BrandMark />
          <span><b>Readiness</b><small>Data governance</small></span>
        </a>
        <p className="nav-label">Steps</p>
        <ol className="step-list">
          {STEPS.map(({ label, icon }, index) => (
            <li key={label} className={index === step ? "current" : index < step ? "complete" : ""}>
              <button
                type="button"
                onClick={() => index <= maxReached && moveTo(index)}
                disabled={index > maxReached}
                aria-current={index === step ? "step" : undefined}
              >
                <Icon name={icon} />
                <span className="step-name">{label}</span>
                <span className="step-number">0{index + 1}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="progress-card">
          <div className="progress-copy">
            <span>Step {step + 1} of {STEPS.length}</span>
            <b>{Math.round(progress)}%</b>
          </div>
          <div className="progress-track" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
        </div>
      </aside>

      <main className="main-area" id="top">
        <div className="topbar">
          <Icon name="grid" size={18} />
          <b>{STEPS[step].label}</b>
        </div>

        <header className="page-header">
          <div>
            <h1>Readiness Assessment</h1>
            <p>Describe a data initiative in plain language. We’ll surface governance concerns and the controls needed to proceed.</p>
          </div>
          <div className="header-chips">
            <span className="chip">Rubric v1.0</span>
          </div>
        </header>

        <section className="workspace" id="assessment">
          <p className="sr-only" role="status">
            {loading ? "Assessing your answers." : `Step ${step + 1} of ${STEPS.length}: ${STEPS[step].label}`}
          </p>
          {stats.length > 0 && (
            <aside className="stat-rail" aria-label="Summary">
              {stats.map((stat) => <StatCard key={stat.title} {...stat} />)}
            </aside>
          )}

          {step === 0 && (
            <div className="step-panel">
              <h2 ref={mainHeading} tabIndex={-1}>What are you proposing?</h2>
              <p className="lede">Include what data is involved, who needs it, and the outcome you want.</p>
              <div className="card">
                <label className="text-field" htmlFor="description">
                  <span>Use-case description <b className="badge">Required</b></span>
                  <textarea
                    id="description"
                    value={input.description}
                    onChange={(event) => update("description", event.target.value)}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    aria-describedby="description-help description-error"
                    aria-invalid={Boolean(error)}
                    placeholder="For example: We want to compare our customer database with a partner’s records to understand which customers we share."
                  />
                </label>
                <div className="field-meta" id="description-help"><span>A clear sentence or two is enough. Avoid names or other identifying details.</span><span>{input.description.length} / {DESCRIPTION_MAX_LENGTH.toLocaleString("en-US")}</span></div>
                {error && <p className="error" id="description-error" role="alert">{error}</p>}

                <div
                  className={dragging ? "dropzone dragging" : "dropzone"}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void importDocument(event.dataTransfer.files[0]);
                  }}
                >
                  <span className="dropzone-icon"><Icon name="upload" /></span>
                  <div>
                    <p className="dropzone-title">Drop a document here</p>
                    <p className="dropzone-help" id="upload-help">
                      {ACCEPTED_LABEL}. It stays on your device.
                    </p>
                  </div>
                  <label className="sr-only" htmlFor="document-upload">
                    Import a document ({ACCEPTED_LABEL})
                  </label>
                  <button
                    className="secondary"
                    type="button"
                    disabled={importing}
                    onClick={() => fileInput.current?.click()}
                  >
                    {importing ? "Reading…" : "Choose file"}
                  </button>
                  <input
                    ref={fileInput}
                    id="document-upload"
                    type="file"
                    className="sr-only"
                    accept={ACCEPTED_FILE_TYPES}
                    aria-describedby="upload-help"
                    onChange={(event) => void importDocument(event.target.files?.[0])}
                  />
                </div>
                <p className="method-note import-status" aria-live="polite">{importing ? "Reading your document…" : importStatus?.kind === "notice" && input.description ? importStatus.message : ""}</p>
                {importStatus?.kind === "error" && <p className="error" role="alert">{importStatus.message}</p>}
              </div>
              <div className="actions end"><button className="primary" type="button" onClick={() => moveTo(1)}>Continue <span>→</span></button></div>
            </div>
          )}

          {step === 1 && (
            <div className="step-panel">
              <h2 ref={mainHeading} tabIndex={-1}>How will the data be handled?</h2>
              <p className="lede">Answer based on the planned operating model—not the best-case outcome.</p>

              <div className="card">
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
              </div>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="actions"><button className="secondary" type="button" onClick={() => moveTo(0)}>← Back</button><button className="primary" type="button" disabled={loading} onClick={assess}>{loading ? "Assessing…" : "Assess risk"} <span>→</span></button></div>
            </div>
          )}

          {step === 2 && result && (
            <div className="step-panel risk-result" data-risk={result.level.toLowerCase()}>
              <h2 ref={mainHeading} tabIndex={-1}>The proposed use case is <em><span className="risk-icon" aria-hidden="true" />{result.level.toLowerCase()} risk.</em></h2>
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
              <div className="actions"><button className="secondary" type="button" onClick={() => moveTo(1)}>← Back</button><button className="primary" type="button" onClick={() => moveTo(3)}>See recommendations <span>→</span></button></div>
            </div>
          )}

          {step === 3 && result && (
            <div
              className="step-panel"
              data-risk={result.level.toLowerCase()}
            >
              <h2 ref={mainHeading} tabIndex={-1}>Controls before approval.</h2>
              <p className="lede">Use this record to begin privacy, security, and business-owner review.</p>
              <div className="card">
                <div className="recommendation-outcome">
                  <b className="risk-label"><span className="risk-icon" aria-hidden="true" />{result.level} RISK · {result.score}/100</b>
                  <p>{result.guidance}</p>
                </div>
                <h3 className="card-title">General safeguards</h3>
                {result.recommendationDetails.length > 0 ? (
                  <ol className="recommendation-list">
                    {result.recommendationDetails.map((item) => {
                      const factorLabels = item.riskFactorIds.flatMap((ruleId) => {
                        const label = factorLabelsById.get(ruleId);
                        return label ? [label] : [];
                      });
                      const capability = capabilities?.byAction.get(item.action);
                      return (
                        <li key={item.id}>
                          <span>{String(item.priority).padStart(2, "0")}</span>
                          <div>
                            <h4>{item.title}</h4>
                            <p>{item.action}</p>
                            <p className="recommendation-rationale"><b>Why this applies:</b> {item.rationale}</p>
                            <p className="recommendation-trace"><b>Triggered by:</b> {factorLabels.join(", ")}</p>
                            {capability && (
                              <div className="capability-fit">
                                <p><span className="badge">Karlsgate</span><b>{capability.label}</b></p>
                                <p>{capability.text}</p>
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="empty-state">No tailored safeguards were returned. Apply standard access, minimization, retention, and governance controls before proceeding.</p>
                )}
              </div>
              {capabilities && capabilities.remaining.length > 0 && (
                <div className="capability-panel">
                  <p className="section-number">Karlsgate capability fit</p>
                  <h3>{capabilities.byAction.size > 0 ? "Further privacy-enhancing controls" : "Applicable privacy-enhancing controls"}</h3>
                  <p>Only capabilities whose documented applicability rules are satisfied are shown.</p>
                  <ul className="capability-list">
                    {capabilities.remaining.map((capability) => (
                      <li key={capability.id}><b>{capability.label}</b><p>{capability.text}</p>
                        <p className="recommendation-reason">{recommendationReason(capability, result.factors)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="method-note">Recommendation mapping v{result.mappingVersion}: {result.mappingApprovalStatus === "approved" ? "stakeholder approved" : "stakeholder approval pending"}.</p>
              {result.limitations.length > 0 && <div className="limitations"><h3>Specialist review required</h3>{result.limitations.map((item) => <p key={item}>{item}</p>)}</div>}
              <details className="summary card"><summary>Assessment record</summary><dl><div><dt>Use case</dt><dd>{input.description}</dd></div><div><dt>Data</dt><dd>{input.dataTypes.map((item) => DATA_TYPE_LABELS[item]).join(", ")}</dd></div><div><dt>Purpose</dt><dd>{PURPOSE_LABELS[input.purpose]}</dd></div><div><dt>Scoring rules version</dt><dd>{result.rulesVersion}</dd></div><div><dt>Recommendation mapping version</dt><dd>{result.mappingVersion}</dd></div><div><dt>Assessed</dt><dd>{formatAssessedAt(result.assessedAt)}</dd></div></dl></details>
              {reportError && <p className="error" role="alert">{reportError}</p>}
              <div className="actions wrap"><button className="secondary" type="button" onClick={() => moveTo(2)}>← Back</button><div><button className="destructive" type="button" onClick={reset}>Start over</button><button className="primary" type="button" disabled={downloading} onClick={download}>{downloading ? "Preparing report…" : "Download report (PDF) ↓"}</button></div></div>
            </div>
          )}
        </section>
        <footer>Decision support, not legal advice.</footer>
      </main>
    </div>
  );
}
