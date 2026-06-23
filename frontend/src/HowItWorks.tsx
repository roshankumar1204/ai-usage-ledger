const ITEMS = [
  {
    title: "Canonical event schema",
    summary: "Every vendor's data, no matter how different, converges into one shape.",
    body: "ChatGPT, Copilot, and Cursor each export usage data in a completely different format — nested JSON, flat CSV, JSONL streams. Each has its own parser that converts it into one shared event shape. Adding a new vendor means writing one new parser file — nothing else in the system changes.",
  },
  {
    title: "Deduplication",
    summary: "The same event sent twice doesn't get counted twice.",
    body: "Every event gets a deterministic key (a hash of its source + the vendor's own event ID). If the same event arrives again — which happens constantly with real APIs — it's recognized and skipped instead of inflating the numbers.",
  },
  {
    title: "Late-arriving cost",
    summary: "Cost data often shows up after usage data — handled without duplicating rows.",
    body: "Billing data frequently lags behind usage data by hours or days. Instead of creating a new row when cost finally arrives, the system finds the existing event by its key and patches the cost in place.",
  },
  {
    title: "Drift detection",
    summary: "If a vendor silently changes their data format, you find out immediately.",
    body: "The expected field structure for each vendor is recorded the first time it's seen. Every new batch is checked against that baseline. If a field goes missing or gets renamed — a real, common failure mode — it's flagged explicitly instead of quietly turning into a null or a zero.",
  },
  {
    title: "Proof-based identity resolution",
    summary: "An identifier only links to a person when it can be proven — never guessed.",
    body: "The same human can show up as different identifiers across tools. Instead of fuzzy-matching names or emails, every link between an identifier and a person is recorded with an explicit reason. Anything that can't be proven stays marked unresolved rather than silently merged into the wrong person.",
  },
  {
    title: "One source of truth",
    summary: "Every number on this dashboard is computed in exactly one place.",
    body: "Active users, cost by tool — each is calculated once, in one part of the backend. The dashboard doesn't run its own version of the math, so there's no risk of two screens quietly disagreeing about the same number.",
  },
];

function HowItWorks() {
  return (
    <section className="mb-12">
      <h2 className="text-sm uppercase tracking-wide text-mute mb-4 border-b border-line pb-2">
        How this works
      </h2>
      <div className="divide-y divide-line">
        {ITEMS.map((item) => (
          <details key={item.title} className="group py-3">
            <summary className="cursor-pointer list-none flex items-baseline justify-between">
              <span>
                <span className="text-sm font-medium">{item.title}</span>
                <span className="text-xs text-mute ml-3">{item.summary}</span>
              </span>
              <span className="font-mono text-xs text-mute group-open:rotate-45 transition-transform">
                +
              </span>
            </summary>
            <p className="text-sm text-mute mt-2 max-w-2xl">{item.body}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export default HowItWorks;