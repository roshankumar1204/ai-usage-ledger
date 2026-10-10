import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
});

export interface CostByTool {
  tool: string;
  cost_cents: number;
}

export interface UsageEvent {
  id: number;
  source: string;
  user_email: string;
  tool_name: string;
  event_type: string;
  occurred_at: string;
  cost_cents: number | null;
  tokens: number;
  identity_status: string | null;
}

export const fetchActiveUsers = async (): Promise<number> => {
  const { data } = await api.get("/metrics/active-users");
  return data.active_users_this_week;
};

export const fetchCostByTool = async (): Promise<CostByTool[]> => {
  const { data } = await api.get("/metrics/cost-by-tool");
  return data;
};

export const fetchEvents = async (): Promise<UsageEvent[]> => {
  const { data } = await api.get("/metrics/events");
  return data;
};

export const ingestFile = async (source: string, file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post(`/ingest/${source}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
};

export const checkHealth = async (): Promise<boolean> => {
  try {
    await api.get("/status", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};
// ---------- Bill compare (Phase 1) ----------

// No accounts yet: each browser gets a random team id that scopes its bills and free quota.
// Opening a share link (?team=<id>) joins that team on this device.
const TEAM_KEY = "ai-bill-team-id";
const TEAM_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
let memoryTeamId: string | null = null;

const teamFromUrl = (): string | null => {
  const url = new URL(window.location.href);
  const id = url.searchParams.get("team");
  if (!id || !TEAM_ID_RE.test(id)) return null;
  url.searchParams.delete("team");
  window.history.replaceState(null, "", url.toString());
  return id;
};

const resolveTeamId = (): string => {
  const shared = teamFromUrl();
  try {
    if (shared) localStorage.setItem(TEAM_KEY, shared);
    const saved = localStorage.getItem(TEAM_KEY);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem(TEAM_KEY, fresh);
    return fresh;
  } catch {
    memoryTeamId ??= shared ?? crypto.randomUUID();
    return memoryTeamId;
  }
};

const teamId = resolveTeamId();
export const getTeamId = () => teamId;
export const teamShareLink = () => `${window.location.origin}${window.location.pathname}?team=${teamId}`;

api.interceptors.request.use((config) => {
  config.headers.set("X-Team-Id", teamId);
  return config;
});

export interface TeamQuota {
  plan: "free" | "paid";
  free_limit: number;
  used: number;
  remaining: number | null;
  switches: number;
  monthly_savings_cents: number;
}

export interface Bill {
  id: number;
  source: string;
  filename: string;
  is_sample: boolean;
  event_count: number;
  uploaded_at: string;
}

interface Usage {
  events: number;
  tokens: number;
  cost_cents: number;
}

export interface BillReport {
  empty: boolean;
  period_start: string;
  period_end: string;
  period_days: number;
  events: number;
  seats: number;
  total_cost_cents: number;
  pending_cost_events: number;
  total_tokens: number;
  cost_per_seat_cents: number;
  cost_per_1k_tokens_cents: number | null;
  by_user: (Usage & { user: string })[];
  by_model: (Usage & { model: string; tier: "low" | "high" | null })[];
  underused_seats: string[];
  overlap: Record<string, string[]>;
  findings: string[];
}

export interface PlanOption {
  plan_id: string;
  vendor: string;
  product: string;
  pricing: "seat" | "token";
  tier: "low" | "high";
  monthly_cents: number;
  savings_cents: number;
  is_current_vendor: boolean;
  fit: string;
  confidence: "official" | "third-party";
  official_url: string;
}

export interface Comparison {
  category: string;
  current_monthly_cents: number;
  current_basis: "bill" | "list_price" | "entered";
  monthly_tokens: number;
  seats: number;
  confidence: "low" | "normal";
  reasons: string[];
  assumptions: string[];
  options: PlanOption[];
  recommendation: { plan_id: string | null; headline: string; savings_cents: number; api_tip?: string };
}

export interface SwitchRecord {
  kind: "bill" | "manual";
  ref_id: number;
  plan_id: string;
  from_monthly_cents: number;
  to_monthly_cents: number;
}

export interface BillResult {
  bill: Bill;
  report: BillReport;
  comparison: Comparison | null;
  switch: SwitchRecord | null;
}

export interface ManualCompare {
  id: number;
  plan_id: string;
  seats: number;
  monthly_spend_cents: number | null;
  created_at: string;
}

export interface ManualResult {
  manual: ManualCompare;
  comparison: Comparison;
  switch: SwitchRecord | null;
}

export interface CatalogPlan {
  id: string;
  vendor: string;
  product: string;
  category: "assistant" | "coding";
  pricing: "seat" | "token";
  tier: "low" | "high";
  monthly_cents?: number;
}

export const fetchCatalog = async (): Promise<{ as_of: string; plans: CatalogPlan[] }> => {
  const { data } = await api.get("/pricing/catalog");
  return data;
};

export const createManualCompare = async (
  body: { plan_id: string; seats: number; monthly_spend_cents?: number },
): Promise<ManualResult> => {
  const { data } = await api.post("/compare/manual", body);
  return data;
};

export const fetchManualCompares = async (): Promise<ManualCompare[]> => {
  const { data } = await api.get("/compare/manual");
  return data;
};

export const fetchManualCompare = async (id: number): Promise<ManualResult> => {
  const { data } = await api.get(`/compare/manual/${id}`);
  return data;
};

export const recordSwitch = async (kind: "bill" | "manual", refId: number, planId: string) => {
  const { data } = await api.post("/switches", { kind, ref_id: refId, plan_id: planId });
  return data;
};

export const undoSwitch = async (kind: "bill" | "manual", refId: number) => {
  const { data } = await api.delete(`/switches/${kind}/${refId}`);
  return data;
};

export const fetchTeam = async (): Promise<TeamQuota> => {
  const { data } = await api.get("/team");
  return data;
};

export const fetchBills = async (): Promise<Bill[]> => {
  const { data } = await api.get("/bills");
  return data;
};

export const fetchBill = async (id: number): Promise<BillResult> => {
  const { data } = await api.get(`/bills/${id}`);
  return data;
};

export const uploadBill = async (source: string, file: File): Promise<BillResult> => {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post(`/bills/${source}`, formData);
  return data;
};

export const uploadSampleBill = async (source: string): Promise<BillResult> => {
  const { data } = await api.post(`/bills/${source}/sample`, null);
  return data;
};

// FastAPI puts errors in `detail`, either a string or {code, message}
export const apiErrorMessage = (err: unknown): string => {
  const detail = axios.isAxiosError(err) ? err.response?.data?.detail : undefined;
  if (typeof detail === "string") return detail;
  if (detail?.message) return detail.message;
  return err instanceof Error ? err.message : "Something went wrong";
};

export const isFreeLimitError = (err: unknown): boolean =>
  axios.isAxiosError(err) && err.response?.status === 402;
