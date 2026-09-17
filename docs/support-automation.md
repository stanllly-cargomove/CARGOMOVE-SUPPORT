# Milestone 10 — controlled automation

`/admin/support/automation` provides category/subcategory/port rules for an explicit per-case **Run configured automation** action. No background worker, scheduled scan, sync hook or automatic action on opening a page is enabled. Analysis and drafting reuse the existing model/provider validation, leases and cache. Delivery reuses the Gmail threading, recipient checks, outbox and uncertain-result reconciliation.

Selective auto-send is deliberately limited to the fixed bilingual **acknowledge receipt** template. Generated knowledge guidance, staff-edited replies and operational assertions still require staff approval. This milestone does not add automatic AI-written operational replies or trusted port verification.

## Setup and default behavior

1. Apply `supabase/migrations/20260917000040_support_automation.sql` after Milestone 9. Do not rerun old migrations.
2. Restart the API. Existing Gemini, Supabase, OAuth and session configuration is reused. There is no new Gmail permission.
3. Leave the new server-only `SUPPORT_AUTO_SEND_ENABLED` unset or `false`. `.env.example` documents this default; `.env.local` was not changed. Never use a VITE variable for this switch.
4. Open **Support Automation**. There are no seeded active rules. New rules are inactive, analysis/drafting enabled, auto-send off, confidence 90%, always-human on. Existing foundation defaults remain unchanged.
5. Create an active rule for the cases you want the runner to analyze. An OTHER/general/ALL rule can allow initial classification of imported unclassified cases; it must retain always-human and auto-send off.
6. Configure a rule for the resulting classified category/subcategory/port. Open a case and click **Run configured automation**. There are no model or Gmail calls until this explicit action.
7. The initial matching rule must permit analysis. After classification, the resulting matching rule must permit drafting, and confidence must meet its threshold. Otherwise the runner saves analysis and stops. If no approved knowledge permits drafting, it saves a fixed acknowledgement for manual review instead. All manually generated/analyzed actions remain available independently of runner rules.

## Opting in to fixed acknowledgements

These steps enable real emails when the case runner is invoked. Auto-send remains off unless **both** the rule and the server switch explicitly allow it:

- Use a specific low-risk subcategory under DRIVER, VEHICLE, BOOKING, ACCOUNT or REGISTRATION. General, PORT, CONTAINER, SYSTEM and OTHER scopes must always require human review.
- Enable Active, AI analysis and AI draft; set confidence at least 90%; switch Always require human off; enable Auto-send fixed acknowledgement; save the rule.
- Independently verify that any relevant active knowledge flags are appropriate. A matching article requiring human review or port verification blocks automatic acknowledgement, even if it is not one of the top five retrieval results or disallows AI replies.
- Only when ready, set server-only `SUPPORT_AUTO_SEND_ENABLED=true` and restart/redeploy the API. The settings page shows the current server switch. Setting it false or unsetting it blocks future automatic writes. Disabling a rule also blocks future claims; turning off Active/analysis/draft or turning on Always require human in the editor also clears its Auto-send flag.

The acknowledged text is the existing fixed English/Malay receipt template, chosen by stored classification language. It says the enquiry was received and further guidance needs support review. No booking, driver, vehicle, container or port status is asserted. It contains no customer identifiers, generated operational instructions, attachments, Cc or Bcc.

HIGH/CRITICAL urgency, escalated/resolved/waiting-customer cases, high-risk subcategories (including early entry, port cancellation, vessel discrepancy, unknown/system errors, container discrepancy, yard opening and dangerous goods), required knowledge verification, stale analysis or stale/edited drafts prevent automatic sending. A staff-detected conflict should be escalated; no trusted-tool conflict detector is implemented. The acknowledgement exception does not authorize unverified operational claims.

If the analysis stage takes more than ten seconds, the runner saves analysis and asks for another run before starting acknowledgement delivery. The next run normally uses the cached classification. This preserves time for OAuth refresh, live Gmail preflight and delivery within the existing request limit. No send retry is introduced.

## Scope resolution and concurrency

