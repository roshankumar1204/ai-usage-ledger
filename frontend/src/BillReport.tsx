import type { BillResult } from "./api/client";

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function BillReport({ result }: { result: BillResult }) {
  const { report, comparison } = result;

  if (report.empty || !comparison) {
    return <p className="font-mono text-sm text-mute">{report.findings[0]}</p>;
  }

  const rec = comparison.recommendation;
  const recommendedId = rec.plan_id;

  return (
    <div>
      {/* Recommendation */}
      <div
        className="border p-5 mb-8"
        style={{ borderColor: rec.plan_id ? "#1F6F54" : "#E3E0D8", background: rec.plan_id ? "rgba(31,111,84,0.05)" : undefined }}
      >
        <p className="font-mono text-xs uppercase tracking-wide text-mute mb-1">Recommendation</p>
        <p className="font-display text-xl font-semibold leading-snug">{rec.headline}</p>
        {rec.api_tip && <p className="text-sm text-mute mt-2">{rec.api_tip}</p>}
        {comparison.confidence === "low" && (
          <ul className="mt-3 text-xs text-pending space-y-1">
            {comparison.reasons.map((r) => (
              <li key={r}>⚠ {r}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 mb-10 gap-y-6">
        <Stat label="Current spend / month" value={money(comparison.current_monthly_cents)}
          note={comparison.current_basis === "list_price" ? "estimated from list price" : `projected from ${report.period_days} day(s)`} />
        <Stat label="Seats" value={String(report.seats)} note={`${report.underused_seats.length} underused`} />
        <Stat label="Cost per seat (bill)" value={money(report.cost_per_seat_cents)} note={`${report.events} events`} />
        <Stat label="Tokens (bill)" value={report.total_tokens.toLocaleString()}
          note={report.cost_per_1k_tokens_cents !== null ? `${money(report.cost_per_1k_tokens_cents)} per 1K` : ""} />
      </div>

      {/* Findings */}
      <section className="mb-10">
        <h3 className="text-sm uppercase tracking-wide text-mute mb-3 border-b border-line pb-2">What this bill shows</h3>
        <ul className="text-sm space-y-2">
          {report.findings.map((f) => (
            <li key={f} className="flex gap-2">
              <span className="text-mute">—</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Comparison table */}
      <section className="mb-10">
        <h3 className="text-sm uppercase tracking-wide text-mute mb-3 border-b border-line pb-2">
          Same usage, every {comparison.category} plan
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-mute border-b border-line">
                <th className="py-2 font-normal">Plan</th>
                <th className="font-normal">Billing</th>
                <th className="font-normal text-right">Per month</th>
                <th className="font-normal text-right">vs today</th>
                <th className="font-normal pl-4">Fit</th>
                <th className="font-normal">Price</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {comparison.options.map((o) => (
                <tr
                  key={o.plan_id}
                  className="border-b border-line/60"
                  style={o.plan_id === recommendedId ? { background: "rgba(31,111,84,0.08)" } : undefined}
                >
                  <td className="py-3 font-sans text-sm">
                    {o.product}
                    {o.plan_id === recommendedId && <span className="ml-2 font-mono text-xs text-verified">BEST</span>}
                    {o.is_current_vendor && <span className="ml-2 font-mono text-xs text-mute">current vendor</span>}
                  </td>
                  <td className="text-mute">{o.pricing === "seat" ? `per seat · ${o.tier}` : `per token · ${o.tier}`}</td>
                  <td className="text-right">{money(o.monthly_cents)}</td>
                  <td className="text-right" style={{ color: o.savings_cents > 0 ? "#1F6F54" : "#B33A3A" }}>
                    {o.savings_cents > 0 ? `−${money(o.savings_cents)}` : `+${money(-o.savings_cents)}`}
                  </td>
                  <td className="pl-4 text-mute">{o.fit}</td>
                  <td>
                    <a href={o.official_url} target="_blank" rel="noreferrer" className="underline decoration-line hover:decoration-ink"
                      style={{ color: o.confidence === "official" ? "#1F6F54" : "#B8860B" }}>
                      {o.confidence}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Breakdown */}
      <div className="grid md:grid-cols-2 gap-8 mb-8">
        <Breakdown title="Spend by person" rows={report.by_user.map((u) => ({ name: u.user, cost: u.cost_cents, tokens: u.tokens }))} />
        <Breakdown title="Spend by model" rows={report.by_model.map((m) => ({ name: m.tier ? `${m.model} · ${m.tier}` : m.model, cost: m.cost_cents, tokens: m.tokens }))} />
      </div>

      <p className="text-xs text-mute leading-relaxed">
        Assumptions: {comparison.assumptions.join(" ")} Prices marked "third-party" come from 2026 pricing guides; click to check the vendor's page.
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="pr-6">
      <p className="text-xs uppercase tracking-wide text-mute mb-1">{label}</p>
      <p className="font-mono text-2xl">{value}</p>
      <p className="font-mono text-xs text-mute mt-1">{note}</p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { name: string; cost: number; tokens: number }[] }) {
  return (
    <section>
      <h3 className="text-sm uppercase tracking-wide text-mute mb-3 border-b border-line pb-2">{title}</h3>
      <table className="w-full font-mono text-xs">
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.name} className="border-b border-line/60">
              <td className="py-2 truncate max-w-[200px]">{r.name}</td>
              <td className="text-right text-mute">{r.tokens.toLocaleString()} tok</td>
              <td className="text-right">{money(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default BillReport;
