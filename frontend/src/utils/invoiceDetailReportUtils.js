/** Invoice Detail Report — monthly trade list by entry date. */

export const INVOICE_DETAIL_TYPES = [
  { value: "Sale", label: "Sale" },
  { value: "Lease", label: "Lease" },
];

export const INVOICE_DETAIL_STATUSES = [
  { value: "Closed", label: "Closed" },
  { value: "SOLD", label: "SOLD" },
  { value: "Leased", label: "Leased" },
  { value: "FELL THRU", label: "FELL THRU" },
  { value: "AVAILABLE", label: "AVAILABLE" },
];

/** Optional filter when generating the report (not a row value). */
export const INVOICE_DETAIL_STATUS_FILTER = [
  { value: "", label: "Any status" },
  ...INVOICE_DETAIL_STATUSES,
];

export const INVOICE_DETAIL_COLUMNS = [
  { key: "reportDate", label: "Entry Date", edit: "select" },
  { key: "tradeNumber", label: "Trade #", edit: "select" },
  { key: "agentName", label: "Agent Name", edit: "select" },
  { key: "propertyAddress", label: "Property Address", edit: "text" },
  { key: "dealType", label: "Type", edit: "select" },
  { key: "status", label: "Status", edit: "select" },
];

function clean(value) {
  return String(value ?? "").trim();
}

