import type { BillResult } from "./api/client";
import ComparisonView from "./ComparisonView";
import { money } from "./format";

function BillReport({ result }: { result: BillResult }) {
  const { report, comparison } = result;

  if (report.empty || !comparison) {
    return <p className="font-mono text-sm text-mute">{report.findings[0]}</p>;
  }

  return (
    <ComparisonView
      comparison={comparison}
      kind="bill"
      refId={result.bill.id}
      switchRecord={result.switch}
      footer={
        <div className="grid md:grid-cols-2 gap-8 mb-8">
          <Breakdown title="Spend by person" rows={report.by_user.map((u) => ({ name: u.user, cost: u.cost_cents, tokens: u.tokens }))} />
          <Breakdown title="Spend by model" rows={report.by_model.map((m) => ({ name: m.tier ? `${m.model} · ${m.tier}` : m.model, cost: m.cost_cents, tokens: m.tokens }))} />
        </div>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 mb-10 gap-y-6">
        <Stat label="Current spend / month" value={money(comparison.current_monthly_cents)}
          note={comparison.current_basis === "list_price" ? "estimated from list price" : `projected from ${report.period_days} day(s)`} />
        <Stat label="Seats" value={String(report.seats)} note={`${report.underused_seats.length} underused`} />
        <Stat label="Cost per seat (bill)" value={money(report.cost_per_seat_cents)} note={`${report.events} events`} />
        <Stat label="Tokens (bill)" value={report.total_tokens.toLocaleString()}
          note={report.cost_per_1k_tokens_cents !== null ? `${money(report.cost_per_1k_tokens_cents)} per 1K` : ""} />
      </div>

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
    </ComparisonView>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note: string }) {
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
