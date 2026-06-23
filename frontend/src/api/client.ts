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
    await api.get("/health", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};