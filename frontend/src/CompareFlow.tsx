import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiErrorMessage, createManualCompare, fetchBill, fetchBills, fetchCatalog, fetchManualCompare, fetchManualCompares,
  fetchTeam, isFreeLimitError, teamShareLink, uploadBill, uploadSampleBill,
  type BillResult, type ManualResult,
} from "./api/client";
import BillReport, { Stat } from "./BillReport";
import ComparisonView from "./ComparisonView";
import { money } from "./format";

const TOOLS = [
  { key: "chatgpt", label: "ChatGPT", format: ".json", accept: ".json", hint: "Usage export from your ChatGPT workspace admin settings" },
  { key: "copilot", label: "GitHub Copilot", format: ".csv", accept: ".csv", hint: "Usage report CSV from your GitHub organization's Copilot settings" },
  { key: "cursor", label: "Cursor", format: ".jsonl", accept: ".jsonl,.json", hint: "Usage events export from your Cursor team dashboard" },
];

type Step = "pick" | "upload" | "manual" | "report";
const STEP_NUMBER: Record<Step, number> = { pick: 1, upload: 2, manual: 2, report: 3 };
const STEP_LABEL: Record<Step, string> = {
  pick: "Which AI tool is this bill for?",
  upload: "Add your bill",
  manual: "Tell us your plan",
  report: "Your report",
};
type Result = { kind: "bill"; data: BillResult } | { kind: "manual"; data: ManualResult };

