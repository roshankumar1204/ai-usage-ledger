import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchActiveUsers, fetchCostByTool, fetchEvents } from "./api/client";
import IngestPanel from "./IngestPanel";
import ColdStartBanner from "./ColdStartBanner";

function App() {
  const { data: activeUsers, isLoading: usersLoading } = useQuery({
    queryKey: ["active-users"],
    queryFn: fetchActiveUsers,
  });

  const { data: costByTool, isLoading: costLoading } = useQuery({
    queryKey: ["cost-by-tool"],
    queryFn: fetchCostByTool,
  });

  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["events"],
    queryFn: fetchEvents,
  });

  const chartData = costByTool?.map((c) => ({
    tool: c.tool,
    cost: c.cost_cents / 100,
  }));

  const vendorCount = costByTool ? new Set(costByTool.map((c) => c.tool)).size : 0;

  return (
    <div className="min-h-screen px-10 py-12 max-w-5xl mx-auto">
      {/* Masthead */}
      <ColdStartBanner />
      <header className="flex items-baseline justify-between border-b border-line pb-6 mb-10">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            AI Usage Ledger
          </h1>
          <p className="font-mono text-xs text-mute mt-1">
            reconciled across {vendorCount} source{vendorCount !== 1 ? "s" : ""}
          </p>
        </div>
        <p className="font-mono text-xs text-mute">
          {new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </p>
      </header>

      <section className="mb-12 pb-8 border-b border-line">
        <h2 className="font-display text-xl font-semibold mb-2 max-w-2xl">
          One trustworthy number for what your org actually spends on AI.
        </h2>
        <p className="text-sm text-mute max-w-xl">
          A working pipeline that ingests usage data from multiple AI tools, removes
          duplicates, catches it when a vendor silently changes their data format, and
          resolves identities only when it can prove them.
        </p>
      </section>

      <IngestPanel />

      {/* Stat strip — hairline-divided, not cards */}
      <div className="grid grid-cols-3 mb-12">
        <div className="pr-8">
          <p className="text-xs uppercase tracking-wide text-mute mb-1">Active users</p>
          <p className="font-mono text-3xl">{usersLoading ? "—" : activeUsers}</p>
        </div>
        <div className="px-8 border-l border-line">
          <p className="text-xs uppercase tracking-wide text-mute mb-1">Events recorded</p>
          <p className="font-mono text-3xl">{eventsLoading ? "—" : events?.length}</p>
        </div>
        <div className="pl-8 border-l border-line">
          <p className="text-xs uppercase tracking-wide text-mute mb-1">Sources connected</p>
          <p className="font-mono text-3xl">{vendorCount || "—"}</p>
        </div>
      </div>

      {/* Cost chart */}
      <section className="mb-12">
        <h2 className="text-sm uppercase tracking-wide text-mute mb-4 border-b border-line pb-2">
          Cost by tool
        </h2>
        {costLoading ? (
          <p className="font-mono text-sm text-mute">loading…</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="2 4" stroke="#E3E0D8" vertical={false} />
              <XAxis dataKey="tool" tick={{ fontFamily: "JetBrains Mono", fontSize: 12, fill: "#8A8578" }} axisLine={{ stroke: "#E3E0D8" }} tickLine={false} />
              <YAxis tick={{ fontFamily: "JetBrains Mono", fontSize: 12, fill: "#8A8578" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontFamily: "JetBrains Mono", fontSize: 12, border: "1px solid #E3E0D8", borderRadius: 0 }}
                formatter={(v) => [`$${Number(v).toFixed(2)}`, "cost"]}
              />
              <Bar dataKey="cost" fill="#14171A" radius={0} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Ledger table */}
      <section>
        <h2 className="text-sm uppercase tracking-wide text-mute mb-4 border-b border-line pb-2">
          Ledger
        </h2>
        {eventsLoading ? (
          <p className="font-mono text-sm text-mute">loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-mute border-b border-line">
                <th className="py-2 font-normal">User</th>
                <th className="font-normal">Tool</th>
                <th className="font-normal">Source</th>
                <th className="font-normal text-right">Cost</th>
                <th className="font-normal">Identity</th>
                <th className="font-normal text-right">Recorded</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {events?.map((e) => (
                <tr key={e.id} className="border-b border-line/60 hover:bg-black/[0.02]">
                  <td className="py-3">{e.user_email}</td>
                  <td>{e.tool_name}</td>
                  <td>
                    <span className="text-mute">{e.source}</span>
                  </td>
                  <td className="text-right">
                    {e.cost_cents !== null ? (
                      `$${(e.cost_cents / 100).toFixed(2)}`
                    ) : (
                      <span className="text-pending">pending</span>
                    )}
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: e.identity_status === "resolved" ? "#1F6F54" : "#B8860B" }}
                      />
                      <span style={{ color: e.identity_status === "resolved" ? "#1F6F54" : "#B8860B" }}>
                        {e.identity_status === "resolved" ? "PROVEN" : "UNRESOLVED"}
                      </span>
                    </span>
                  </td>
                  <td className="text-right text-mute">
                    {new Date(e.occurred_at).toLocaleString(undefined, {
                      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default App;