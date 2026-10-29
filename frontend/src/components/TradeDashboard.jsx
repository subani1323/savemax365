import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import Navbar from "./Navbar";
import axiosInstance from "../config/axios";
import {
  PROGRESS_TRACKER_FIELDS,
  findProgressFieldByQuery,
  orderedBuckets,
} from "../constants/progressTrackerFields";
import { toCalendarIsoDay } from "../utils/tradeDashboardDates";

function rawProgressDate(trade, key) {
  const asDayString = (v) => {
    if (v === undefined || v === null) return "";
    if (v instanceof Date) {
      return toCalendarIsoDay(v) || "";
    }
    const t = String(v).trim();
    return t;
  };
  const pt = trade.progressTracker?.[key];
  const ptStr = asDayString(pt);
  if (ptStr) return ptStr;
  const k = trade.keyInfo?.[key];
  const kStr = asDayString(k);
  if (kStr) return kStr;
  return "";
}

function eftLatestIsoFromTrade(trade) {
  const list = [
    ...(trade.realEstateTrustEFTs || []),
    ...(trade.commissionTrustEFTs || []),
  ];
  let max = null;
  for (const e of list) {
    const raw = e?.date ?? e?.chequeDate;
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (!Number.isNaN(t) && (max === null || t > max)) max = t;
  }
  if (max != null) {
    const d = new Date(max);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${day}`;
  }
  // From GET /trades: server fills this when EFTs exist by tradeId but arrays on Trade are empty
  const serverIso = trade.eftsLatestDateIso;
  if (serverIso && String(serverIso).trim()) {
    const normalized = toCalendarIsoDay(String(serverIso).trim());
    if (normalized) return normalized;
  }
  return "";
}

/** Raw YYYY-MM-DD (or stored string) for dashboard date grouping */
function rawDateValue(trade, field) {
  if (field.source === "computedEft") {
    return eftLatestIsoFromTrade(trade);
  }
  return rawProgressDate(trade, field.key);
}

function formatDateHeading(isoYmd) {
  const parts = isoYmd.split("-");
  if (parts.length !== 3) return isoYmd;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const dt = new Date(y, m, d);
  if (Number.isNaN(dt.getTime())) return isoYmd;
  return dt.toLocaleDateString();
}

/** Compliance checklist: one card per stored option (Progress Tracker values). */
function bucketCompliance(raw) {
  const s =
    raw === undefined || raw === null ? "" : String(raw).trim();
  if (s === "Complete") return "Complete";
  if (s === "Outstanding") return "Outstanding";
  return "No";
}

/** Bucket label for two-column Yes/No views: only Yes / No (blank → No). */
function bucketYesNo(field, raw) {
  const s =
    raw === undefined || raw === null ? "" : String(raw).trim();
  if (s === "") return "No";
  if (s === "Yes") return "Yes";
  if (s === "No") return "No";
  return "No";
}

/** Right column: formatted date or raw checklist value */
function formatCellValue(field, trade) {
  if (field.kind === "date") {
    const raw = rawDateValue(trade, field);
    if (!raw) return "—";
    const iso = toCalendarIsoDay(raw);
    if (iso) return formatDateHeading(iso);
    return raw;
  }
  if (field.kind === "compliance") {
    return bucketCompliance(trade.progressTracker?.[field.key]);
  }
  if (field.kind === "yesNo" || field.kind === "yesNoUnset") {
    return bucketYesNo(field, trade.progressTracker?.[field.key]);
  }
  const raw = trade.progressTracker?.[field.key];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return "—";
  }
  return String(raw).trim();
}

function tradeLine(t) {
  const tn = t.tradeNumber ?? t.keyInfo?.tradeNumber ?? "";
  const sn = t.keyInfo?.streetNumber || "";
  const st = t.keyInfo?.streetName || "";
  const addr = [sn, st].filter(Boolean).join(" ");
  return { tn, addr: addr || "—" };
}

function bucketForTrade(field, trade) {
  if (field.kind === "date") {
    const raw = rawDateValue(trade, field);
    if (!raw) return "(No date)";
    const iso = toCalendarIsoDay(raw);
    return iso || "(No date)";
  }
  const raw = trade.progressTracker?.[field.key];
  if (field.kind === "compliance") {
    return bucketCompliance(raw);
  }
  if (field.kind === "enum") {
    if (!raw || String(raw).trim() === "") return "(Not set)";
    return String(raw).trim();
  }
  if (field.kind === "yesNo" || field.kind === "yesNoUnset") {
    return bucketYesNo(field, raw);
  }
  return "(Not set)";
}

const TradeDashboard = () => {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  const loadTrades = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axiosInstance.get("/trades");
      setTrades(res.data || []);
    } catch (e) {
      console.error(e);
      setError("Could not load trades.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);

  const matchedField = useMemo(
    () => findProgressFieldByQuery(search),
    [search],
  );

  const { columns, rowsByColumn } = useMemo(() => {
    if (!matchedField) {
      return { columns: [], rowsByColumn: {} };
    }
    const field = matchedField;
    const buckets = {};
    for (const t of trades) {
      const b = bucketForTrade(field, t);
      if (!buckets[b]) buckets[b] = [];
      buckets[b].push(t);
    }
    const keys = Object.keys(buckets);
    if (field.kind === "date") {
      return {
        columns: orderedBuckets(field, keys),
        rowsByColumn: buckets,
      };
    }
    if (field.kind === "compliance") {
      const order = field.order || ["No", "Outstanding", "Complete"];
      for (const c of order) {
        if (!buckets[c]) buckets[c] = [];
      }
      return { columns: order, rowsByColumn: buckets };
    }
    if (field.kind === "enum") {
      return {
        columns: orderedBuckets(field, keys),
        rowsByColumn: buckets,
      };
    }
    const yesNoOrder = ["Yes", "No"];
    const ordered = yesNoOrder.filter((c) => buckets[c]);
    const extra = keys.filter((k) => !yesNoOrder.includes(k)).sort();
    return {
      columns: [...ordered, ...extra],
      rowsByColumn: buckets,
    };
  }, [matchedField, trades]);

  const columnHeading = (col) => {
    if (col === "(No date)") return col;
    if (/^\d{4}-\d{2}-\d{2}$/.test(col)) return formatDateHeading(col);
    return col;
  };

  const showValueColumn = Boolean(
    matchedField && matchedField.kind === "date",
  );

  return (
    <div className="bg-gray-50 min-h-screen">
      <Navbar />
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <Link
            to="/"
            className="text-sm font-medium text-blue-900 hover:underline"
          >
            ← Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">Trade dashboard</h1>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <label
            htmlFor="trade-dashboard-search"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Search by progress condition or date field
          </label>
          <input
            id="trade-dashboard-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. Compliance complete, Deal finalized, EFTs issued, File complete…"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700"
          />
          <p className="mt-2 text-xs text-gray-500">
            Checklist fields use one card per option (e.g.{" "}
            <strong className="font-semibold">Compliance complete</strong>: No,
            Outstanding, Complete). Yes/No fields use{" "}
            <strong className="font-semibold">Yes</strong> and{" "}
            <strong className="font-semibold">No</strong> (empty counts as No).
            Only <strong className="font-semibold">date</strong> fields show a
            second column with the date; other groups list trade # and address
            only. Date fields use one card per calendar day.
          </p>
          {matchedField && (
            <p className="mt-2 text-sm text-blue-900">
              Showing: <strong>{matchedField.label}</strong>
            </p>
          )}
          {search.trim() && !matchedField && (
            <p className="mt-2 text-sm text-amber-800">
              No matching field — try another phrase from the list below.
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            Fields you can search
          </h2>
          <ul className="text-xs text-gray-600 columns-1 sm:columns-2 gap-x-8 list-disc list-inside">
            {PROGRESS_TRACKER_FIELDS.map((f) => (
              <li key={f.key}>{f.label}</li>
            ))}
          </ul>
        </div>

        {error && (
          <div className="bg-red-50 text-red-800 rounded-md p-4 mb-4">
            {error}
          </div>
        )}

        {loading && (
          <p className="text-gray-600">Loading trades…</p>
        )}

        {!loading && matchedField && (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
            {columns.map((col) => (
              <div
                key={col}
                className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden min-w-0"
              >
                <div className="bg-blue-900 text-white px-3 py-2 text-sm font-semibold">
                  {columnHeading(col)}
                  <span className="font-normal opacity-90">
                    {" "}
                    ({(rowsByColumn[col] || []).length})
                  </span>
                </div>
                <div
                  className={
                    showValueColumn
                      ? "grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 bg-gray-100 border-b border-gray-200 text-xs font-semibold text-gray-600"
                      : "px-3 py-2 bg-gray-100 border-b border-gray-200 text-xs font-semibold text-gray-600"
                  }
                >
                  <span>Trade # / address</span>
                  {showValueColumn && (
                    <span className="text-right whitespace-nowrap">Date</span>
                  )}
                </div>
                <ul className="max-h-[420px] overflow-y-auto divide-y divide-gray-100">
                  {(rowsByColumn[col] || []).length === 0 ? (
                    <li className="px-3 py-4 text-sm text-gray-500">
                      No trades
                    </li>
                  ) : (
                    (rowsByColumn[col] || []).map((t) => {
                      const { tn, addr } = tradeLine(t);
                      return (
                        <li
                          key={t._id}
                          className={
                            showValueColumn
                              ? "px-3 py-2.5 text-sm hover:bg-gray-50 grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-start"
                              : "px-3 py-2.5 text-sm hover:bg-gray-50"
                          }
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900">
                              #{tn}
                            </div>
                            <div className="text-gray-600 text-xs leading-snug break-words">
                              {addr}
                            </div>
                          </div>
                          {showValueColumn && (
                            <div className="text-gray-900 text-sm font-medium text-right min-w-0 break-words">
                              {formatCellValue(matchedField, t)}
                            </div>
                          )}
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}

        {!loading && !search.trim() && (
          <p className="text-gray-600 text-sm">
            Start typing in the search box to group trades by a progress
            tracker field.
          </p>
        )}
      </div>
    </div>
  );
};

export default TradeDashboard;
