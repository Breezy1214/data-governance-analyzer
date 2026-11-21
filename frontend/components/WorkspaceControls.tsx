"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type ReviewRole, type ReviewWorkspace, postReview } from "@/lib/review";

export function WorkspaceControls({ workspaces, userId }: { workspaces: ReviewWorkspace[]; userId: string }) {
  const router = useRouter();
  const id = useId();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [member, setMember] = useState("");
  const [role, setRole] = useState<ReviewRole | "remove">("reviewer");
  const [busy, setBusy] = useState<"create" | "member" | null>(null);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ error: boolean; text: string } | null>(null);
  const administered = workspaces.filter((entry) => entry.role === "admin");
  const target = administered.length === 1 ? administered[0].id : workspace;

  async function save(action: "create" | "member", body: object) {
    setBusy(action);
    setResult(null);
    const failure = await postReview({ action, ...body });
    setBusy(null);
    setResult(failure ? { error: true, text: failure } : { error: false, text: "Saved." });
    if (failure) return;
    setName("");
    setMember("");
    setCreating(false);
    router.refresh();
  }

  function saveMember() {
    if (member.trim() === userId) {
      setResult({ error: true, text: "You can’t change your own role. As admin you can already review teammates’ submissions." });
      return;
    }
    void save("member", { workspaceId: target, userId: member.trim(), role: role === "remove" ? null : role });
  }

  // If the clipboard is blocked the ID stays on screen to select by hand.
  const copyId = () => navigator.clipboard.writeText(userId).then(() => setCopied(true), () => undefined);

  return (
    <section className="card review-panel" aria-labelledby={`${id}-heading`}>
      <div className="review-head">
        <h2 className="card-title" id={`${id}-heading`}>Workspaces</h2>
        <button type="button" className="secondary" aria-expanded={creating} onClick={() => setCreating(!creating)}>New workspace</button>
      </div>
      {creating && (
        <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void save("create", { name }); }}>
          <input aria-label="Workspace name" placeholder="Workspace name" required maxLength={100} autoFocus
            value={name} onChange={(event) => setName(event.target.value)} />
          <button className="primary" disabled={busy !== null} aria-busy={busy === "create"}>Create</button>
        </form>
      )}
      {workspaces.length > 0 ? (
        <ul className="workspace-list">
          {workspaces.map((entry) => <li key={entry.id}><span>{entry.name}</span><span className="badge badge-neutral">{ROLE_LABELS[entry.role]}</span></li>)}
        </ul>
      ) : <p className="method-note">You’re not in a workspace yet. Create one, or share your ID with a workspace admin.</p>}
      {administered.length > 0 && (
        <form onSubmit={(event) => { event.preventDefault(); saveMember(); }}>
          <h3>Add a member</h3>
          <div className="inline-form">
            {administered.length > 1 && (
              <select aria-label="Workspace" required value={workspace} onChange={(event) => setWorkspace(event.target.value)}>
                <option value="">Workspace</option>
                {administered.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            )}
            <input aria-label="Member account ID" placeholder="Their account ID" required value={member}
              onChange={(event) => setMember(event.target.value)} />
            <select aria-label="Role" value={role} onChange={(event) => setRole(event.target.value as ReviewRole | "remove")}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value="remove">Remove</option>
            </select>
            <button className="secondary" disabled={busy !== null} aria-busy={busy === "member"}>Save</button>
          </div>
        </form>
      )}
      {result && <p className={result.error ? "error" : undefined} role={result.error ? "alert" : "status"}>{result.text}</p>}
      <details className="disclosure">
        <summary>What can each role do?</summary>
        <dl className="role-guide">
          {Object.entries(ROLE_DESCRIPTIONS).map(([value, description]) => (
            <div key={value}><dt>{ROLE_LABELS[value as ReviewRole]}</dt><dd>{description}</dd></div>
          ))}
        </dl>
        <p className="method-note">The creator of a workspace is its admin. No one can decide on their own submission.</p>
      </details>
      <div className="account-id">
        <span>Your ID</span>
        <code>{userId}</code>
        <button type="button" className="secondary" onClick={copyId}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </section>
  );
}
