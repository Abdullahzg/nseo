"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card p-6 max-w-xl">
      <div className="label mb-2">Something broke</div>
      <p className="serif text-lg">{error.message || "An unexpected error occurred."}</p>
      <p className="text-sm text-ink-2 mt-2">Reload the page. If it keeps happening, the activity feed on the campaign page records every failure with its cause.</p>
      <button className="btn btn-ghost mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
