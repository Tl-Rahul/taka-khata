"use client";

export function ErrorBody({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>কিছু একটা সমস্যা হয়েছে</h1>
      <p style={{ marginTop: 8, color: "#586b63" }}>
        আবার চেষ্টা করুন। সমস্যা থাকলে এই পাতার স্ক্রিনশট পাঠান। Something went wrong — please send a screenshot of this page.
      </p>
      <pre style={{ marginTop: 16, padding: 12, background: "#fff", border: "1px solid #d3ddd7", borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>
        {String(error?.message || error)}
        {error?.digest ? `\n\ndigest: ${error.digest}` : ""}
        {error?.stack ? `\n\n${error.stack.split("\n").slice(0, 6).join("\n")}` : ""}
      </pre>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={() => reset()} style={{ padding: "10px 16px", borderRadius: 8, background: "#0b6e4f", color: "#fff", border: 0, cursor: "pointer" }}>
          আবার চেষ্টা করুন
        </button>
        <button onClick={() => (window.location.href = "/")} style={{ padding: "10px 16px", borderRadius: 8, background: "#e8eeea", border: 0, cursor: "pointer" }}>
          হোমে যান
        </button>
      </div>
    </div>
  );
}
