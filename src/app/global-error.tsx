"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "6rem 1rem", background: "#fbf8f2", color: "#17151f" }}>
        <h1>Something went wrong</h1>
        <p>Please try again in a moment.</p>
        <button onClick={reset} style={{ padding: "0.7rem 1.4rem", borderRadius: 999, border: 0, background: "#ff4d2e", color: "white", fontWeight: 700 }}>Retry</button>
      </body>
    </html>
  );
}
