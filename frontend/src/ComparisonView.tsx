import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage, recordSwitch, undoSwitch, type Comparison, type SwitchRecord } from "./api/client";
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
                <th className="font-normal" />
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {comparison.options.map((o) => (
                <tr
                  key={o.plan_id}
                  className="border-b border-line/60"
                  style={o.plan_id === rec.plan_id ? { background: "rgba(31,111,84,0.08)" } : undefined}
                >
                  <td className="py-3 font-sans text-sm">
                    {o.product}
                    {o.plan_id === rec.plan_id && <span className="ml-2 font-mono text-xs text-verified">BEST</span>}
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
                  <td className="text-right pl-3">
                    {switched?.plan_id === o.plan_id ? (
                      <span className="text-verified">switched ✓</span>
                    ) : (
                      <button onClick={() => change(o.plan_id)} disabled={busy} className="text-mute underline hover:text-ink">
                        I switched
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {footer}

      <p className="text-xs text-mute leading-relaxed">
        Assumptions: {comparison.assumptions.join(" ")} Prices marked "third-party" come from 2026 pricing guides; click to check the vendor's page.
      </p>
    </div>
  );
}

export default ComparisonView;
