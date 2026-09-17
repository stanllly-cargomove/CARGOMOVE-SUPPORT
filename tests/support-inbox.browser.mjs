// Optional browser verification against the production build and fixture APIs.
// No live Gmail or Supabase requests are permitted by the routing handler.
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root = path.resolve("dist");
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(
    root,
    "." + (pathname.startsWith("/assets/") ? pathname : "/index.html"),
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(file);
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".png")
            ? "image/png"
            : "text/html",
    );
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
let checks = 0;
try {
  let authenticated = true,
    connected = true,
    failCases = false,
    syncCalls = 0,
    analysisCalls = 0,
    savedAnalysis = null,
    failAnalysis = false,
    replyCalls = 0,
    failReply = false;
  const id = "11111111-1111-4111-8111-111111111111";
  const record = {
    id,
    gmail_thread_id: "thread1",
    customer_name: "ABC Logistics",
    customer_email: "customer@example.com",
    subject: "Vehicle XYZ123 unavailable",
    status: "NEW",
    category: "VEHICLE",
    subcategory: null,
    port: "WESTPORT",
    urgency: "NORMAL",
    ai_confidence: null,
    assigned_to: null,
    created_at: "2026-09-16T08:00:00Z",
    updated_at: "2026-09-16T08:00:00Z",
    resolved_at: null,
    preview: "Please help with our booking.",
    last_message_at: "2026-09-16T08:00:00Z",
  };
  const stats = {
    new_cases: 1,
    open_cases: 1,
    need_review: 0,
    ai_drafts: 0,
    resolved_today: 0,
    total_cases: 1,
    categories: [{ name: "VEHICLE", count: 1 }],
    ports: [{ name: "WESTPORT", count: 1 }],
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const queries = [];
  const knowledge = [];
  const replies = [];
  const deliveries = [],
    caseEvents = [],
    outbound = [];
  let deliveryCalls = 0,
    learningCalls = 0;
  const automationRules = [];
  let automationRuns = 0;
  const learning = [1, 2].map((n) => ({
    id: `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`,
    category: "VEHICLE",
    subcategory: "VEHICLE_NOT_FOUND",
    port: "WESTPORT",
    existing_knowledge_id: null,
    knowledge_version: null,
    suggested_problem: "Repeated vehicle correction " + n,
    suggested_resolution: "Staff corrected guidance " + n,
    suggested_action: null,
    evidence_count: 3,
    status: "PENDING",
    updated_at: "2026-09-17T12:00:00Z",
    created_at: "2026-09-17T12:00:00Z",
    reviewed_by: null,
    reviewed_at: null,
  }));
  let replyVersion = 0;
  let knowledgeVersion = 0;
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    let status = 200;
    if (url.pathname === "/api/auth/session")
      body = {
        authenticated,
        user: authenticated
          ? { id: "admin", type: "ADMIN", email: "support@example.com" }
          : null,
      };
    else if (url.pathname === "/api/snapshot")
      body = {
        ports: [],
        depots: [],
        companies: [],
        submissions: [],
        userRegistrations: [],
        guideline: null,
      };
    else if (url.pathname === "/api/external-user-access") body = { users: [] };
    else if (url.pathname === "/api/gmail/status")
      body = {
        connected,
        inboxPermissionGranted: connected,
        connection: connected
          ? { email: "support@example.com", status: "ACTIVE" }
          : null,
      };
    else if (url.pathname === "/api/gmail/sync") {
      syncCalls++;
      body = {
        mode: "HISTORY",
        processed_threads: 1,
        inserted_messages: 1,
        has_more: syncCalls === 1,
        history_id: "100",
      };
    } else if (url.pathname === "/api/support/analysis") {
      body = { interaction: savedAnalysis, stale: false };
    } else if (url.pathname === "/api/support/analyze") {
      analysisCalls++;
      if (failAnalysis) {
        status = 503;
        body = {
          error:
            "AI is temporarily unavailable. Continue handling the case manually.",
        };
      } else {
        savedAnalysis = {
          id: "analysis1",
          case_id: id,
          category: "VEHICLE",
          subcategory: "VEHICLE_NOT_FOUND",
          port: "WESTPORT",
          language: "MIXED_MS_EN",
          urgency: "HIGH",
          confidence: 0.95,
          requires_human_review: true,
          short_explanation: "Customer reports unavailable vehicle.",
          recommended_action: "VERIFY_WITH_PORT",
          entities: { vehicle_number: "XYZ123" },
        };
        body = { interaction: savedAnalysis, cached: false };
        record.status = "NEEDS_REVIEW";
        record.ai_confidence = 0.95;
      }
    } else if (url.pathname === "/api/support/automation") {
      if (route.request().method() === "GET")
        body = { rules: automationRules, server_auto_send_enabled: false };
      else {
        const submitted = route.request().postDataJSON();
        const rule = {
          ...submitted.rule,
          id: submitted.id || "44444444-4444-4444-8444-444444444444",
          updated_at: "2026-09-17T14:00:00Z",
        };
        const index = automationRules.findIndex((r) => r.id === rule.id);
        if (index < 0) automationRules.push(rule);
        else automationRules[index] = rule;
        body = rule;
      }
    } else if (url.pathname === "/api/support/automation-run") {
      automationRuns++;
      status = 409;
      body = {
        error: "No active analysis rule permits automation for this case.",
      };
    } else if (url.pathname === "/api/support/analytics") {
      const empty = url.searchParams.get("from") === "2027-01-01";
      body = {
        cohort: { from: null, to_exclusive: null },
        cases: {
          total: empty ? 0 : 1,
          new: 0,
          open: empty ? 0 : 1,
          resolved: 0,
          escalated: empty ? 0 : 1,
          escalation_events: empty ? 0 : 1,
        },
        ai: {
          classifications: empty ? 0 : 1,
          suggested_drafts: empty ? 0 : 3,
          knowledge_drafts: empty ? 0 : 1,
          static_drafts: empty ? 0 : 2,
          approved_unchanged: 0,
          approved_edited: empty ? 0 : 1,
          approved_unknown_comparison: 0,
          confirmed_sends: empty ? 0 : 1,
          classification_corrections: null,
        },
        response: {
          average_seconds: empty ? null : 120,
          median_seconds: empty ? null : 120,
          sample_cases: empty ? 0 : 1,
          awaiting_first_response: 0,
          without_inbound: 0,
        },
        categories: empty ? [] : [{ name: "VEHICLE", count: 1 }],
        subcategories: empty ? [] : [{ name: "VEHICLE_NOT_FOUND", count: 1 }],
        ports: empty ? [] : [{ name: "WESTPORT", count: 1 }],
        daily_cases: empty ? [] : [{ day: "2026-09-16", count: 1 }],
        knowledge_usage: empty
          ? []
          : [
              {
                id: "kb1",
                knowledge_code: "KB-VEHICLE-001",
                title: "Vehicle guidance",
                active: false,
                drafts: 1,
                sent_replies: 1,
              },
            ],
      };
    } else if (url.pathname === "/api/support/learning") {
      if (route.request().method() === "POST") {
        learningCalls++;
        const submitted = route.request().postDataJSON();
        if (submitted.action === "DETECT") body = { created: 0 };
        else {
          const suggestion = learning.find((s) => s.id === submitted.id);
          suggestion.status =
            submitted.action === "APPROVE" ? "APPROVED" : "REJECTED";
          suggestion.reviewed_by = "admin";
          suggestion.reviewed_at = "2026-09-17T12:30:00Z";
          let article = null;
          if (submitted.article) {
            article = {
              ...submitted.article,
              id: "learned-article",
              updated_at: "2026-09-17T12:30:00Z",
            };
            knowledge.push(article);
            suggestion.approved_article = article;
          }
          body = { suggestion, article };
        }
      } else {
        const filtered = learning.filter(
          (s) => s.status === url.searchParams.get("status"),
        );
        body = { suggestions: filtered, total: filtered.length };
      }
    } else if (url.pathname === "/api/support/learning-detail") {
      const suggestion = learning.find(
        (s) => s.id === url.searchParams.get("id"),
      );
      body = {
        suggestion,
        knowledge: null,
        evidence: [
          {
            case_id: id,
            interaction_id: "fixture-evidence",
            generated_reply: "Original generated guidance",
            final_reply: "Staff corrected guidance",
            approved_by: "admin",
            approved_at: "2026-09-17T12:00:00Z",
          },
        ],
      };
    } else if (url.pathname === "/api/support/delivery") {
      if (route.request().method() === "POST") {
        deliveryCalls++;
        const submitted = route.request().postDataJSON();
        const draft = replies.find((d) => d.id === submitted.draft_id);
        const operation = {
          id: "delivery-" + deliveryCalls,
          case_id: id,
          draft_id: draft.id,
          kind: submitted.kind,
          status: "DONE",
          draft_version: draft.updated_at,
          context_fingerprint: draft.context_fingerprint,
          reply_text: draft.edited_reply,
          generated_reply: draft.interaction.generated_reply,
          requested_by: "admin",
          created_at: "2026-09-17T10:00:00Z",
          completed_at: "2026-09-17T10:00:01Z",
        };
        deliveries.unshift(operation);
        if (submitted.kind === "SEND") {
          record.status = "WAITING_CUSTOMER";
          outbound.push({
            id: "sent-message",
            case_id: id,
            direction: "OUTBOUND",
            sender_email: "support@example.com",
            recipient_email: record.customer_email,
            sent_at: operation.completed_at,
            body_text: operation.reply_text,
          });
        }
        body = { operation };
      } else
        body = {
          recipient: record.customer_email,
          deliveries,
          events: caseEvents,
        };
    } else if (url.pathname === "/api/support/case-status") {
      const submitted = route.request().postDataJSON();
      const target = {
        RESOLVE: "RESOLVED",
        ESCALATE: "ESCALATED",
        REOPEN: "NEW",
      }[submitted.action];
      caseEvents.unshift({
        id: "event-" + caseEvents.length,
        action: submitted.action,
        reason: submitted.reason,
        actor_id: "admin",
        created_at: "2026-09-17T11:00:00Z",
      });
      record.status = target;
      record.resolved_at =
        target === "RESOLVED" ? "2026-09-17T11:00:00Z" : null;
      record.updated_at = "2026-09-17T11:00:0" + caseEvents.length + "Z";
      body = {
        recipient: record.customer_email,
        deliveries,
        events: caseEvents,
      };
    } else if (url.pathname === "/api/support/reply") {
      if (route.request().method() === "PUT") {
        const submitted = route.request().postDataJSON();
        const draft = replies.find((d) => d.id === submitted.id);
        draft.edited_reply = submitted.reply_text;
        draft.updated_at = `2026-09-17T09:00:${String(replyVersion++).padStart(2, "0")}Z`;
        body = { draft };
      } else {
        const requested = url.searchParams.get("draft_id");
        const draft = requested
          ? replies.find((d) => d.id === requested)
          : replies.at(-1);
        body = {
          draft: draft
            ? {
                ...draft,
                stale: draft.knowledge.some(
                  (k) =>
                    !knowledge.find((current) => current.id === k.id)?.active,
                ),
              }
            : null,
        };
      }
    } else if (url.pathname === "/api/support/generate-reply") {
      replyCalls++;
      const submitted = route.request().postDataJSON();
      const template = submitted.template_id;
      const sources =
        template === "KNOWLEDGE"
          ? knowledge.filter((k) => k.active && k.ai_reply_allowed)
          : [];
      if (failReply) {
        status = 503;
        body = { error: "AI reply generation is temporarily unavailable." };
      } else if (template === "KNOWLEDGE" && !sources.length) {
        status = 409;
        body = { error: "No matching active knowledge allows AI replies." };
      } else {
        let draft = replies.find((d) => d.template_id === template);
        const cached = !!draft;
        if (!draft) {
          const text =
            template === "KNOWLEDGE"
              ? "Please review the approved vehicle guidance with support staff."
              : template === "ACKNOWLEDGE"
                ? "Thank you for contacting CargoMove."
                : "Please provide a brief description and relevant reference.";
          draft = {
            id: `22222222-2222-4222-8222-${String(replies.length + 1).padStart(12, "0")}`,
            case_id: id,
            source_analysis_id: savedAnalysis.id,
            interaction_id: "reply-interaction",
            template_id: template,
            context_fingerprint: "fixture-context",
            edited_reply: text,
            created_at: "2026-09-17T08:00:00Z",
            updated_at: `2026-09-17T09:00:${String(replyVersion++).padStart(2, "0")}Z`,
            stale: false,
            interaction: {
              ...savedAnalysis,
              model: "fixture-model",
              knowledge_ids: sources.map((k) => k.id),
              generated_reply: text,
              final_reply: null,
              approved_by: null,
            },
            knowledge: sources.map((k) => ({ ...k })),
          };
          replies.push(draft);
        }
        body = { draft, cached };
      }
    } else if (url.pathname === "/api/support/knowledge-matches") {
      body = {
        interaction_id: savedAnalysis?.id || null,
        stale: false,
        articles: knowledge.filter((k) => k.active),
      };
    } else if (url.pathname === "/api/support/knowledge") {
      if (route.request().method() === "GET") {
        const q = (url.searchParams.get("q") || "").toLowerCase();
        const active = url.searchParams.get("active");
        const visible = knowledge.filter(
          (k) =>
            (!q || JSON.stringify(k).toLowerCase().includes(q)) &&
            (!active || String(k.active) === active),
        );
        body = { articles: visible, total: visible.length };
      } else {
        const submitted = route.request().postDataJSON();
        const updated = {
          ...submitted.article,
          id: submitted.id || "knowledge1",
          created_by: "admin",
          updated_by: "admin",
          created_at: "2026-09-16T08:00:00Z",
          updated_at: `2026-09-16T09:00:${String(knowledgeVersion++).padStart(2, "0")}Z`,
        };
        const index = knowledge.findIndex((k) => k.id === updated.id);
        if (index < 0) knowledge.push(updated);
        else knowledge[index] = updated;
        status = route.request().method() === "POST" ? 201 : 200;
        body = updated;
      }
    } else if (url.pathname === "/api/support/stats") body = stats;
    else if (url.pathname === "/api/support/cases") {
      queries.push(url.searchParams);
      if (failCases) {
        status = 503;
        body = { error: "Support data is temporarily unavailable." };
      } else {
        const visible = url.searchParams.get("q") !== "nomatch";
        body = {
          cases: visible ? [record] : [],
          total: visible ? 1 : 0,
          assignees: [],
        };
      }
    } else if (url.pathname === "/api/support/case") {
      const older = url.searchParams.get("offset") === "50";
      body = {
        supportCase: record,
        message_total: 55,
        interactions: [],
        messages: [
          ...outbound,
          {
            id: older ? "older" : "latest",
            case_id: id,
            direction: "INBOUND",
            sender_name: "ABC Logistics",
            sender_email: "customer@example.com",
            recipient_email: "support@example.com",
            sent_at: "2026-09-16T08:00:00Z",
            body_text: older
              ? "Older customer message"
              : "Cannot book vehicle XYZ123. Please help.",
            body_html: '<img src=x onerror="window.incomingXss=true">',
          },
        ],
      };
    } else throw new Error(`Unexpected API request: ${url.pathname}`);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/admin/support");
  await page.getByRole("heading", { name: "Recent cases" }).waitFor();
  checks++;
  await page.getByRole("button", { name: "Open support inbox" }).click();
  await page.getByRole("heading", { name: "AI Email Assistant" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/admin/support/inbox");
  checks++;
  await page.getByRole("button", { name: /ABC Logistics/ }).click();
  await page
    .getByText("Cannot book vehicle XYZ123. Please help.", { exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, `/admin/support/case/${id}`);
  assert.equal(await page.locator('img[src="x"]').count(), 0);
  assert.equal(await page.evaluate(() => window.incomingXss), undefined);
  checks += 3;
  await page.getByText("No AI analysis has been run for this case.").waitFor();
  assert.equal(analysisCalls, 0);
  checks++;
  await page.getByRole("button", { name: "Analyze case", exact: true }).click();
  await page
    .getByRole("region", { name: "AI analysis", exact: true })
    .getByText("95% confidence", { exact: true })
    .waitFor();
  await page.getByText("Human review required", { exact: true }).waitFor();
  assert.equal(analysisCalls, 1);
  checks += 2;
  failAnalysis = true;
  await page.getByRole("button", { name: "Analyze case", exact: true }).click();
  await page
    .getByText(
      "AI is temporarily unavailable. Continue handling the case manually.",
    )
    .waitFor();
  assert.ok(
    await page
      .getByText("Cannot book vehicle XYZ123. Please help.", { exact: true })
      .isVisible(),
  );
  checks++;
  failAnalysis = false;
  await page
    .getByText("No suggested reply has been generated.", { exact: true })
    .waitFor();
  assert.equal(replyCalls, 0);
  checks++;
  await page
    .getByRole("button", { name: "Generate suggested reply", exact: true })
    .click();
  await page
    .getByText("No matching active knowledge allows AI replies.", {
      exact: true,
    })
    .waitFor();
  checks++;
  await page
    .getByRole("combobox", { name: "Reply template", exact: true })
    .selectOption("ACKNOWLEDGE");
  await page
    .getByRole("button", { name: "Generate suggested reply", exact: true })
    .click();
  const replyText = page.getByRole("textbox", {
    name: "Suggested reply",
    exact: true,
  });
  await replyText.waitFor();
  assert.equal(
    await replyText.inputValue(),
    "Thank you for contacting CargoMove.",
  );
  checks++;
  await replyText.fill("Thank you. Staff edited wording.");
  await page.waitForTimeout(100);
  assert.equal(
    await page
      .getByRole("button", { name: "Generate suggested reply", exact: true })
      .isDisabled(),
    true,
  );
  checks++;
  await page
    .getByRole("button", { name: "Save draft edits", exact: true })
    .click();
  await page.getByText(/Saved draft · \d+\/6000/).waitFor();
  await page
    .getByRole("button", { name: "Reload saved draft", exact: true })
    .click();
  await replyText.waitFor();
  assert.equal(
    await replyText.inputValue(),
    "Thank you. Staff edited wording.",
  );
  assert.equal(
    replies[0].interaction.generated_reply,
    "Thank you for contacting CargoMove.",
  );
  checks += 2;
  await page
    .getByRole("combobox", { name: "Reply template", exact: true })
    .selectOption("REQUEST_DETAILS");
  await page
    .getByRole("button", { name: "Generate suggested reply", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('textarea[aria-label="Suggested reply"]')
        ?.value ===
      "Please provide a brief description and relevant reference.",
  );
  checks++;
  await page
    .getByRole("combobox", { name: "Reply template", exact: true })
    .selectOption("ACKNOWLEDGE");
  await page
    .getByRole("button", { name: "Generate suggested reply", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('textarea[aria-label="Suggested reply"]')
        ?.value === "Thank you. Staff edited wording.",
  );
  checks++;
  failReply = true;
  await page
    .getByRole("button", { name: "Generate suggested reply", exact: true })
    .click();
  await page
    .getByText("AI reply generation is temporarily unavailable.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await replyText.inputValue(),
    "Thank you. Staff edited wording.",
  );
  checks++;
  failReply = false;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/cargomove-support-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Older messages", exact: true })
    .click();
  await page.getByText("Older customer message", { exact: true }).waitFor();
  checks++;
  await page.goBack();
  await page.getByRole("heading", { name: "Select a conversation" }).waitFor();
  checks++;
  await page
    .getByPlaceholder("Search customer, message, or reference…")
    .fill("nomatch");
  await page.getByText("No support cases match your search.").waitFor();
  checks++;
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: /ABC Logistics/ }).waitFor();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("NEW");
  await page.waitForTimeout(450);
  assert.ok(queries.some((q) => q.get("status") === "NEW"));
  checks++;
  assert.equal(syncCalls, 0);
  checks++;
  await page.getByRole("button", { name: "Sync Gmail", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue sync", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Continue sync", exact: true })
    .click();
  await page.getByText(/Inbox is up to date/).waitFor();
  assert.equal(syncCalls, 2);
  checks++;
  failCases = true;
  await page
    .getByRole("button", { name: "Refresh cases", exact: true })
    .click();
  await page.getByText("Support data is temporarily unavailable.").waitFor();
  checks++;
  failCases = false;
  connected = false;
  await page
    .getByRole("button", { name: "Refresh cases", exact: true })
    .click();
  await page.getByText("Gmail is not connected.").waitFor();
  await page.getByRole("button", { name: /ABC Logistics/ }).waitFor();
  checks++;
  await page
    .getByRole("button", { name: "Knowledge Base", exact: true })
    .click();
  await page
    .getByText("No Knowledge Base articles found.", { exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, "/admin/support/knowledge");
  checks += 2;
  await page
    .getByRole("button", { name: "Create article", exact: true })
    .click();
  const editor = page.getByRole("form", { name: "Knowledge editor" });
  await editor
    .getByLabel("Knowledge code", { exact: true })
    .fill("KB-VEHICLE-001");
  await editor
    .getByLabel("Title", { exact: true })
    .fill("Vehicle fixture guidance");
  await editor.getByLabel("Category", { exact: true }).selectOption("VEHICLE");
  await editor
    .getByLabel("Subcategory", { exact: true })
    .selectOption("VEHICLE_NOT_FOUND");
  await editor
    .getByLabel("Problem", { exact: true })
    .fill("Vehicle cannot be selected.");
  await editor
    .getByLabel("Resolution", { exact: true })
    .fill("Fixture guidance for staff review.");
  await editor
    .getByLabel("Keywords (comma separated)", { exact: true })
    .fill("vehicle, lorry");
  await editor.getByLabel("AI reply allowed", { exact: true }).check();
  assert.equal(
    await editor
      .getByLabel("Active (approved for retrieval)", { exact: true })
      .isChecked(),
    false,
  );
  checks++;
  await page.screenshot({
    path: "/tmp/cargomove-knowledge-editor-desktop.png",
    fullPage: true,
  });
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit KB-VEHICLE-001", exact: true })
    .waitFor();
  assert.equal(knowledge.length, 1);
  assert.equal(knowledge[0].active, false);
  checks += 2;
  await editor
    .getByLabel("Title", { exact: true })
    .fill("Reviewed vehicle fixture guidance");
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("heading", {
      name: "Reviewed vehicle fixture guidance",
      exact: true,
    })
    .waitFor();
  checks++;
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await page
    .getByRole("button", { name: "Activate KB-VEHICLE-001", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Deactivate KB-VEHICLE-001", exact: true })
    .waitFor();
  assert.equal(knowledge[0].active, true);
  checks++;
  await page
    .getByRole("combobox", { name: "Filter Active", exact: true })
    .selectOption("false");
  await page
    .getByText("No Knowledge Base articles found.", { exact: true })
    .waitFor();
  checks++;
  await page
    .getByRole("combobox", { name: "Filter Active", exact: true })
    .selectOption("");
  await page
    .getByPlaceholder("Search guidance, code or keywords…")
    .fill("nomatch");
  await page
    .getByText("No Knowledge Base articles found.", { exact: true })
    .waitFor();
  checks++;
  await page.getByPlaceholder("Search guidance, code or keywords…").fill("");
  await page
    .getByRole("button", { name: "Edit KB-VEHICLE-001", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Support Inbox", exact: true })
    .click();
  await page.getByRole("button", { name: /ABC Logistics/ }).click();
  await page
    .getByText("KB-VEHICLE-001 · Reviewed vehicle fixture guidance", {
      exact: true,
    })
    .click();
  await page
    .getByText("Resolution: Fixture guidance for staff review.", {
      exact: true,
    })
    .waitFor();
  checks++;
  await page
    .getByRole("combobox", { name: "Reply template", exact: true })
    .selectOption("KNOWLEDGE");
  await page
    .getByRole("button", { name: "Generate suggested reply", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('textarea[aria-label="Suggested reply"]')
        ?.value ===
      "Please review the approved vehicle guidance with support staff.",
  );
  assert.equal(replies.at(-1).knowledge[0].knowledge_code, "KB-VEHICLE-001");
  checks++;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/cargomove-suggested-reply-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Knowledge Base", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Deactivate KB-VEHICLE-001", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Activate KB-VEHICLE-001", exact: true })
    .waitFor();
  assert.equal(knowledge[0].active, false);
  checks++;
  await page.goto(origin + "/admin/support/knowledge");
  await page
    .locator("main")
    .getByRole("heading", { name: "Knowledge Base", exact: true })
    .waitFor();
  checks++;
  await page
    .getByRole("button", { name: "Support Inbox", exact: true })
    .click();
  await page.getByRole("button", { name: /ABC Logistics/ }).click();
  await page
    .getByText("No approved knowledge matches this classification.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByText(
      "This draft uses changed conversation, analysis or knowledge. Refresh the analysis and generate a current draft before continuing.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Suggested reply", exact: true })
      .isDisabled(),
    true,
  );
  checks++;
  checks++;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "/tmp/cargomove-support-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  checks++;
  await page
    .getByRole("button", { name: "Knowledge Base", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit KB-VEHICLE-001", exact: true })
    .click();
  await page.getByRole("form", { name: "Knowledge editor" }).waitFor();
  await page.waitForTimeout(250);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  checks++;
  await page.screenshot({
    path: "/tmp/cargomove-knowledge-editor-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  checks++;
  await page
    .getByRole("button", { name: "Operations Dashboard", exact: true })
    .click();
  assert.equal(new URL(page.url()).pathname, "/");
  checks++;
  await page.goto(origin + `/admin/support/case/${id}`);
  await page
    .getByText("Cannot book vehicle XYZ123. Please help.", { exact: true })
    .waitFor();
  checks++;
  await page
    .getByRole("combobox", { name: "Reply template", exact: true })
    .selectOption("ACKNOWLEDGE");
  await page
    .getByRole("button", { name: "Generate suggested reply", exact: true })
    .click();
  const deliveryPanel = page.getByRole("region", { name: "Reply delivery" });
  await deliveryPanel
    .getByText("customer@example.com", { exact: true })
    .waitFor();
  assert.equal(deliveryCalls, 0);
  checks++;
  const sendButton = deliveryPanel.getByRole("button", {
    name: "Approve & send",
    exact: true,
  });
  assert.equal(await sendButton.isDisabled(), true);
  checks++;
  const replyDeliveryEditor = page.getByRole("textbox", {
    name: "Suggested reply",
    exact: true,
  });
  await replyDeliveryEditor.fill("Browser staff reviewed reply.");
  assert.equal(
    await deliveryPanel
      .getByRole("button", { name: "Create Gmail draft", exact: true })
      .isDisabled(),
    true,
  );
  checks++;
  await page
    .getByRole("button", { name: "Save draft edits", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create Gmail draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Gmail draft saved", exact: true })
    .waitFor();
  assert.equal(deliveryCalls, 1);
  assert.equal(outbound.length, 0);
  checks += 2;
  await page
    .getByRole("checkbox", { name: /I reviewed the saved reply/ })
    .check();
  await page
    .getByRole("button", { name: "Approve & send", exact: true })
    .click();
  await page
    .getByText("Browser staff reviewed reply.", { exact: true })
    .first()
    .waitFor();
  await page.getByText(/Reply sent ·/).waitFor();
  assert.equal(deliveryCalls, 2);
  assert.equal(record.status, "WAITING_CUSTOMER");
  assert.equal(outbound[0].body_text, "Browser staff reviewed reply.");
  checks += 3;
  assert.equal(
    await page
      .getByRole("button", { name: "Approve & send", exact: true })
      .isDisabled(),
    true,
  );
  checks++;
  assert.equal(
    await page
      .getByRole("button", { name: "Resolve", exact: true })
      .isDisabled(),
    true,
  );
  checks++;
  await page
    .getByRole("textbox", { name: "Case action reason" })
    .fill("Staff confirmed resolution.");
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page.getByRole("button", { name: "Reopen", exact: true }).waitFor();
  assert.equal(record.status, "RESOLVED");
  checks++;
  await page
    .getByRole("textbox", { name: "Case action reason" })
    .fill("Customer needs further assistance.");
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await page.getByRole("button", { name: "Escalate", exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "Case action reason" })
    .fill("Port review required.");
  await page.getByRole("button", { name: "Escalate", exact: true }).click();
  await page.getByRole("textbox", { name: "Case action reason" }).waitFor();
  await page.getByText("Case action history", { exact: true }).click();
  await page.getByText("Port review required.", { exact: false }).waitFor();
  assert.equal(caseEvents.length, 3);
  assert.equal(record.status, "ESCALATED");
  checks += 2;
  await page.screenshot({
    path: "/tmp/cargomove-support-delivery-mobile.png",
    fullPage: true,
  });
  await page.goto(origin + "/admin/support/learning");
  await page
    .getByRole("heading", { name: "AI Learning Suggestions", exact: true })
    .waitFor();
  assert.equal(learningCalls, 0);
  checks++;
  await page
    .getByRole("button", { name: "Detect repeated corrections", exact: true })
    .click();
  await page
    .getByText("0 new suggestions detected.", { exact: true })
    .waitFor();
  assert.equal(learningCalls, 1);
  checks++;
  await page
    .getByRole("button", { name: /Repeated vehicle correction 1/ })
    .click();
  await page.getByRole("region", { name: "Learning review" }).waitFor();
  await page
    .getByText("Correction evidence (3 cases; latest 20 shown)", {
      exact: true,
    })
    .click();
  await page
    .getByText("Original generated guidance", { exact: true })
    .waitFor();
  checks++;
  await page
    .getByRole("button", { name: "Edit & approve", exact: true })
    .click();
  const learningEditor = page.getByRole("form", { name: "Knowledge editor" });
  await learningEditor.waitFor();
  await learningEditor
    .getByLabel("Resolution", { exact: true })
    .fill("Human generalized vehicle guidance.");
  await learningEditor
    .getByRole("button", {
      name: "Approve suggestion and save knowledge",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: /Repeated vehicle correction 2/ })
    .waitFor();
  assert.equal(learning[0].status, "APPROVED");
  assert.equal(knowledge.at(-1).active, false);
  assert.equal(knowledge.at(-1).ai_reply_allowed, false);
  assert.equal(
    knowledge.at(-1).resolution,
    "Human generalized vehicle guidance.",
  );
  checks += 4;
  await page
    .getByRole("button", { name: /Repeated vehicle correction 2/ })
    .click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page
    .getByText("No learning suggestions found.", { exact: true })
    .waitFor();
  assert.equal(learning[1].status, "REJECTED");
  checks++;
  await page
    .getByRole("combobox", { name: "Suggestion status", exact: true })
    .selectOption("APPROVED");
  await page
    .getByRole("button", { name: /Repeated vehicle correction 1/ })
    .click();
  await page
    .getByText(/Reviewed by admin/)
    .last()
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Edit & approve", exact: true })
      .count(),
    0,
  );
  checks++;
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  checks++;
  await page.screenshot({
    path: "/tmp/cargomove-learning-mobile.png",
    fullPage: true,
  });
  await page.goto(origin + "/admin/support/analytics");
  await page
    .locator("main")
    .getByRole("heading", { name: "Support Analytics", exact: true })
    .waitFor();
  await page.getByText("2.0 min", { exact: true }).first().waitFor();
  checks++;
  await page.getByText(/Classification corrections: unavailable/).waitFor();
  checks++;
  await page
    .getByRole("columnheader", { name: "Sent replies", exact: true })
    .waitFor();
  checks++;
  await page
    .getByLabel("Analytics from date", { exact: true })
    .fill("2027-01-01");
  await page.getByRole("button", { name: "Apply dates", exact: true }).click();
  await page
    .getByText("No recorded knowledge usage.", { exact: true })
    .waitFor();
  assert.equal(await page.getByText("No data", { exact: true }).count(), 2);
  checks++;
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  checks++;
  await page.screenshot({
    path: "/tmp/cargomove-analytics-mobile.png",
    fullPage: true,
  });
  await page.goto(origin + "/admin/support/automation");
  await page
    .locator("main")
    .getByRole("heading", { name: "Support Automation", exact: true })
    .waitFor();
  await page
    .getByText("Server auto-send switch: OFF", { exact: true })
    .waitFor();
  assert.equal(automationRuns, 0);
  checks++;
  await page
    .getByRole("button", { name: "Create automation rule", exact: true })
    .click();
  const ruleEditor = page.getByRole("form", { name: "Automation rule editor" });
  assert.equal(
    await ruleEditor
      .getByRole("checkbox", {
        name: "Auto-send fixed acknowledgement",
        exact: true,
      })
      .isChecked(),
    false,
  );
  checks++;
  assert.equal(
    await ruleEditor
      .getByRole("checkbox", { name: "Always require human", exact: true })
      .isChecked(),
    true,
  );
  checks++;
  await ruleEditor
    .getByRole("button", { name: "Save automation rule", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit rule", exact: true }).waitFor();
  assert.equal(automationRules[0].active, false);
  assert.equal(deliveryCalls, 2);
  checks += 2;
  await page.getByRole("button", { name: "Edit rule", exact: true }).click();
  await ruleEditor
    .getByRole("combobox", { name: "Rule category", exact: true })
    .selectOption("ACCOUNT");
  await ruleEditor
    .getByRole("combobox", { name: "Rule subcategory", exact: true })
    .selectOption("LOGIN");
  await ruleEditor
    .getByRole("checkbox", { name: "Active", exact: true })
    .check();
  await ruleEditor
    .getByRole("checkbox", { name: "Always require human", exact: true })
    .uncheck();
  await ruleEditor
    .getByRole("checkbox", {
      name: "Auto-send fixed acknowledgement",
      exact: true,
    })
    .check();
  await ruleEditor
    .getByRole("button", { name: "Save automation rule", exact: true })
    .click();
  await page.getByText(/Auto acknowledgement ON/).waitFor();
  assert.equal(automationRules[0].auto_send_enabled, true);
  assert.equal(deliveryCalls, 2);
  checks += 2;
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  checks++;
  await page.getByRole('button',{name:'Edit rule',exact:true}).click();
  await ruleEditor.getByRole('checkbox',{name:'Active',exact:true}).uncheck();
  assert.equal(await ruleEditor.getByRole('checkbox',{name:'Auto-send fixed acknowledgement',exact:true}).isChecked(),false);checks++;
  await ruleEditor.getByRole('button',{name:'Save automation rule',exact:true}).click();
  await page.getByText(/Inactive · Analysis/).waitFor();assert.equal(automationRules[0].auto_send_enabled,false);checks++;
  await page.screenshot({
    path: "/tmp/cargomove-automation-mobile.png",
    fullPage: true,
  });
  await page.goto(origin + `/admin/support/case/${id}`);
  await page
    .getByRole("button", { name: "Run configured automation", exact: true })
    .waitFor();
  assert.equal(automationRuns, 0);
  checks++;
  await page
    .getByRole("button", { name: "Run configured automation", exact: true })
    .click();
  await page
    .getByText("No active analysis rule permits automation for this case.", {
      exact: true,
    })
    .waitFor();
  assert.equal(automationRuns, 1);
  checks++;
  authenticated = false;
  await page.goto(origin + "/admin/support/inbox");
  await page.getByRole("button", { name: /Sign In|Log In|Login/i }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "AI Email Assistant" }).count(),
    0,
  );
  checks++;
  await page.goto(origin + "/admin/support/learning");
  await page.getByRole("button", { name: /Sign In|Log In|Login/i }).waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "AI Learning Suggestions", exact: true })
      .count(),
    0,
  );
  checks++;
  await page.goto(origin + "/admin/support/analytics");
  await page.getByRole("button", { name: /Sign In|Log In|Login/i }).waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Support Analytics", exact: true })
      .count(),
    0,
  );
  checks++;
  await page.goto(origin + "/admin/support/automation");
  await page.getByRole("button", { name: /Sign In|Log In|Login/i }).waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Support Automation", exact: true })
      .count(),
    0,
  );
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  await context.close();
  console.log(
    `${checks} desktop/mobile navigation, privacy, sync and error checks passed.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
