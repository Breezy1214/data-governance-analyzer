"use client";

import Link from "next/link";

export default function ReviewError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="auth-page">
      <header className="auth-heading"><h1>Workspace reviews are unavailable</h1></header>
      <p className="error" role="alert">Workspaces and submissions couldn’t be loaded. Please try again.</p>
      <div className="actions">
        <Link href="/assessments">My assessments</Link>
        <button className="primary" type="button" onClick={() => retry()}>Try again</button>
      </div>
    </main>
  );
}
