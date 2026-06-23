import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ingestFile } from "./api/client";

const SOURCES = [
  { key: "chatgpt", label: "ChatGPT", accept: ".json" },
  { key: "copilot", label: "GitHub Copilot", accept: ".csv" },
  { key: "cursor", label: "Cursor", accept: ".jsonl" },
];

interface Result {
  source: string;
  status: "ok" | "error";
  message: string;
}

function IngestPanel() {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const validateFile = async (source: string, file: File): Promise<string | null> => {
  const text = await file.text();
  try {
    if (source === "chatgpt") {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed) || !parsed[0]?.id || !parsed[0]?.email || !parsed[0]?.model) {
        return "Doesn't look like a ChatGPT export (expected id/email/model fields)";
      }
    } else if (source === "copilot") {
      const firstLine = text.split("\n")[0];
      if (!firstLine.includes("record_id") || !firstLine.includes("user")) {
        return "Doesn't look like a Copilot CSV export (missing expected columns)";
      }
    } else if (source === "cursor") {
      const firstLine = text.trim().split("\n")[0];
      const parsed = JSON.parse(firstLine);
      if (!parsed.eventId || !parsed.actor) {
        return "Doesn't look like a Cursor JSONL export (missing eventId/actor)";
      }
    }
    return null;
  } catch {
    return "Couldn't parse this file — check it matches the expected format";
  }
};

 const handleUpload = async (source: string, file: File) => {
  const validationError = await validateFile(source, file);
  if (validationError) {
    setResults((prev) => ({
      ...prev,
      [source]: { source, status: "error", message: validationError },
    }));
    return;
  }

  setLoading(source);
  try {
      const data = await ingestFile(source, file);
      const driftNote = data.drift?.status === "DRIFT_DETECTED" ? " — drift detected" : "";
      setResults((prev) => ({
        ...prev,
        [source]: {
          source,
          status: "ok",
          message: `inserted ${data.inserted}, updated ${data.updated}${driftNote}`,
        },
      }));
      // refresh dashboard numbers
      queryClient.invalidateQueries({ queryKey: ["active-users"] });
      queryClient.invalidateQueries({ queryKey: ["cost-by-tool"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    } catch (err: any) {
      setResults((prev) => ({
        ...prev,
        [source]: { source, status: "error", message: err.message ?? "upload failed" },
      }));
    } finally {
      setLoading(null);
    }
  };

  return (
    <section className="mb-12">
      <h2 className="text-sm uppercase tracking-wide text-mute mb-4 border-b border-line pb-2">
        Ingest a file
      </h2>
      <div className="grid grid-cols-3 gap-6">
        {SOURCES.map(({ key, label, accept }) => {
          const result = results[key];
          return (
            <div key={key} className="border border-line p-4">
              <p className="text-sm font-medium mb-1">{label}</p>
              <p className="font-mono text-xs text-mute mb-3">accepts {accept}</p>
              <input
                type="file"
                accept={accept}
                disabled={loading === key}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(key, file);
                }}
                className="text-xs font-mono w-full"
              />
              {loading === key && (
                <p className="font-mono text-xs text-mute mt-2">uploading…</p>
              )}
              {result && (
                <p
                  className="font-mono text-xs mt-2"
                  style={{ color: result.status === "ok" ? "#1F6F54" : "#B33A3A" }}
                >
                  {result.message}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default IngestPanel;