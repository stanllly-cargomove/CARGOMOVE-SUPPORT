import type { SupportAnalytics } from "../types/supportAnalytics";
export async function getSupportAnalytics(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<SupportAnalytics> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const response = await fetch(`/api/support/analytics?${params}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || "Unable to load support analytics.");
  return body;
}
