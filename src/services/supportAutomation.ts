import type {
  AutomationRule,
  AutomationRuleInput,
} from "../types/supportAutomation";
async function request<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`/api/support/${path}`, {
    credentials: "include",
    cache: "no-store",
    ...(body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || "Unable to access automation.");
  return result;
}
export const getAutomationRules = () =>
  request<{ rules: AutomationRule[]; server_auto_send_enabled: boolean }>(
    "automation",
  );
export const saveAutomationRule = (
  rule: AutomationRuleInput,
  existing?: AutomationRule,
) =>
  request<AutomationRule>(
    "automation",
    { rule, id: existing?.id, updated_at: existing?.updated_at },
    existing ? "PUT" : "POST",
  );
export const runAutomation = (caseId: string) =>
  request<{ message: string }>("automation-run", { case_id: caseId });
