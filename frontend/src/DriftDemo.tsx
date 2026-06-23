import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ingestFile } from "./api/client";

const GOOD_RECORD = [{
  id: "demo_good_001",
  email: "demo@company.com",
  model: "gpt-4o",
  type: "chat_message",
  created: new Date().toISOString(),
  usage: { total_tokens: 500 },
  cost_usd: 0.10,
}];

const BROKEN_RECORD = [{
  id: "demo_broken_001",
  email: "demo@company.com",
  model: "gpt-4o",
  type: "chat_message",
  created: new Date().toISOString(),
  usage: { tokens: 500 }, // renamed field — simulates a vendor UI refresh
  cost_usd: 0.10,
}];

function makeFile(data: unknown, name: string): File {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  return new File([blob], name, { type: "application/json" });
}

function HighlightedJson({ data, highlight }: { data: unknown; highlight: string }) {
  const lines = JSON.stringify(data, null, 2).split("\n");
  return (
    <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
      {lines.map((line, i) => (
        <div
          key={i}
          className="px-1 -mx-1"
          style={
            line.includes(highlight)
              ? { backgroundColor: "rgba(179,58,58,0.1)", color: "#B33A3A" }
              : undefined
          }
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

function DriftDemo() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showPayloads, setShowPayloads] = useState(false);
  const queryClient = useQueryClient();

  const runDemo = async () => {
    setLoading(true);
    setResult(null);
    try {
      await ingestFile("chatgpt", makeFile(GOOD_RECORD, "good.json"));
      const broken = await ingestFile("chatgpt", makeFile(BROKEN_RECORD, "broken.json"));
      setResult(broken.drift);
      setShowPayloads(true);

      queryClient.invalidateQueries({ queryKey: ["active-users"] });
      queryClient.invalidateQueries({ queryKey: ["cost-by-tool"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    } catch {
      setResult({ status: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mb-12 border border-line p-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium">Simulate a vendor breaking</h2>
        <button
          onClick={runDemo}
          disabled={loading}
          className="font-mono text-xs border border-ink px-3 py-1.5 hover:bg-ink hover:text-paper transition-colors disabled:opacity-50"
        >
          {loading ? "running…" : "⚡ run simulation"}
        </button>
      </div>
      <p className="text-xs text-mute mb-3 max-w-xl">
        Sends a ChatGPT-shaped record, then a second one where a vendor silently
        renamed a field — the exact failure mode that quietly zeroes out cost
        dashboards in real systems.
      </p>

      {result && (
        <div
          className="font-mono text-xs p-3 border mb-3"
          style={{
            borderColor: result.status === "DRIFT_DETECTED" ? "#B33A3A" : "#E3E0D8",
            color: result.status === "DRIFT_DETECTED" ? "#B33A3A" : "#8A8578",
          }}
        >
          {result.status === "DRIFT_DETECTED" ? (
            <>
              <p className="mb-1">DRIFT_DETECTED</p>
              <p>missing: {result.missing_keys?.join(", ")}</p>
              <p>new: {result.new_keys?.join(", ") || "none"}</p>
            </>
          ) : (
            <p>status: {result.status}</p>
          )}
        </div>
      )}

      {result?.status === "DRIFT_DETECTED" && (
        <details open={showPayloads} className="border border-line">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-mono text-mute hover:text-ink">
            view the data that was sent
          </summary>
          <div className="grid grid-cols-2 gap-px bg-line border-t border-line">
            <div className="bg-paper p-3">
              <p className="text-xs text-mute mb-2">sent first — baseline</p>
              <HighlightedJson data={GOOD_RECORD[0]} highlight="total_tokens" />
            </div>
            <div className="bg-paper p-3">
              <p className="text-xs text-mute mb-2">sent second — field renamed</p>
              <HighlightedJson data={BROKEN_RECORD[0]} highlight='"tokens"' />
            </div>
          </div>
        </details>
      )}
    </section>
  );
}

export default DriftDemo;