/** Build rows for the Progress Report (MASTER-style deal list). */

import { resolveProgressDateRaw } from "./tradeDashboardDates";
import {
  computeComplianceStatusFromChecklist,
  resolveComplianceChecklist,
} from "./complianceUtils";

/** Columns edited with a dropdown in the progress report modal. */
export const PROGRESS_REPORT_SELECT_OPTIONS = {
  status: [
    { value: "AVAILABLE", label: "Available" },
    { value: "SOLD", label: "Sold" },
    { value: "CLOSED", label: "Closed" },
    { value: "LEASED", label: "Leased" },
    { value: "EXPIRED", label: "Expired" },
    { value: "PENDING", label: "Pending" },
    { value: "READY", label: "Ready" },
    { value: "FALLEN THRU", label: "Fallen Thru" },
    { value: "DUPLICATE", label: "Duplicate" },
  ],
  tradeCategory: [
    { value: "Pre-Construction", label: "Pre-Construction" },
    { value: "Resale", label: "Resale" },
    { value: "Lease", label: "Lease" },
  ],
  complianceStatus: [
    { value: "Yes", label: "Yes" },
    { value: "No", label: "No" },
    { value: "Pending", label: "Pending" },
  ],
};

/** Dropdown columns that start blank until the user picks a value. */
export const PROGRESS_REPORT_BLANK_DEFAULT_SELECT_KEYS = new Set([
  "tradeCategory",
  "complianceStatus",
]);

/** One canonical stored value per status (avoids duplicate dropdown entries). */
export function canonicalTradeStatus(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  for (const opt of PROGRESS_REPORT_SELECT_OPTIONS.status) {
    if (opt.value === upper || opt.value === raw) return opt.value;
    if (opt.label.toUpperCase() === upper) return opt.value;
  }
  return upper;
}

function mergeProgressTracker(trade) {
  const pt = trade?.progressTracker || {};
  const k = trade?.keyInfo || {};
  return {
    ...pt,
    paymentReceivedDate:
      pt.paymentReceivedDate || k.paymentReceivedDate || "",
    paymentConfirmationSentDate:
      pt.paymentConfirmationSentDate || k.paymentConfirmationSentDate || "",
    closedTRSDate: pt.closedTRSDate || k.closedTRSDate || "",
    fileCompleteDate: pt.fileCompleteDate || k.fileCompleteDate || "",
  };
}

export function getTradePartNumber(trade) {
  const tn = trade?.tradeNumber ?? trade?.keyInfo?.tradeNumber ?? "";
  return String(tn).trim();
}

/** Base trade # without -A / -B suffix (e.g. 200-A → 200). */
export function getBaseTradeNumber(trade) {
  const part = getTradePartNumber(trade);
  const m = part.match(/^(\d+)/);
  return m ? m[1] : part;
}

function formatReportDate(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const parts = raw.split("-");
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d)) {
      return new Date(y, m, d).toLocaleDateString("en-CA");
    }
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("en-CA");
  }
  return raw;
}

