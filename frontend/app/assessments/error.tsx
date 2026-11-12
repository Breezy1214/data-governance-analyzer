"use client";

import Link from "next/link";

export default function RegisterError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="auth-page">
      <header className="auth-heading"><h1>My assessments is unavailable</h1></header>
      <p className="error" role="alert">Saved assessments couldn’t be loaded. Please try again.</p>
      <div className="actions">
        <Link href="/">New assessment</Link>
        <button className="primary" type="button" onClick={() => retry()}>Try again</button>
      </div>
    </main>
  );
}
