"use client";
import { ErrorBody } from "@/components/ErrorBody";

// Last-resort screen: shows the real error so it can be reported, instead of a blank crash page.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="bn" translate="no">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, background: "#f2f5f3", color: "#11251d" }}>
        <ErrorBody error={error} reset={reset} />
      </body>
    </html>
  );
}

