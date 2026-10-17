import { t } from "../i18n";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // matches the server's MAX_UPLOAD_MB default
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** Quick checks before upload so people get an answer without waiting. The server still decides. */
export function checkPhoto(file: File): string | null {
  const heicByName = /\.(heic|heif)$/i.test(file.name); // some browsers report HEIC with an empty type
  if (!ACCEPTED_TYPES.includes(file.type) && !heicByName) return t("details.wrongType");
  if (file.size > MAX_UPLOAD_BYTES) return t("details.tooBig");
  return null;
}