function formatPrice(value) {
  const n = parseFloat(String(value || "").replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(n) || n === 0) return "";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMoney(value) {
  const n = parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(n)) return "";
  return new Intl.NumberFormat("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function getAgentNames(trade) {
  const names = [];
  for (const a of trade?.agentCommissionList || []) {
    const cls = (a.classification || "").toUpperCase();
    if (cls === "REFERRAL") continue;
    const name =
      a.agentName ||
      [a.firstName, a.lastName].filter(Boolean).join(" ").trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names.join(", ");
}

function formatAddress(trade) {
  const k = trade?.keyInfo || {};
  return [k.streetNumber, k.streetName, k.unit]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function getOutsideBrokersRows(trade) {
  const rows = trade?.commission?.outsideBrokersRows;
  if (Array.isArray(rows) && rows.length) return rows;
  return [];
}

function getOutsideBrokerNames(trade) {
  const names = [];
  for (const row of getOutsideBrokersRows(trade)) {
    const name = String(row.brokerage || row.company || "").trim();
    if (name && !names.includes(name)) names.push(name);
  }
  if (names.length) return names.join(", ");
  for (const ob of trade?.outsideBrokers || []) {
    const name = String(ob.company || "").trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names.join(", ");
}

function getOutsideBrokersInvoiceTotal(trade) {
  let sum = 0;
  let hasValue = false;
  for (const row of getOutsideBrokersRows(trade)) {
    const n = parseFloat(String(row.total ?? "").replace(/[^0-9.-]/g, ""));
    if (!Number.isNaN(n)) {
      sum += n;
      hasValue = true;
    }
  }
  return hasValue ? formatMoney(sum) : "";
}

function getARAmount(trade) {
  const row = trade?.commission?.saleClosingRows?.[0];
  if (!row) return "";
  const raw = row.ar ?? row.AR ?? "";
  if (raw === "" || raw == null) return "";
  return formatMoney(raw);
}

export function hasProgressTrackerInvoiceYes(pt) {
  if (!pt) return false;
  return (
    pt.commissionInvoiceReceived === "Yes" ||
    pt.commissionInvoiceSentListing === "Yes" ||
    pt.commissionInvoiceSentCoop === "Yes"
  );
}

function isCoopTrade(trade) {
  return (
    String(trade?.keyInfo?.classification || "").trim().toUpperCase() ===
    "CO-OPERATING SIDE"
  );
}

/** Single invoice column: received vs sent date with kind for cell styling. */
export function resolveInvoiceDateDisplay(trade) {
  const pt = mergeProgressTracker(trade);
  if (pt.commissionInvoiceReceived === "Requested") {
    return { text: "Requested", kind: "requested" };
  }

  const receivedRaw = String(pt.commissionInvoiceReceivedDate ?? "").trim();
  if (receivedRaw && receivedRaw !== "undefined") {
    const text = formatReportDate(receivedRaw);
    if (text) return { text, kind: "received" };
  }

  const sentRaw = String(
    isCoopTrade(trade)
      ? pt.commissionInvoiceSentCoopDate ?? ""
      : pt.commissionInvoiceSentListingDate || pt.invoicedDate || "",
  ).trim();
  if (sentRaw && sentRaw !== "undefined") {
    const text = formatReportDate(sentRaw);
    if (text) return { text, kind: "sent" };
  }

  if (pt.commissionInvoiceReceived === "Yes") {
    return { text: "", kind: "received" };
  }

  return { text: "", kind: "" };
}

export function getProgressReportInvoiceDateCellClass(kind) {
  if (kind === "received") {
    return "bg-sky-100 text-sky-950";
  }
  return "";
}

export function formatInvoiceDate(trade) {
  return resolveInvoiceDateDisplay(trade).text;
}

function paymentReceivedDisplayDate(trade) {
  const eftIso = String(trade?.paymentReceivedEftDateIso || "").trim();
  if (eftIso) return formatReportDate(eftIso);
  const manual = resolveProgressDateRaw(trade, "paymentReceivedDate");
  if (manual) return formatReportDate(manual);
  return "";
}

function commissionPaidOutDisplayDate(trade) {
  const agentIso = String(trade?.paymentToAgentsEftDateIso || "").trim();
  if (agentIso) return formatReportDate(agentIso);
  const outsideIso = String(trade?.outsideBrokerPayEftDateIso || "").trim();
  if (outsideIso) return formatReportDate(outsideIso);
  return "";
}

function formatOpenTRSDate(trade) {
  const pt = mergeProgressTracker(trade);
  const raw = pt.openTRSSentDate || pt.openTRSDate || "";
  if (pt.openTRSSent !== "Yes" && !raw) return "";
  return raw ? formatReportDate(raw) : "";
}

function formatClosedTRSDate(trade) {
  const pt = mergeProgressTracker(trade);
  const raw = pt.closedTRSDate || "";
  return raw ? formatReportDate(raw) : "";
}

export function progressReportTradeLabel(trade) {
  const tn = trade?.tradeNumber ?? trade?.keyInfo?.tradeNumber ?? "";
  const sn = trade?.keyInfo?.streetNumber || "";
  const st = trade?.keyInfo?.streetName || "";
  const addr = [sn, st].filter(Boolean).join(" ");
  return addr ? `#${tn} — ${addr}` : `#${tn}`;
}

/** Searchable trade filter options (descending trade #), same labels as Progress Tracker. */
export function buildProgressReportTradeFilterOptions(trades) {
  return (trades || [])
    .map((t) => {
      const value = String(
        t.tradeNumber ?? t.keyInfo?.tradeNumber ?? "",
      ).trim();
      if (!value) return null;
      return { value, label: progressReportTradeLabel(t) };
    })
    .filter(Boolean)
    .sort((a, b) => compareBaseTradeNumberDesc(a.value, b.value));
}

export function buildProgressReportRow(trade) {
  const k = trade?.keyInfo || {};
  const pt = mergeProgressTracker(trade);
  const tradeNumber = getTradePartNumber(trade);
  const id = trade._id != null ? String(trade._id) : "";
  const invoice = resolveInvoiceDateDisplay(trade);
  let complianceStatus =
    pt.complianceStatus != null ? String(pt.complianceStatus).trim() : "";
  if (!complianceStatus && pt.complianceTransactionType) {
    const checklist = resolveComplianceChecklist(
      pt.complianceTransactionType,
      pt.complianceChecklist,
    );
    complianceStatus = computeComplianceStatusFromChecklist(checklist);
  }
  return {
    rowKey: id || tradeNumber,
    tradeId: id,
    tradeNumber,
    baseTradeNumber: getBaseTradeNumber(trade),
    tradeCategory: pt.tradeCategory != null ? String(pt.tradeCategory).trim() : "",
    address: formatAddress(trade),
    closingDate: formatReportDate(k.closeDate),
    status: k.status ? canonicalTradeStatus(k.status) : "",
    tradeClass: k.classification || "",
    agentName: getAgentNames(trade) || "—",
    complianceStatus,
    invoiceDate: invoice.text,
    invoiceDateKind: invoice.kind,
    openTRSDate: formatOpenTRSDate(trade),
    closedTRSDate: formatClosedTRSDate(trade),
    price: formatPrice(k.sellPrice),
    priceRaw: parseFloat(String(k.sellPrice || "").replace(/[^0-9.-]/g, "")) || 0,
    arAmount: getARAmount(trade),
    invoiceAmount: getOutsideBrokersInvoiceTotal(trade),
    outsideBroker: getOutsideBrokerNames(trade),
    paymentReceivedDate: paymentReceivedDisplayDate(trade),
    paymentToAgentsDate: commissionPaidOutDisplayDate(trade),
    action: formatReportDate(pt.action),
    followUpDate: formatReportDate(pt.followUpDate),
    notes: pt.notes != null ? String(pt.notes).trim() : "",
  };
}

export function buildProgressReportRows(trades) {
  return (trades || [])
    .map((trade) => buildProgressReportRow(trade))
    .sort((a, b) => {
      const na = parseInt(String(a.baseTradeNumber).replace(/\D/g, ""), 10) || 0;
      const nb = parseInt(String(b.baseTradeNumber).replace(/\D/g, ""), 10) || 0;
      if (nb !== na) return nb - na;
      return String(a.baseTradeNumber).localeCompare(String(b.baseTradeNumber));
    });
}

export function cloneProgressReportRows(rows) {
  return (rows || []).map((row) => ({ ...row }));
}

/** Merge preset options with any values already present in report rows. */
export function getProgressReportSelectOptions(columnKey, rows) {
  const base = PROGRESS_REPORT_SELECT_OPTIONS[columnKey];
  if (!base) return null;
  if (PROGRESS_REPORT_BLANK_DEFAULT_SELECT_KEYS.has(columnKey)) {
    return base;
  }
  const labelByValue = new Map(base.map((o) => [o.value, o.label]));
  const seen = new Set();
  const merged = [];

  const add = (rawValue) => {
    const v = String(rawValue ?? "").trim();
    if (!v) return;
    const value =
      columnKey === "status" ? canonicalTradeStatus(v) : v;
    if (seen.has(value)) return;
    seen.add(value);
    merged.push({
      value,
      label: labelByValue.get(value) || v,
    });
  };

  for (const o of base) add(o.value);
  for (const row of rows || []) {
    add(row[columnKey]);
  }
  return merged;
}

export function isProgressReportSelectColumn(columnKey) {
  return Boolean(PROGRESS_REPORT_SELECT_OPTIONS[columnKey]);
}

export const PROGRESS_REPORT_COLUMNS = [
  { key: "tradeCategory", label: "Trade Category", edit: "select" },
  { key: "tradeNumber", label: "Trade #" },
  { key: "address", label: "Address" },
  { key: "closingDate", label: "Closing Date" },
  { key: "status", label: "Status" },
  { key: "tradeClass", label: "Trade Class" },
  { key: "agentName", label: "Agent" },
  { key: "complianceStatus", label: "Compliance", edit: "select" },
  { key: "invoiceDate", label: "Invoice Date" },
  { key: "openTRSDate", label: "Open TRS Date" },
  { key: "closedTRSDate", label: "Closed TRS Date" },
  { key: "price", label: "Price" },
  { key: "arAmount", label: "AR Amount" },
  { key: "invoiceAmount", label: "Invoice Amount" },
  { key: "outsideBroker", label: "Outside Broker" },
  { key: "paymentReceivedDate", label: "Commission Received" },
  { key: "paymentToAgentsDate", label: "Commission paid out" },
  { key: "followUpDate", label: "Follow Up Date", edit: "date" },
  { key: "action", label: "BC Invoiced", edit: "date" },
  { key: "notes", label: "Notes" },
];

/** Optional fixed widths for on-screen report table (modal). */
export const PROGRESS_REPORT_COLUMN_CELL_CLASS = {
  tradeCategory: "min-w-[8.5rem] w-[8.5rem] max-w-[8.5rem]",
  address: "min-w-[11rem] w-[11rem] max-w-[11rem]",
  tradeClass: "min-w-[9rem] w-[9rem] max-w-[9rem]",
  agentName: "min-w-[10rem] w-[10rem] max-w-[10rem]",
  complianceStatus: "min-w-[7rem] w-[7rem] max-w-[7rem]",
  outsideBroker: "min-w-[10rem] w-[10rem] max-w-[10rem]",
  action: "min-w-[9rem] w-[9rem] max-w-[9rem]",
  notes: "min-w-[16rem] w-[16rem] max-w-[16rem]",
};

export function getProgressReportColumnCellClass(columnKey) {
  return PROGRESS_REPORT_COLUMN_CELL_CLASS[columnKey] || "";
}

/** Columns with filter dropdowns above the table (empty = all). */
export const PROGRESS_REPORT_FILTER_KEYS = [
  "tradeCategory",
  "tradeNumber",
  "address",
  "closingDate",
  "status",
  "tradeClass",
  "agentName",
  "complianceStatus",
  "invoiceDate",
  "openTRSDate",
  "closedTRSDate",
  "price",
  "arAmount",
  "invoiceAmount",
  "outsideBroker",
  "paymentReceivedDate",
  "paymentToAgentsDate",
  "action",
  "followUpDate",
  "notes",
];

export function getProgressReportFilterOptions(columnKey, rows) {
  const values = new Set();
  for (const row of rows || []) {
    const v = String(row[columnKey] ?? "").trim();
    values.add(v || "—");
  }
  const sorted = [...values].sort((a, b) => {
    if (a === "—") return 1;
    if (b === "—") return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
  return [{ value: "", label: "All" }, ...sorted.map((v) => ({ value: v, label: v }))];
}

/** Filter value is an exact match (trade #). */
export const PROGRESS_REPORT_TYPEABLE_FILTER_KEYS = new Set(["tradeNumber"]);

/** Filter value is a case-insensitive partial match (contains). */
export const PROGRESS_REPORT_PARTIAL_MATCH_FILTER_KEYS = new Set(["address"]);

export function compareBaseTradeNumberDesc(a, b) {
  const na = parseInt(String(a).replace(/\D/g, ""), 10) || 0;
  const nb = parseInt(String(b).replace(/\D/g, ""), 10) || 0;
  if (nb !== na) return nb - na;
  return String(b).localeCompare(String(a));
}

/** Unique trade # values for filter dropdown/datalist (highest first). */
export function getProgressReportTradeNumberFilterList(rows) {
  const seen = new Set();
  const list = [];
  for (const row of rows || []) {
    const v = String(row.baseTradeNumber ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    list.push(v);
  }
  list.sort(compareBaseTradeNumberDesc);
  return list;
}

export function applyProgressReportFilters(rows, filters) {
  const active = Object.entries(filters || {}).filter(
    ([, v]) => v != null && String(v).trim() !== "",
  );
  if (!active.length) return rows || [];
  return (rows || []).filter((row) =>
    active.every(([key, selected]) => {
      const q = String(selected).trim();
      if (!q) return true;
      if (PROGRESS_REPORT_TYPEABLE_FILTER_KEYS.has(key)) {
        const rowTn = String(row.tradeNumber ?? "").trim().toLowerCase();
        return rowTn === q.toLowerCase();
      }
      if (PROGRESS_REPORT_PARTIAL_MATCH_FILTER_KEYS.has(key)) {
        const cell = String(row[key] ?? "").trim().toLowerCase();
        if (!cell || cell === "—") return false;
        return cell.includes(q.toLowerCase());
      }
      const cell = String(row[key] ?? "").trim() || "—";
      return cell === selected;
    }),
  );
}

/** Date columns available for period (range) filtering on the Progress Report. */
export const PROGRESS_REPORT_PERIOD_DATE_FIELDS = [
  { key: "paymentReceivedDate", label: "Commission Received" },
  { key: "paymentToAgentsDate", label: "Commission paid out" },
  { key: "invoiceDate", label: "Invoice" },
  { key: "openTRSDate", label: "Open TRS" },
  { key: "closedTRSDate", label: "Closed TRS" },
];

export function getProgressReportPeriodDateFieldLabel(key) {
  const field = PROGRESS_REPORT_PERIOD_DATE_FIELDS.find((f) => f.key === key);
  return field?.label || key;
}

/** Keep rows whose selected date column falls within from/to (inclusive, YYYY-MM-DD). */
export function applyProgressReportPeriodFilter(rows, periodFilter) {
  const dateField = String(periodFilter?.dateField || "").trim();
  const from = String(periodFilter?.from || "").trim();
  const to = String(periodFilter?.to || "").trim();
  if (!dateField || (!from && !to)) return rows || [];

  return (rows || []).filter((row) => {
    const iso = progressReportDateForInput(row[dateField]);
    if (!iso) return false;
    if (from && iso < from) return false;
    if (to && iso > to) return false;
    return true;
  });
}

export function isProgressReportPeriodFilterActive(periodFilter) {
  const dateField = String(periodFilter?.dateField || "").trim();
  const from = String(periodFilter?.from || "").trim();
  const to = String(periodFilter?.to || "").trim();
  return Boolean(dateField && (from || to));
}

export function formatProgressReportPeriodFilterLabel(periodFilter) {
  if (!isProgressReportPeriodFilterActive(periodFilter)) return "";
  const fieldLabel = getProgressReportPeriodDateFieldLabel(periodFilter.dateField);
  const from = String(periodFilter.from || "").trim();
  const to = String(periodFilter.to || "").trim();
  const fmt = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return iso;
    return new Date(y, m - 1, d).toLocaleDateString("en-CA");
  };
  if (from && to) return `${fieldLabel}: ${fmt(from)} – ${fmt(to)}`;
  if (from) return `${fieldLabel}: from ${fmt(from)}`;
  return `${fieldLabel}: through ${fmt(to)}`;
}

export function getProgressReportColumnLabel(key) {
  const col = PROGRESS_REPORT_COLUMNS.find((c) => c.key === key);
  return col?.label || key;
}

/** Parse display date to yyyy-mm-dd for date inputs, or return "". */
export function progressReportDateForInput(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = raw.split(/[/-]/);
  if (parts.length === 3) {
    let y;
    let m;
    let d;
    if (parts[0].length === 4) {
      y = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10);
      d = parseInt(parts[2], 10);
    } else {
      m = parseInt(parts[0], 10);
      d = parseInt(parts[1], 10);
      y = parseInt(parts[2], 10);
      if (y < 100) y += 2000;
    }
    if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d)) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const mo = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${mo}-${day}`;
  }
  return "";
}

export function progressReportDateFromInput(isoValue) {
  if (!isoValue) return "";
  const [y, m, d] = isoValue.split("-").map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return isoValue;
  return new Date(y, m - 1, d).toLocaleDateString("en-CA");
}
