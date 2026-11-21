"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type ReviewRole, type ReviewWorkspace, postReview } from "@/lib/review";

export function WorkspaceControls({ workspaces, userId }: { workspaces: ReviewWorkspace[]; userId: string }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [member, setMember] = useState("");
  const [role, setRole] = useState<ReviewRole | "remove">("submitter");
  const [busy, setBusy] = useState<"create" | "member" | null>(null);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ error: boolean; text: string } | null>(null);
  const administered = workspaces.filter((entry) => entry.role === "admin");

  async function save(action: "create" | "member", body: object) {
    setBusy(action);
    setResult(null);
    const failure = await postReview({ action, ...body });
    setBusy(null);
    setResult(failure ? { error: true, text: failure } : { error: false, text: "Saved." });
    if (!failure) router.refresh();
  }

  // If the clipboard is blocked the ID stays on screen to select by hand.
  const copyId = () => navigator.clipboard.writeText(userId).then(() => setCopied(true), () => undefined);

  return (
    <section className="card review-panel" aria-labelledby={`${id}-heading`}>
      <h2 className="card-title" id={`${id}-heading`}>Workspaces</h2>
      <p>A workspace is a team that reviews each other’s assessments. Whoever creates a workspace becomes its admin.</p>
      <div className="account-id">
        <span>Your account ID</span>
        <code>{userId}</code>
        <button type="button" className="secondary" onClick={copyId}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <h3>Your workspaces</h3>
      {workspaces.length > 0
        ? <ul>{workspaces.map((entry) => <li key={entry.id}>{entry.name} · {ROLE_LABELS[entry.role]}</li>)}</ul>
        : <p className="method-note">You’re not in a workspace yet. Create one below, or send your account ID to a workspace admin so they can add you.</p>}
      <h3>What each role can do</h3>
      <dl className="role-guide">
        {Object.entries(ROLE_DESCRIPTIONS).map(([value, description]) => (
          <div key={value}><dt>{ROLE_LABELS[value as ReviewRole]}</dt><dd>{description}</dd></div>
        ))}
      </dl>
      <p className="method-note">No one can decide on their own submission, including admins.</p>
      <form onSubmit={(event) => { event.preventDefault(); void save("create", { name }); }}>
        <h3>Create a workspace</h3>
        <label className="text-field" htmlFor={`${id}-name`}>
          <span>Workspace name</span>
          <input id={`${id}-name`} required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className="method-note">You become its admin and can then add teammates.</p>
        <button className="secondary" disabled={busy !== null} aria-busy={busy === "create"}>Create workspace</button>
      </form>
      {administered.length > 0 ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          void save("member", { workspaceId: workspace, userId: member.trim(), role: role === "remove" ? null : role });
        }}>
          <h3>Manage members</h3>
          <p className="method-note">Ask your teammate for the account ID shown on their Workspace reviews page.</p>
          <label className="select-field" htmlFor={`${id}-workspace`}>
            <span>Workspace</span>
            <select id={`${id}-workspace`} required value={workspace} onChange={(event) => setWorkspace(event.target.value)}>
              <option value="">Choose a workspace</option>
              {administered.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <label className="text-field" htmlFor={`${id}-member`}>
            <span>Member account ID</span>
            <input id={`${id}-member`} required value={member} onChange={(event) => setMember(event.target.value)} />
          </label>
          <label className="select-field" htmlFor={`${id}-role`}>
            <span>Role</span>
            <select id={`${id}-role`} value={role} onChange={(event) => setRole(event.target.value as ReviewRole | "remove")}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value="remove">Remove from workspace</option>
            </select>
          </label>
          <button className="secondary" disabled={busy !== null} aria-busy={busy === "member"}>Save membership</button>
        </form>
      ) : workspaces.length > 0 && <p className="method-note">Only a workspace admin can add members or change roles.</p>}
      {result && <p className={result.error ? "error" : undefined} role={result.error ? "alert" : "status"}>{result.text}</p>}
    </section>
  );
}
