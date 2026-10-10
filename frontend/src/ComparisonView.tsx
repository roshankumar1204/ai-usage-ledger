import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage, recordSwitch, undoSwitch, type Comparison, type PlanOption, type SwitchRecord } from "./api/client";
import { money } from "./format";

interface Props {
  comparison: Comparison;
  kind: "bill" | "manual";
  refId: number;
  switchRecord: SwitchRecord | null;
  children?: ReactNode;   // shown between the recommendation and the plan table
  footer?: ReactNode;     // shown under the plan table
}

function ComparisonView({ comparison, kind, refId, switchRecord, children, footer }: Props) {
  const [switched, setSwitched] = useState<SwitchRecord | null>(switchRecord);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const rec = comparison.recommendation;
  const productOf = (planId: string) => comparison.options.find((o) => o.plan_id === planId)?.product ?? planId;

  const change = async (planId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      if (planId) setSwitched((await recordSwitch(kind, refId, planId)).switch);
      else {
        await undoSwitch(kind, refId);
        setSwitched(null);
      }
      queryClient.invalidateQueries({ queryKey: ["team"] });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const seatPlans = comparison.options.filter((o) => o.pricing === "seat");
  const apiPlans = comparison.options.filter((o) => o.pricing === "token");

  const row = (o: PlanOption) => (
    <li
      key={o.plan_id}
      className="border-b border-line/60 py-3 px-2 -mx-2"
      style={o.plan_id === rec.plan_id ? { background: "rgba(31,111,84,0.08)" } : undefined}
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm">
          {o.product}
          {o.plan_id === rec.plan_id && <span className="ml-2 font-mono text-xs text-verified">BEST</span>}
          {o.is_current_vendor && <span className="ml-2 font-mono text-xs text-mute">current vendor</span>}
        </p>
        <p className="font-mono text-sm whitespace-nowrap">{money(o.monthly_cents)}<span className="text-mute text-xs">/mo</span></p>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mt-1 font-mono text-xs">
        <p className="text-mute">
          {o.tier === "low" ? "lower tier" : "premium tier"}
          {o.pricing === "seat" && o.fit !== "ok" ? ` · ${o.fit}` : ""}
          {" · "}
          <a href={o.official_url} target="_blank" rel="noreferrer" className="underline decoration-line hover:decoration-ink"
            style={{ color: o.confidence === "official" ? "#1F6F54" : "#B8860B" }}>
            {o.confidence === "official" ? "official price" : "third-party price"}
          </a>
        </p>
        <p className="flex items-baseline gap-3">
          <span style={{ color: o.savings_cents > 0 ? "#1F6F54" : "#B33A3A" }}>
            {o.savings_cents > 0 ? `save ${money(o.savings_cents)}` : `+${money(-o.savings_cents)}`}
          </span>
          {switched?.plan_id === o.plan_id ? (
            <span className="text-verified">switched ✓</span>
          ) : (
            <button onClick={() => change(o.plan_id)} disabled={busy} className="text-mute underline hover:text-ink">
              I switched
            </button>
          )}
        </p>
      </div>
    </li>
  );

  return (
    <div>
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

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {switched ? (
            <>
              <p className="font-mono text-xs text-verified">
                ✓ Tracking your switch to {productOf(switched.plan_id)}:{" "}
                {money(switched.from_monthly_cents - switched.to_monthly_cents)}/month saved
              </p>
              <button onClick={() => change(null)} disabled={busy} className="font-mono text-xs text-mute underline">
                undo
              </button>
            </>
          ) : (
            rec.plan_id && (
              <button
                onClick={() => change(rec.plan_id)}
                disabled={busy}
                className="font-mono text-xs border border-verified text-verified px-3 py-1.5 hover:bg-verified hover:text-paper transition-colors"
              >
                I switched to {productOf(rec.plan_id)}
              </button>
            )
          )}
          {error && <p className="font-mono text-xs text-alert">{error}</p>}
        </div>
      </div>

      {children}

      <section className="mb-10">
        <h3 className="text-sm uppercase tracking-wide text-mute mb-1 border-b border-line pb-2">
          Same seats, every {comparison.category} plan
        </h3>
        <ul>{seatPlans.map(row)}</ul>
      </section>

      {apiPlans.length > 0 && (
        <details className="mb-10 group">
          <summary className="cursor-pointer text-sm uppercase tracking-wide text-mute border-b border-line pb-2 list-none">
            <span className="group-open:hidden">▸</span><span className="hidden group-open:inline">▾</span> Pay-per-token APIs ({apiPlans.length})
            <span className="normal-case tracking-normal"> · needs your own app or API client</span>
          </summary>
          <ul>{apiPlans.map(row)}</ul>
        </details>
      )}

      {footer}

      <p className="text-xs text-mute leading-relaxed">
        Assumptions: {comparison.assumptions.join(" ")} Prices marked "third-party" come from 2026 pricing guides; click to check the vendor's page.
      </p>
    </div>
  );
}

export default ComparisonView;
