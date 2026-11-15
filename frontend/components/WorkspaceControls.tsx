"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewWorkspace } from "@/lib/review";
import { postReview } from "./ReviewControls";

export function WorkspaceControls({ workspaces, userId }: { workspaces: ReviewWorkspace[]; userId: string }) {
  const router = useRouter();
  const [name, setName] = useState(""); const [workspace, setWorkspace] = useState("");
  const [member, setMember] = useState(""); const [role, setRole] = useState("submitter");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function save(body: object) {
    setBusy(true); setMessage("");
    try { await postReview(body); setMessage("Saved."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save."); }
    finally { setBusy(false); }
  }
  return <section className="card review-panel">
    <h2>Workspaces</h2>
    <p>Your account ID: <code>{userId}</code>. Share this ID with your workspace admin to join.</p>
    <ul>{workspaces.map((w) => <li key={w.id}>{w.name} — {w.role}</li>)}</ul>
    <form onSubmit={(e) => { e.preventDefault(); void save({ action: "create", name }); }}>
      <label className="text-field">New workspace name<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button className="secondary" disabled={busy}>Create workspace</button>
    </form>
    <p>You become admin of a workspace you create. This does not grant access to anyone else’s workspace.</p>
    {workspaces.some((w) => w.role === "admin") && <form onSubmit={(e) => { e.preventDefault(); void save({ action: "member", workspaceId: workspace, userId: member, role: role === "remove" ? null : role }); }}>
      <h3>Manage members</h3>
      <label className="text-field">Workspace<select required value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
        <option value="">Choose a workspace</option>{workspaces.filter((w) => w.role === "admin").map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select></label>
      <label className="text-field">Member account ID<input required value={member} onChange={(e) => setMember(e.target.value)} /></label>
      <label className="text-field">Role<select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="submitter">Submitter</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option><option value="remove">Remove membership</option>
      </select></label>
      <button className="secondary" disabled={busy}>Save membership</button>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
