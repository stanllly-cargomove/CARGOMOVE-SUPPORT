import { useState } from "react";
import { getSupportAnalytics } from "../../../services/supportAnalytics";
import { useSupportResource } from "../../../hooks/support/useSupportResource";
import type { MetricGroup } from "../../../types/supportAnalytics";
import { supportLabel } from "../../../utils/support/status";
function duration(seconds: number | null) {
  if (seconds === null) return "No data";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}
function Distribution({ title, rows }: { title: string; rows: MetricGroup[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold">{title}</h2>
      {rows.length ? (
        rows.map((row) => (
          <div key={row.name} className="mt-3">
            <div className="flex justify-between gap-3 text-xs text-slate-600">
              <span>{supportLabel(row.name)}</span>
              <span>{row.count}</span>
            </div>
            <div aria-hidden="true" className="mt-1 h-2 rounded bg-slate-100">
              <div
                className="h-full rounded bg-blue-500"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))
      ) : (
        <p className="mt-3 text-sm text-slate-500">No cases in this period.</p>
      )}
    </section>
  );
}
export function SupportAnalytics() {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [range, setRange] = useState({ from: "", to: "" }),
    [revision, setRevision] = useState(0),
    [error, setError] = useState("");
  const resource = useSupportResource(
    `${range.from}:${range.to}:${revision}`,
    (signal) => getSupportAnalytics(range.from, range.to, signal),
  );
  const data = resource.data;
  const cards = data
    ? [
        ["Total cases", data.cases.total],
        ["New cases", data.cases.new],
        ["Open cases", data.cases.open],
        ["Resolved cases", data.cases.resolved],
        ["Currently escalated", data.cases.escalated],
        ["Escalation actions", data.cases.escalation_events],
        ["AI classifications", data.ai.classifications],
        ["AI knowledge drafts", data.ai.knowledge_drafts],
        ["Static template drafts", data.ai.static_drafts],
        ["Knowledge replies unchanged", data.ai.approved_unchanged],
        ["Knowledge replies edited", data.ai.approved_edited],
        ["Confirmed CargoMove sends", data.ai.confirmed_sends],
      ]
    : [];
  return (
    <div className="space-y-5 p-5 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Support Analytics</h1>
        <button
          type="button"
          disabled={resource.loading}
          onClick={() => setRevision((v) => v + 1)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
        >
          Refresh analytics
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Cases created in the selected UTC period, including their subsequent
        recorded activity. All time by default. Categories and statuses reflect
        current values.
      </p>
      <form
        aria-label="Analytics date range"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to && from > to) {
            setError("The end date must be on or after the start date.");
            return;
          }
          setError("");
          setRange({ from, to });
          setRevision((v) => v + 1);
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="text-xs font-semibold">
          From (UTC)
          <input
            aria-label="Analytics from date"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 bg-white p-2"
          />
        </label>
        <label className="text-xs font-semibold">
          To (UTC, inclusive)
          <input
            aria-label="Analytics to date"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 bg-white p-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
        >
          Apply dates
        </button>
      </form>
      {(error || resource.error) && (
        <p role="alert" className="text-sm text-rose-700">
          {error || resource.error}
        </p>
      )}
      {resource.loading ? (
        <p role="status" className="text-sm text-slate-500">
          Loading analytics…
        </p>
      ) : (
        data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {cards.map(([label, value]) => (
                <article
                  key={label}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <h2 className="text-xs text-slate-500">{label}</h2>
                  <p className="mt-2 text-2xl font-bold">{value}</p>
                </article>
              ))}
            </div>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold">First response time</h2>
              <div className="mt-3 flex flex-wrap gap-6 text-sm">
                <p>
                  Average:{" "}
                  <strong>{duration(data.response.average_seconds)}</strong>
                </p>
                <p>
                  Median:{" "}
                  <strong>{duration(data.response.median_seconds)}</strong>
                </p>
                <p>{data.response.sample_cases} measured cases</p>
                <p>
                  {data.response.awaiting_first_response} awaiting a first
                  response
                </p>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                From the earliest stored inbound email to the first stored
                outbound email at or after it. Includes imported replies.
                Imported history may be incomplete; this is elapsed time, not
                business hours.
              </p>
            </section>
            <div className="grid gap-4 lg:grid-cols-3">
              <Distribution title="Issue categories" rows={data.categories} />
              <Distribution
                title="Issue subcategories"
                rows={data.subcategories}
              />
              <Distribution title="Port distribution" rows={data.ports} />
            </div>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold">AI review metrics</h2>
              <p className="mt-2 text-sm text-slate-600">
                Approval comparisons count confirmed knowledge-based replies.
                Static templates are excluded.{" "}
                {data.ai.approved_unknown_comparison} approved replies have no
                recorded comparison.
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Classification corrections: unavailable — manual classification
                corrections are not recorded. These counts do not measure AI
                accuracy.
              </p>
            </section>
            <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold">Knowledge usage (top 20)</h2>
              {data.knowledge_usage.length ? (
                <table className="mt-3 w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th className="py-2 pr-3">Article</th>
                      <th className="p-2">Drafts</th>
                      <th className="p-2">Sent replies</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.knowledge_usage.map((k) => (
                      <tr key={k.id} className="border-t border-slate-100">
                        <td className="py-3 pr-3">
                          <span className="break-words font-semibold">
                            {k.knowledge_code}
                          </span>
                          <span className="mt-1 block break-words text-slate-500">
                            {k.title} · {k.active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="p-2">{k.drafts}</td>
                        <td className="p-2">{k.sent_replies}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  No recorded knowledge usage.
                </p>
              )}
            </section>
            <details className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-bold">
                Cases created by UTC day
              </summary>
              <div className="mt-3 space-y-2 text-xs">
                {data.daily_cases.length ? (
                  data.daily_cases.map((d) => (
                    <p key={d.day}>
                      {d.day}: {d.count} cases
                    </p>
                  ))
                ) : (
                  <p>No cases in this period.</p>
                )}
              </div>
            </details>
          </>
        )
      )}
    </div>
  );
}
