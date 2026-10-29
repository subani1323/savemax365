import { progressReportDateForInput } from "./progressReportUtils";

/** Build API payload for one edited report row vs its baseline. */
export function buildProgressReportSavePayload(row, baseline, trade) {
  if (!trade?._id) return null;
  const base = baseline || {};
  const ptFields = ["notes", "tradeCategory", "complianceStatus"];
  const progressTrackerPatch = {};

  for (const field of ptFields) {
    const a = String(row[field] ?? "").trim();
    const b = String(base[field] ?? "").trim();
    if (a !== b) progressTrackerPatch[field] = row[field] ?? "";
  }

  const dateFields = ["followUpDate", "action"];
  for (const field of dateFields) {
    const a = progressReportDateForInput(row[field]);
    const b = progressReportDateForInput(base[field]);
    if (a !== b) progressTrackerPatch[field] = a || "";
  }

  if (!Object.keys(progressTrackerPatch).length) return null;
  return { progressTracker: progressTrackerPatch };
}

export function getDirtyProgressReportRows(rows, baselineRows) {
  const baselineByKey = new Map(
    (baselineRows || []).map((r) => [r.rowKey, r]),
  );
  return (rows || []).filter((row) => {
    const base = baselineByKey.get(row.rowKey);
    if (!base) return true;
    return PROGRESS_REPORT_ROW_KEYS.some(
      (k) => String(row[k] ?? "").trim() !== String(base[k] ?? "").trim(),
    );
  });
}

const PROGRESS_REPORT_ROW_KEYS = [
  "action",
  "followUpDate",
  "notes",
  "tradeCategory",
  "complianceStatus",
];

function isValidTradeObjectId(id) {
  return /^[a-f0-9]{24}$/i.test(String(id || "").trim());
}

function resolveTradeForRow(row, trades) {
  const tradeId = String(row.tradeId || "").trim();
  if (isValidTradeObjectId(tradeId)) {
    return (trades || []).find((t) => String(t._id) === tradeId) || null;
  }

  const rowKey = String(row.rowKey || "").trim();
  if (isValidTradeObjectId(rowKey)) {
    return (trades || []).find((t) => String(t._id) === rowKey) || null;
  }

  const tradeNumber = String(row.tradeNumber || rowKey || "").trim();
  if (!tradeNumber) return null;

  return (
    (trades || []).find(
      (t) =>
        String(t.tradeNumber ?? t.keyInfo?.tradeNumber ?? "").trim() ===
        tradeNumber,
    ) || null
  );
}

async function persistProgressReportPayload(tradeId, payload, axiosInstance) {
  try {
    const res = await axiosInstance.patch(
      `/trades/${tradeId}/progress-report`,
      payload,
    );
    return res.data;
  } catch (err) {
    if (err?.response?.status !== 404) throw err;
    const res = await axiosInstance.put(`/trades/${tradeId}`, payload);
    return res.data;
  }
}

/** Merge API-saved trades back into an enriched trade list (keeps EFT date fields). */
export function mergeSavedTradesIntoList(existingTrades, savedTrades) {
  if (!savedTrades?.length) return existingTrades || [];
  const savedById = new Map(
    savedTrades
      .filter((t) => t?._id != null)
      .map((t) => [String(t._id), t]),
  );
  return (existingTrades || []).map((trade) => {
    const saved = savedById.get(String(trade._id));
    if (!saved) return trade;
    return {
      ...trade,
      ...saved,
      progressTracker: saved.progressTracker ?? trade.progressTracker,
      paymentReceivedEftDateIso: trade.paymentReceivedEftDateIso,
      paymentToAgentsEftDateIso: trade.paymentToAgentsEftDateIso,
      outsideBrokerPayEftDateIso: trade.outsideBrokerPayEftDateIso,
    };
  });
}

/** Persist all dirty rows; returns count of rows actually written. */
export async function saveProgressReportRows(
  rows,
  baselineRows,
  trades,
  axiosInstance,
) {
  const baselineByKey = new Map(
    (baselineRows || []).map((r) => [r.rowKey, r]),
  );
  const dirty = getDirtyProgressReportRows(rows, baselineRows);
  let savedCount = 0;
  let skippedInvalid = 0;
  const savedTrades = [];

  for (const row of dirty) {
    const trade = resolveTradeForRow(row, trades);
    const tradeId = trade?._id != null ? String(trade._id).trim() : "";
    if (!isValidTradeObjectId(tradeId)) {
      skippedInvalid += 1;
      continue;
    }
    const baseline = baselineByKey.get(row.rowKey);
    const payload = buildProgressReportSavePayload(row, baseline, trade);
    if (!payload) continue;

    const savedTrade = await persistProgressReportPayload(
      tradeId,
      payload,
      axiosInstance,
    );
    if (savedTrade) savedTrades.push(savedTrade);
    savedCount += 1;
  }

  return { dirtyCount: dirty.length, savedCount, skippedInvalid, savedTrades };
}
