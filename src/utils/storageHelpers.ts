import { supabase } from "@/integrations/supabase/client";

/**
 * Extract the relative storage path from a file_url.
 * Handles both legacy full URLs and new relative paths.
 */
export function extractStoragePath(fileUrl: string): string {
  const marker = "/object/public/receipts/";
  const idx = fileUrl.indexOf(marker);
  if (idx !== -1) return fileUrl.substring(idx + marker.length);
  const marker2 = "/receipts/";
  const idx2 = fileUrl.lastIndexOf(marker2);
  if (idx2 !== -1 && fileUrl.startsWith("http")) return fileUrl.substring(idx2 + marker2.length);
  return fileUrl;
}

export async function getSignedReceiptUrl(filePath: string): Promise<string> {
  const path = extractStoragePath(filePath);
  const { data, error } = await supabase.storage
    .from("receipts")
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return "";
  return data.signedUrl;
}

/**
 * Batch-fetch signed URLs for multiple file paths.
 * Returns a Record<originalFileUrl, signedUrl>.
 */
export async function batchSignedUrls(fileUrls: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(fileUrls.filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (url) => {
      const signed = await getSignedReceiptUrl(url);
      return [url, signed] as const;
    })
  );
  return Object.fromEntries(entries);
}
