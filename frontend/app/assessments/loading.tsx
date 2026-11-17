import { RegisterShell } from "@/components/RegisterShell";
import { REGISTER_PATH } from "@/lib/register";

export default function LoadingAssessments() {
  return (
    <RegisterShell section="My assessments" current={REGISTER_PATH}
      title={<><span className="sr-only">Loading…</span><span className="skeleton skeleton-title" aria-hidden="true" /></>}>
      <div className="step-panel" aria-busy="true">
        <div className="card" aria-hidden="true">
          {Array.from({ length: 6 }, (_, line) => <span key={line} className="skeleton skeleton-line" />)}
        </div>
      </div>
    </RegisterShell>
  );
}