function CompareFlow() {
  const [step, setStep] = useState<Step>("pick");
  const [tool, setTool] = useState(TOOLS[0]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data: quota } = useQuery({ queryKey: ["team"], queryFn: fetchTeam });
  const { data: bills } = useQuery({ queryKey: ["bills"], queryFn: fetchBills });
  const { data: manuals } = useQuery({ queryKey: ["manual-compares"], queryFn: fetchManualCompares });
  const { data: catalog } = useQuery({ queryKey: ["catalog"], queryFn: fetchCatalog });

  const run = async (action: () => Promise<Result>) => {
    setBusy(true);
    setError(null);
    setLimitHit(false);
    try {
      setResult(await action());
      setStep("report");
      for (const key of ["team", "bills", "manual-compares"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    } catch (err) {
      setLimitHit(isFreeLimitError(err));
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const runBill = (action: () => Promise<BillResult>) => run(async () => ({ kind: "bill", data: await action() }));
  const runManual = (action: () => Promise<ManualResult>) => run(async () => ({ kind: "manual", data: await action() }));

  const share = async () => {
    try {
      await navigator.clipboard.writeText(teamShareLink());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy your team link:", teamShareLink());
    }
  };

  const outOfFree = quota?.remaining === 0;
  const planName = (id: string) => catalog?.plans.find((p) => p.id === id)?.product ?? id;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-3 mb-6">
        <p className="font-mono text-xs">
          <span className="text-mute">Step {STEP_NUMBER[step]} of 3 ·</span> {STEP_LABEL[step]}
        </p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs text-mute">
          {quota && quota.switches > 0 && (
            <span className="text-verified">saving {money(quota.monthly_savings_cents)}/mo</span>
          )}
          {quota && <span>{quota.plan === "paid" ? "Pro · unlimited" : `${quota.remaining}/${quota.free_limit} free left`}</span>}
          <button onClick={share} className="underline hover:text-ink" title="Anyone with this link can see your team's bills">
            {copied ? "link copied ✓" : "share with team"}
          </button>
        </div>
      </div>

      {step === "pick" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTool(t); setStep("upload"); setError(null); }}
              className="text-left border border-line p-5 hover:border-ink transition-colors"
            >
              <p className="font-medium mb-1">{t.label}</p>
              <p className="font-mono text-xs text-mute">{t.format} export</p>
            </button>
          ))}
          <button
            onClick={() => { setStep("manual"); setError(null); }}
            className="text-left border border-dashed border-ink/40 p-5 hover:border-ink transition-colors"
          >
            <p className="font-medium mb-1">No export?</p>
            <p className="font-mono text-xs text-mute">just tell us your plan</p>
          </button>
        </div>
      )}

      {step === "upload" && (
        <div className="border border-line p-6">
          <p className="font-medium mb-1">{tool.label} bill</p>
          <p className="text-sm text-mute mb-5">{tool.hint} ({tool.format}). We keep usage counts and costs only.</p>

          <div className="flex flex-wrap items-center gap-4">
            <label className={outOfFree ? "opacity-40 pointer-events-none" : ""}>
              <span className="inline-block font-mono text-xs border border-ink bg-ink text-paper px-4 py-2 cursor-pointer hover:opacity-90">
                {busy ? "analyzing…" : "upload bill"}
              </span>
              <input
                type="file"
                accept={tool.accept}
                disabled={busy || outOfFree}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) runBill(() => uploadBill(tool.key, file));
                }}
              />
            </label>
            <button
              onClick={() => runBill(() => uploadSampleBill(tool.key))}
              disabled={busy}
              className="font-mono text-xs border border-ink px-4 py-2 hover:bg-ink hover:text-paper transition-colors"
            >
              try a sample bill (free)
            </button>
            <button onClick={() => setStep("pick")} className="font-mono text-xs text-mute underline">
              back
            </button>
          </div>

          {error && <p className="font-mono text-xs mt-4 text-alert">{error}</p>}
          {(limitHit || outOfFree) && <UpgradeCard />}
        </div>
      )}

      {step === "manual" && (
        <ManualForm
          plans={catalog?.plans.filter((p) => p.pricing === "seat") ?? []}
          busy={busy}
          disabled={outOfFree}
          error={error}
          showUpgrade={limitHit || outOfFree}
          onBack={() => setStep("pick")}
          onSubmit={(body) => runManual(() => createManualCompare(body))}
        />
      )}

      {step === "report" && result && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <p className="font-mono text-xs text-mute break-words min-w-0">
              {result.kind === "bill"
                ? `${result.data.bill.filename} · ${result.data.report.period_days} day(s) · ${result.data.bill.event_count} events`
                : `${planName(result.data.manual.plan_id)} · ${result.data.manual.seats} seats`}
            </p>
            <button onClick={() => setStep("pick")} className="font-mono text-xs border border-ink px-3 py-1.5 hover:bg-ink hover:text-paper">
              compare another bill
            </button>
          </div>
          {result.kind === "bill" ? (
            <BillReport key={`bill-${result.data.bill.id}`} result={result.data} />
          ) : (
            <ComparisonView
              key={`manual-${result.data.manual.id}`}
              comparison={result.data.comparison}
              kind="manual"
              refId={result.data.manual.id}
              switchRecord={result.data.switch}
            >
              <div className="grid grid-cols-2 md:grid-cols-4 mb-10 gap-y-6">
                <Stat label="Spend / month" value={money(result.data.comparison.current_monthly_cents)}
                  note={result.data.comparison.current_basis === "entered" ? "as you entered it" : "estimated from list price"} />
                <Stat label="Seats" value={String(result.data.manual.seats)} note={planName(result.data.manual.plan_id)} />
              </div>
            </ComparisonView>
          )}
        </div>
      )}

      {((bills?.length ?? 0) > 0 || (manuals?.length ?? 0) > 0) && (
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-mute mr-2">Your analyses</span>
          {bills?.map((b) => (
            <button
              key={`b${b.id}`}
              onClick={() => runBill(() => fetchBill(b.id))}
              className={`font-mono text-xs border px-2 py-1 hover:border-ink ${result?.kind === "bill" && result.data.bill.id === b.id ? "border-ink" : "border-line"}`}
            >
              {b.source} · {new Date(b.uploaded_at).toLocaleDateString()}{b.is_sample ? " · sample" : ""}
            </button>
          ))}
          {manuals?.map((m) => (
            <button
              key={`m${m.id}`}
              onClick={() => runManual(() => fetchManualCompare(m.id))}
              className={`font-mono text-xs border px-2 py-1 hover:border-ink ${result?.kind === "manual" && result.data.manual.id === m.id ? "border-ink" : "border-line"}`}
            >
              {planName(m.plan_id)} · {m.seats} seats
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

interface ManualFormProps {
  plans: { id: string; vendor: string; product: string; monthly_cents?: number }[];
  busy: boolean;
  disabled: boolean;
  error: string | null;
  showUpgrade: boolean;
  onBack: () => void;
  onSubmit: (body: { plan_id: string; seats: number; monthly_spend_cents?: number }) => void;
}

function ManualForm({ plans, busy, disabled, error, showUpgrade, onBack, onSubmit }: ManualFormProps) {
  const [planId, setPlanId] = useState("");
  const [seats, setSeats] = useState("5");
  const [spend, setSpend] = useState("");
  const vendors = [...new Set(plans.map((p) => p.vendor))];
  const seatCount = Number(seats);
  const valid = planId !== "" && Number.isInteger(seatCount) && seatCount >= 1 && (spend === "" || Number(spend) >= 0);

  return (
    <form
      className="border border-line p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({
          plan_id: planId,
          seats: seatCount,
          ...(spend !== "" ? { monthly_spend_cents: Math.round(Number(spend) * 100) } : {}),
        });
      }}
    >
      <p className="font-medium mb-1">Tell us what you pay for</p>
      <p className="text-sm text-mute mb-5">No file needed. We'll price the same seats on every comparable plan.</p>

      <div className="grid md:grid-cols-3 gap-4 mb-5">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-mute">Current plan</span>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}
            className="mt-1 w-full border border-line bg-paper px-2 py-2 text-sm outline-none focus:border-ink">
            <option value="">Choose a plan…</option>
            {vendors.map((v) => (
              <optgroup key={v} label={v}>
                {plans.filter((p) => p.vendor === v).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.product}{p.monthly_cents !== undefined ? ` (${money(p.monthly_cents)}/seat)` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-mute">Seats</span>
          <input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)}
            className="mt-1 w-full border border-line bg-paper px-2 py-2 text-sm font-mono outline-none focus:border-ink" />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-mute">What you pay / month ($, optional)</span>
          <input type="number" min={0} step="0.01" value={spend} placeholder="list price" onChange={(e) => setSpend(e.target.value)}
            className="mt-1 w-full border border-line bg-paper px-2 py-2 text-sm font-mono outline-none focus:border-ink" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy || disabled || !valid}
          className="font-mono text-xs border border-ink bg-ink text-paper px-4 py-2 hover:opacity-90 disabled:opacity-40">
          {busy ? "comparing…" : "compare plans"}
        </button>
        <button type="button" onClick={onBack} className="font-mono text-xs text-mute underline">back</button>
      </div>

      {error && <p className="font-mono text-xs mt-4 text-alert">{error}</p>}
      {showUpgrade && <UpgradeCard />}
    </form>
  );
}

function UpgradeCard() {
  return (
    <div className="mt-6 grid md:grid-cols-2 gap-4">
      <div className="border border-line p-5">
        <p className="font-medium mb-2">Free</p>
        <ul className="text-sm text-mute space-y-1">
          <li>2 analyses with full report</li>
          <li>Compare against top 5 AI vendors</li>
          <li>Unlimited sample bills</li>
        </ul>
      </div>
      <div className="border border-ink p-5">
        <p className="font-medium mb-2">Pro <span className="font-mono text-xs text-mute ml-1">coming soon</span></p>
        <ul className="text-sm space-y-1">
          <li>Unlimited bill compares</li>
          <li>Monthly monitoring of every bill</li>
          <li>Price-change research and switch recommendations</li>
        </ul>
      </div>
    </div>
  );
}

export default CompareFlow;
