import { useEffect, useState } from "react";
import { checkHealth } from "./api/client";

function ColdStartBanner() {
  const [isAwake, setIsAwake] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let pingInterval: ReturnType<typeof setInterval>;
    let clock: ReturnType<typeof setInterval>;

    const ping = async () => {
      const ok = await checkHealth();
      if (ok) {
        setIsAwake(true);
        clearInterval(pingInterval);
        clearInterval(clock);
      }
    };

    ping();
    pingInterval = setInterval(ping, 2500);
    clock = setInterval(() => setSeconds((s) => s + 1), 1000);

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