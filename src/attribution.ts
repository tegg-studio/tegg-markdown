export type AttributionPlacement = "default" | "host";
/** "host" delegates placement; it does not waive the license requirement. */
export function createAttribution(placement: AttributionPlacement = "default"): HTMLElement | null {
  if (placement === "host") return null;
  const footer = document.createElement("div");
  footer.className = "tegg-attribution";
  const link = document.createElement("a");
  link.textContent = "Powered by Tegg Markdown";
  link.href = "https://github.com/tegg-studio/tegg-markdown";
  link.target = "_blank"; link.rel = "noopener noreferrer";
  footer.append(link);
  return footer;
}
