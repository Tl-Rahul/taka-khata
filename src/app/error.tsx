"use client";
import { ErrorBody } from "@/components/ErrorBody";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBody error={error} reset={reset} />;
}
