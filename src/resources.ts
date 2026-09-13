export type ResourcePolicy = {
  /** Exact origins, never URL prefixes. Nothing is fetched by default. */
  allowedOrigins?: readonly string[];
  allowRelative?: boolean;
  allowDataImages?: boolean;
  allowBlob?: boolean;
  /** Native application protocols must be explicitly permitted. */
  allowedProtocols?: readonly string[];
};
export function allowedImageURL(raw: string, policy: ResourcePolicy = {}): string | null {
  if (typeof raw !== "string" || !raw || raw.includes("\\") || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  if (/^data:/i.test(raw)) return policy.allowDataImages && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(raw) ? raw : null;
  if (/^blob:/i.test(raw)) return policy.allowBlob ? raw : null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith("//")) return policy.allowRelative ? raw : null;
  try {
    const url = new URL(raw, "https://resource.invalid");
    if (["javascript:", "vbscript:", "data:", "file:", "ftp:"].includes(url.protocol) || url.username || url.password) return null;
    if (["https:", "http:"].includes(url.protocol)) return policy.allowedOrigins?.includes(url.origin) ? raw : null;
    return policy.allowedProtocols?.includes(url.protocol) ? raw : null;
  } catch { return null; }
}
