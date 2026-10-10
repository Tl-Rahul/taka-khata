"use client";
import { getSupabase } from "@/lib/supabase/client";

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

export async function uploadReceipt(userId: string, file: File): Promise<string> {
  if (file.size > RECEIPT_MAX_BYTES) throw new Error("receipt.too_big");
  if (!RECEIPT_TYPES.includes(file.type)) throw new Error("receipt.bad_type");
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await getSupabase().storage.from("receipts").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("receipt.upload_failed");
  return path;
}

export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await getSupabase().storage.from("receipts").createSignedUrl(path, 300);
  if (error || !data) throw new Error("receipt.open_failed");
  return data.signedUrl;
}

export async function deleteReceipt(path: string): Promise<void> {
  await getSupabase().storage.from("receipts").remove([path]);
}
