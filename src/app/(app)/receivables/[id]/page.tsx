"use client";
import { use } from "react";
import { LoanDetail } from "@/components/LoanDetail";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <LoanDetail id={id} direction="lent" />;
}
