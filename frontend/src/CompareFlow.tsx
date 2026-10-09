import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiErrorMessage, fetchBill, fetchBills, fetchTeam, isFreeLimitError, uploadBill, uploadSampleBill,
  type BillResult,
} from "./api/client";
import BillReport from "./BillReport";

const TOOLS = [
  { key: "chatgpt", label: "ChatGPT", format: ".json", accept: ".json", hint: "Usage export from your ChatGPT workspace admin settings" },
  { key: "copilot", label: "GitHub Copilot", format: ".csv", accept: ".csv", hint: "Usage report CSV from your GitHub organization's Copilot settings" },
  { key: "cursor", label: "Cursor", format: ".jsonl", accept: ".jsonl,.json", hint: "Usage events export from your Cursor team dashboard" },
];

type Step = "pick" | "upload" | "report";

function CompareFlow() {
  const [step, setStep] = useState<Step>("pick");
  const [tool, setTool] = useState(TOOLS[0]);
  const [result, setResult] = useState<BillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const { data: quota } = useQuery({ queryKey: ["team"], queryFn: fetchTeam });
  const { data: bills } = useQuery({ queryKey: ["bills"], queryFn: fetchBills });

  const run = async (action: () => Promise<BillResult>) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await action());
      setStep("report");
      queryClient.invalidateQueries({ queryKey: ["team"] });
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      // Bills also land in the shared ledger below
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["cost-by-tool"] });
      queryClient.invalidateQueries({ queryKey: ["active-users"] });
    } catch (err) {
      setLimitHit(isFreeLimitError(err));
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const outOfFree = quota?.remaining === 0;

  return (
    <section className="mb-14">
      <div className="flex items-baseline justify-between border-b border-line pb-2 mb-6">
        <h2 className="text-sm uppercase tracking-wide text-mute">Compare your AI bill</h2>
        {quota && (
          <p className="font-mono text-xs text-mute">
            {quota.plan === "paid" ? "Pro · unlimited" : `${quota.remaining} of ${quota.free_limit} free analyses left`}
          </p>
        )}
      </div>

      {/* Step indicator */}
      <ol className="flex gap-6 font-mono text-xs mb-8">
        {(["pick", "upload", "report"] as Step[]).map((s, i) => (
          <li key={s} className={step === s ? "text-ink" : "text-mute"}>
            {i + 1}. {s === "pick" ? "Pick your tool" : s === "upload" ? "Add your bill" : "See your report"}
          </li>
        ))}
      </ol>

      {step === "pick" && (
        <div className="grid md:grid-cols-3 gap-4">
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
                  if (file) run(() => uploadBill(tool.key, file));
                }}
              />
            </label>
            <button
              onClick={() => run(() => uploadSampleBill(tool.key))}
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

      {step === "report" && result && (
        <div>
          <div className="flex items-baseline justify-between mb-6">
            <p className="font-mono text-xs text-mute">
              {result.bill.filename} · {result.report.period_days} day(s) · {result.bill.event_count} events
            </p>
            <button onClick={() => setStep("pick")} className="font-mono text-xs border border-ink px-3 py-1.5 hover:bg-ink hover:text-paper">
              compare another bill
            </button>
          </div>
          <BillReport result={result} />
        </div>
      )}

      {bills && bills.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-mute mr-2">Your bills</span>
          {bills.map((b) => (
            <button
              key={b.id}
              onClick={() => run(() => fetchBill(b.id))}
              className={`font-mono text-xs border px-2 py-1 hover:border-ink ${result?.bill.id === b.id ? "border-ink" : "border-line"}`}
            >
              {b.source} · {new Date(b.uploaded_at).toLocaleDateString()}{b.is_sample ? " · sample" : ""}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function UpgradeCard() {
  return (
    <div className="mt-6 grid md:grid-cols-2 gap-4">
      <div className="border border-line p-5">
        <p className="font-medium mb-2">Free</p>
        <ul className="text-sm text-mute space-y-1">
          <li>2 bill analyses with full report</li>
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
