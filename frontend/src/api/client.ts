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

// No accounts yet: each browser gets a random team id that scopes its bills and free quota
const TEAM_KEY = "ai-bill-team-id";
let memoryTeamId: string | null = null;
export const getTeamId = (): string => {
  try {
    const saved = localStorage.getItem(TEAM_KEY);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem(TEAM_KEY, fresh);
    return fresh;
  } catch {
    memoryTeamId ??= crypto.randomUUID();
    return memoryTeamId;
  }
};

const teamHeaders = () => ({ "X-Team-Id": getTeamId() });

export interface TeamQuota {
  plan: "free" | "paid";
  free_limit: number;
  used: number;
  remaining: number | null;
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
  current_basis: "bill" | "list_price";
  monthly_tokens: number;
  seats: number;
  confidence: "low" | "normal";
  reasons: string[];
  assumptions: string[];
  options: PlanOption[];
  recommendation: { plan_id: string | null; headline: string; savings_cents: number; api_tip?: string };
}

export interface BillResult {
  bill: Bill;
  report: BillReport;
  comparison: Comparison | null;
}

export const fetchTeam = async (): Promise<TeamQuota> => {
  const { data } = await api.get("/team", { headers: teamHeaders() });
  return data;
};

export const fetchBills = async (): Promise<Bill[]> => {
  const { data } = await api.get("/bills", { headers: teamHeaders() });
  return data;
};

export const fetchBill = async (id: number): Promise<BillResult> => {
  const { data } = await api.get(`/bills/${id}`, { headers: teamHeaders() });
  return data;
};

export const uploadBill = async (source: string, file: File): Promise<BillResult> => {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post(`/bills/${source}`, formData, { headers: teamHeaders() });
  return data;
};

export const uploadSampleBill = async (source: string): Promise<BillResult> => {
  const { data } = await api.post(`/bills/${source}/sample`, null, { headers: teamHeaders() });
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
