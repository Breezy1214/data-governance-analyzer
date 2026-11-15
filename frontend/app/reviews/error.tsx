"use client";
import Link from "next/link";
export default function ReviewError({ retry }: { error: unknown; retry: () => void }) {
  return <main className="auth-page"><h1>Reviews are unavailable</h1>
    <p role="alert">The workspace could not be loaded. Please try again.</p>
    <button className="secondary" onClick={retry}>Try again</button><Link href="/assessments">My assessments</Link>
  </main>;
}