The category must match. A specific subcategory outranks a general rule; within that specificity, an exact port outranks ALL. An inactive more-specific matching rule blocks automation for its scope rather than falling back to a broader active rule. Saved scopes are unique. No matching rule means automation is disabled.

Edits require the rule's exact `updated_at`; stale edits and duplicate scopes are rejected. Rule changes retain before/after snapshots, the session actor and time in the private rule event table. There is no delete API; deactivate rules instead.

The automatic delivery claim locks the case, draft, applied rule and eligible knowledge rows. It checks current policy, exact saved rule version, current classification/context/knowledge, confidence and the exact fixed generated/edited text. A client-provided `reviewed`, rule ID or automation flag cannot select the internal automatic delivery path. Manual delivery keeps its original review confirmation.

Once a write has already been claimed, toggling the switch/rule cannot cancel that in-flight Gmail request. Gmail/PostgreSQL do not share a transaction. Timeouts, ambiguous responses and persistence errors remain blocked in the existing outbox; **Check Gmail result** performs read-only reconciliation. No automatic retry or browser force-unlock is added. The same latest inbound message cannot be sent another reply after a confirmed CargoMove send.

## Audit and analytics

Deliveries gain `approval_mode`, `automation_rule_id` and `automation_rule_version`. Legacy/manual deliveries default to MANUAL. Fixed acknowledgements use AUTOMATIC_ACK and retain the triggering admin as operation actor, the exact payload and applied rule version. Their final reply/comparison and outbound message are recorded, while `ai_interactions.approved_by` and `approved_at` remain null: they were not reviewed by a human. The reply delivery panel labels them as automatic acknowledgements. Read-only reconciliation retains this distinction.

Static template replies remain outside AI knowledge approval/edit counts. Confirmed-send analytics include actual automatic sends. Automatic unedited acknowledgements do not contribute to human-correction learning evidence.

## APIs and security

- `GET /api/support/automation`: rules and the current server switch.
- `POST /api/support/automation`: `{rule}` to create.
- `PUT /api/support/automation`: `{id,updated_at,rule}` to edit.
- `POST /api/support/automation-run`: `{case_id}` to run one case.

Every API requires an admin session. Actor IDs come from that session. Rule validation bounds confidence, flags, taxonomy and risk scope. Database checks independently prevent high-risk/general human-review bypass and invalid auto-send combinations. New RPCs and the private rule-event table have browser access revoked. No secret, provider thought or hidden reasoning is stored or exposed.

## Completion report

Created: `supabase/migrations/20260917000040_support_automation.sql`, `server-handlers/support/automation.ts`, `src/types/supportAutomation.ts`, `src/services/supportAutomation.ts`, `src/components/admin/support/AutomationSettings.tsx`, `tests/support-automation.database.mjs`, and this guide.

Modified: shared API routes (`api/mail.ts`, `server.ts`); sidebar/direct routing (`AdminLayout.tsx`, `src/utils/support/routes.ts`); case detail runner; delivery handler/type/panel for the separate internal automatic path and audit label; `.env.example`; fixture browser tests; `SUPABASE_SETUP.md`.

Database changes: replace the foundation human-only rule constraint with acknowledgement/risk checks; add delivery audit columns; add private rule-change events and service-only rule/policy/automatic-claim RPCs. The confirmed delivery transaction is wrapped to preserve automatic audit attribution. No default enables auto-send.

No live send, live migration, model call, commit, push or deployment was performed during implementation validation. Work remains on `uat`. No project dependencies or real credentials were changed. Temporary validation tooling lives outside the repository. The existing large JavaScript chunk warning remains (~1.43 MB before gzip).

```sh
PGLITE_MODULE=/tmp/cargomove-validation/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/support-automation.database.mjs
```

This completes the ten requested milestones. Automatic receipt acknowledgement remains opt-in; generated operational guidance continues through human review.

Validation passed: TypeScript/lint and production build; 131 isolated automation/delivery SQL/API checks; 91 desktop/mobile fixture browser checks (including earlier support workflows and deactivation clearing auto-send); 39 analytics SQL/API regression checks and 4 reply MIME/preflight unit checks. Production browser JavaScript contains no server secret variable names or the server-only master switch. The mobile settings page was visually inspected.
