import { useEffect, useState } from "react";
import { checkHealth } from "./api/client";

function ColdStartBanner() {
  const [isAwake, setIsAwake] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const ping = async () => {
      const ok = await checkHealth();
      if (ok) {
        setIsAwake(true);
        clearInterval(pingInterval);
        clearInterval(clock);
      }
    };

    const pingInterval = setInterval(ping, 2500);
    const clock = setInterval(() => setSeconds((s) => s + 1), 1000);
    ping();

    return () => {
      clearInterval(pingInterval);
      clearInterval(clock);
    };
  }, []);

  if (isAwake) return null;

  return (
    <div className="border border-pending bg-pending/5 text-pending font-mono text-xs px-4 py-3 mb-8">
      Waking up the backend (free-tier cold start) — {seconds}s elapsed, usually ready within ~15-30s…
    </div>
  );
}

export default ColdStartBanner;