export function formatIsoToMMDDYYYY(iso) {
  if (!iso) return "";
  const raw = String(iso).trim();
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[1].padStart(2, "0")}/${mdy[2].padStart(2, "0")}/${mdy[3]}`;
  }
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[2]}/${ymd[3]}/${ymd[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export function formatMMDDYYYYToIso(mdy) {
  if (!mdy) return "";
  const raw = String(mdy).trim();
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseIsoDateLocal(iso) {
  if (!iso) return null;
  const ymd = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    return new Date(
      Number(ymd[1]),
      Number(ymd[2]) - 1,
      Number(ymd[3]),
      12,
      0,
      0,
    );
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getTradeEntryIso(trade) {
  const k = trade?.keyInfo || {};
  const raw = clean(k.entryDate || trade?.entryDate || "");
  if (!raw) return "";
  return formatMMDDYYYYToIso(raw) || raw;
}

function getPrimaryAgentName(trade) {
  const list = trade?.agentCommissionList || [];
  if (!list.length) return "";
  const lead =
    list.find((a) => /lead|listing|yes/i.test(String(a.agentLead || ""))) ||
    list[0];
  return clean(lead?.agentName || "");
}

export function tradeInEntryPeriod(trade, fromIso, toIso) {
  const entry = getTradeEntryIso(trade);
  if (!entry) return false;
  const d = parseIsoDateLocal(entry);
  if (!d) return false;
  if (fromIso) {
    const from = parseIsoDateLocal(fromIso);
    if (from && d < from) return false;
  }
  if (toIso) {
    const to = parseIsoDateLocal(toIso);
    if (to && d > to) return false;
  }
  return true;
}

export function normalizeInvoiceDetailStatus(value) {
  const raw = clean(value);
  if (!raw) return "Closed";
  const upper = raw.toUpperCase();
  if (/^available$/i.test(upper) || upper === "AVAILABLE") return "AVAILABLE";
  if (/^sold$/i.test(upper) || upper === "SOLD") return "SOLD";
  if (/lease/i.test(upper)) return "Leased";
  if (/fall|thru|through|term|cancel|clawback/i.test(upper)) return "FELL THRU";
  if (/closed|final/i.test(upper)) return "Closed";
  if (/sold/i.test(upper)) return "SOLD";
  const match = INVOICE_DETAIL_STATUSES.find(
    (o) => o.value.toUpperCase() === upper || o.label.toUpperCase() === upper,
  );
  return match?.value || raw;
}

export function normalizeInvoiceDetailDealType(value) {
  const raw = clean(value);
  if (/lease/i.test(raw)) return "Lease";
  if (/sale|purchase/i.test(raw)) return "Sale";
  return raw || "Sale";
}

export function propertyAddressFromTrade(trade) {
  const k = trade?.keyInfo || {};
  const street = [k.streetNumber, k.streetName].filter(Boolean).join(" ");
  const withUnit = k.unit
    ? street
      ? `${k.unit}-${street}`
      : clean(k.unit)
    : street;
  const cityLine = [withUnit, k.city].filter(Boolean).join(", ");
  return cityLine || clean(k.propertyAddress) || "";
}

function formatIsoLabel(iso) {
  if (!iso) return "";
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m) return iso;
  return `${months[m - 1]} ${String(d || 1).padStart(2, "0")}, ${y}`;
}

export function formatInvoiceDetailPeriodLabel(fromIso, toIso) {
  if (fromIso && toIso) return `${formatIsoLabel(fromIso)} to ${formatIsoLabel(toIso)}`;
  if (fromIso) return `${formatIsoLabel(fromIso)} to Date`;
  if (toIso) return `Through ${formatIsoLabel(toIso)}`;
  return "";
}

function tradeMatchesStatusFilter(trade, statusFilter) {
  if (!statusFilter) return true;
  const k = trade?.keyInfo || {};
  const raw = k.status || trade?.status || "";
  const normalized = normalizeInvoiceDetailStatus(raw);
  return (
    normalized === statusFilter ||
    String(normalized).toUpperCase() === String(statusFilter).toUpperCase()
  );
}

export function buildInvoiceDetailRow(trade) {
  const k = trade?.keyInfo || {};
  const reportIso = getTradeEntryIso(trade);
  return {
    rowId: String(trade?._id || trade?.tradeNumber || Math.random()),
    tradeId: trade?._id || "",
    tradeNumber: clean(trade?.tradeNumber || k.tradeNumber),
    reportDate: formatIsoToMMDDYYYY(reportIso),
    reportDateIso: reportIso,
    agentName: getPrimaryAgentName(trade),
    propertyAddress: propertyAddressFromTrade(trade),
    dealType: normalizeInvoiceDetailDealType(k.dealType || k.type),
    status: normalizeInvoiceDetailStatus(k.status || trade?.status),
    dirty: false,
  };
}

export function buildInvoiceDetailRows(
  trades,
  fromIso,
  toIso,
  statusFilter = "",
) {
  if (!fromIso && !toIso) return [];
  return (trades || [])
    .filter((t) => tradeInEntryPeriod(t, fromIso, toIso))
    .filter((t) => tradeMatchesStatusFilter(t, statusFilter))
    .map(buildInvoiceDetailRow)
    .sort((a, b) => {
      const da = a.reportDateIso || "";
      const db = b.reportDateIso || "";
      if (da !== db) return da.localeCompare(db);
      const na = parseInt(String(a.tradeNumber).match(/\d+/)?.[0] || "0", 10);
      const nb = parseInt(String(b.tradeNumber).match(/\d+/)?.[0] || "0", 10);
      return na - nb;
    });
}

export function buildInvoiceDetailDateOptions(rows) {
  const seen = new Set();
  return (rows || [])
    .map((r) => clean(r.reportDate))
    .filter((d) => {
      if (!d || seen.has(d)) return false;
      seen.add(d);
      return true;
    })
    .sort()
    .map((value) => ({ value, label: value }));
}

/** Counts of trades in the report, grouped by status. */
export function buildInvoiceDetailStatusBreakdown(rows) {
  const counts = {};
  for (const row of rows || []) {
    const status = clean(row?.status) || "Unknown";
    counts[status] = (counts[status] || 0) + 1;
  }
  const knownOrder = INVOICE_DETAIL_STATUSES.map((o) => o.value);
  const entries = Object.entries(counts).map(([status, count]) => ({
    status,
    count,
  }));
  entries.sort((a, b) => {
    const ia = knownOrder.indexOf(a.status);
    const ib = knownOrder.indexOf(b.status);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a.status.localeCompare(b.status);
  });
  return entries;
}

export function buildInvoiceDetailTradeOptions(rows) {
  const seen = new Set();
  return (rows || [])
    .map((r) => clean(r.tradeNumber))
    .filter((tn) => {
      if (!tn || seen.has(tn)) return false;
      seen.add(tn);
      return true;
    })
    .map((value) => ({ value, label: value }));
}

export function buildInvoiceDetailAgentOptions(agents, rows) {
  const opts = new Map();
  (agents || []).forEach((a) => {
    const name = clean(
      a.name ||
        [a.firstName, a.lastName].filter(Boolean).join(" ") ||
        a.agentName,
    );
    if (name) opts.set(name, { value: name, label: name });
  });
  (rows || []).forEach((r) => {
    if (r.agentName) opts.set(r.agentName, { value: r.agentName, label: r.agentName });
  });
  return [...opts.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

export function getInvoiceDetailSelectOptions(key, row, tradeOptions, agentOptions, dateOptions) {
  if (key === "tradeNumber") return tradeOptions || [];
  if (key === "agentName") return agentOptions || [];
  if (key === "reportDate") {
    const opts = [...(dateOptions || [])];
    if (row.reportDate && !opts.some((o) => o.value === row.reportDate)) {
      opts.unshift({ value: row.reportDate, label: row.reportDate });
    }
    return opts;
  }
  if (key === "dealType") return INVOICE_DETAIL_TYPES;
  if (key === "status") return INVOICE_DETAIL_STATUSES;
  return [];
}

export function invoiceDetailRowToTradePatch(row) {
  const entryIso =
    formatMMDDYYYYToIso(row.reportDate) || row.reportDateIso || "";
  return {
    keyInfo: {
      dealType: row.dealType || "",
      status: row.status || "",
      entryDate: entryIso,
      propertyAddress: row.propertyAddress || "",
    },
  };
}
