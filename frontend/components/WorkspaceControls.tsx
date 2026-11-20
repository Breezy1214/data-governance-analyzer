"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { type ReviewRole, type ReviewWorkspace, postReview } from "@/lib/review";

const ROLE_LABELS: Record<ReviewRole, string> = { submitter: "Submitter", reviewer: "Reviewer", admin: "Admin" };

export function WorkspaceControls({ workspaces, userId }: { workspaces: ReviewWorkspace[]; userId: string }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [member, setMember] = useState("");
  const [role, setRole] = useState<ReviewRole | "remove">("submitter");
  const [busy, setBusy] = useState<"create" | "member" | null>(null);
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

  return (
    <section className="card review-panel" aria-labelledby={`${id}-heading`}>
      <h2 className="card-title" id={`${id}-heading`}>Workspaces</h2>
      <p>Your account ID is <code>{userId}</code>. Share it with a workspace admin to be added.</p>
      {workspaces.length > 0 && (
        <ul>{workspaces.map((entry) => <li key={entry.id}>{entry.name} · {ROLE_LABELS[entry.role]}</li>)}</ul>
      )}
      <form onSubmit={(event) => { event.preventDefault(); void save("create", { name }); }}>
        <label className="text-field" htmlFor={`${id}-name`}>
          <span>New workspace name</span>
          <input id={`${id}-name`} required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className="method-note">You become the admin of a workspace you create.</p>
        <button className="secondary" disabled={busy !== null} aria-busy={busy === "create"}>Create workspace</button>
      </form>
      {administered.length > 0 && (
        <form onSubmit={(event) => {
          event.preventDefault();
          void save("member", { workspaceId: workspace, userId: member.trim(), role: role === "remove" ? null : role });
        }}>
          <h3>Manage members</h3>
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
      )}
      {result && <p className={result.error ? "error" : undefined} role={result.error ? "alert" : "status"}>{result.text}</p>}
    </section>
  );
}
