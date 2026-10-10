import { useQuery } from "@tanstack/react-query";
import { fetchCatalog } from "./api/client";
import ColdStartBanner from "./ColdStartBanner";
import CompareFlow from "./CompareFlow";

function App() {
  const { data: catalog } = useQuery({ queryKey: ["catalog"], queryFn: fetchCatalog });

  return (
    <div className="min-h-screen px-4 sm:px-8 py-8 sm:py-12 max-w-4xl mx-auto">
      <ColdStartBanner />

      <header className="mb-10 sm:mb-14">
        <p className="font-display text-xl font-semibold tracking-tight mb-8">AI Usage Ledger</p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold leading-tight max-w-2xl mb-4">
          Are you overpaying for AI?
        </h1>
        <p className="text-base text-mute max-w-xl leading-relaxed">
          Upload your ChatGPT, Copilot or Cursor bill, or just tell us your plan. We re-price your team's
          usage on every plan from the top AI vendors and show you the cheapest one. First 2 analyses free.
        </p>
      </header>

      <CompareFlow />

      <footer className="border-t border-line pt-6 mt-16 text-xs text-mute leading-relaxed space-y-1">
        <p>
          Prices{catalog ? ` as of ${catalog.as_of}` : ""} from vendor pricing pages and 2026 pricing guides.
          Check the linked vendor page before you switch.
        </p>
        <p>We keep usage counts and costs only, never prompts or conversations.</p>
      </footer>
    </div>
  );
}

export default App;
