import { subDays, parse as parseDateFns, format, isValid } from "date-fns";

function parseIsoDay(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parts = raw.split("-");
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dt = new Date(y, m, d);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatReminderDate(dateObj) {
  return format(dateObj, "MM/dd/yyyy");
}

function tradeReminderLabel(trade) {
  const tn = trade?.tradeNumber ?? trade?.keyInfo?.tradeNumber ?? "";
  const sn = trade?.keyInfo?.streetNumber || "";
  const st = trade?.keyInfo?.streetName || "";
  const addr = [sn, st].filter(Boolean).join(" ");
  return addr ? `Trade #${tn} — ${addr}` : `Trade #${tn}`;
}

/**
 * Synthetic reminders shown 2 days before each trade's compliance deadline.
 * Date format matches manual reminders (MM/dd/yyyy).
 */
export function buildComplianceDeadlineReminders(trades = []) {
  const out = [];
  for (const trade of trades) {
    const deadlineIso = trade?.progressTracker?.complianceDeadlineDate;
    const deadline = parseIsoDay(deadlineIso);
    if (!deadline) continue;

    const reminderDate = subDays(deadline, 2);
    if (!isValid(reminderDate)) continue;

    const status = String(trade?.progressTracker?.complianceStatus || "").trim();
    if (status === "Yes") continue;

    out.push({
      _id: `compliance-deadline-${trade._id}`,
      date: formatReminderDate(reminderDate),
      reminder: `Compliance deadline in 2 days — ${tradeReminderLabel(trade)} (due ${formatReminderDate(deadline)})`,
      isComplianceDeadline: true,
      tradeId: trade._id,
    });
  }
  return out;
}

function listingReminderLabel(listing) {
  const num = listing?.listingNumber ?? "";
  const sn = listing?.address?.streetNumber || "";
  const st = listing?.address?.streetName || "";
  const addr = [sn, st].filter(Boolean).join(" ");
  return addr ? `Listing #${num} — ${addr}` : `Listing #${num}`;
}

export function buildListingComplianceDeadlineReminders(listings = []) {
  const out = [];
  for (const listing of listings) {
    const deadlineIso = listing?.compliance?.deadlineDate;
    const deadline = parseIsoDay(deadlineIso);
    if (!deadline) continue;

    const reminderDate = subDays(deadline, 2);
    if (!isValid(reminderDate)) continue;

    const status = String(listing?.compliance?.status || "").trim();
    if (status === "Completed") continue;

    out.push({
      _id: `listing-compliance-deadline-${listing._id}`,
      date: formatReminderDate(reminderDate),
      reminder: `Listing compliance deadline in 2 days — ${listingReminderLabel(listing)} (due ${formatReminderDate(deadline)})`,
      isComplianceDeadline: true,
      isListingComplianceDeadline: true,
      listingId: listing._id,
    });
  }
  return out;
}

export function parseDashboardReminderDate(dateStr) {
  return parseDateFns(dateStr, "MM/dd/yyyy", new Date());
}

/** Format ISO or stored date as MM/dd/yyyy for display. */
export function formatDisplayDateMMDDYYYY(value) {
  const deadline = parseIsoDay(value);
  if (!deadline || !isValid(deadline)) return "";
  return formatReminderDate(deadline);
}

/** Parse MM/DD/YYYY text to YYYY-MM-DD for storage. */
export function parseMMDDYYYYToIso(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split("/");
  if (parts.length !== 3) return "";
  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    year < 1900
  ) {
    return "";
  }
  const dt = new Date(year, month - 1, day);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function mergeDashboardReminders(
  manualReminders = [],
  trades = [],
  listings = [],
) {
  const tradeCompliance = buildComplianceDeadlineReminders(trades);
  const listingCompliance = buildListingComplianceDeadlineReminders(listings);
  return [...listingCompliance, ...tradeCompliance, ...manualReminders];
}

/** Distinct dashboard card colours for each compliance reminder type. */
export function getDashboardReminderStyles(reminder) {
  if (reminder?.isListingComplianceDeadline) {
    return {
      card: "bg-violet-100 border border-violet-300",
      date: "text-violet-900",
      badge: "text-violet-700",
      body: "text-violet-950",
      badgeLabel: "Listing Compliance",
    };
  }
  if (reminder?.isComplianceDeadline) {
    return {
      card: "bg-amber-100 border border-amber-300",
      date: "text-amber-900",
      badge: "text-amber-700",
      body: "text-amber-950",
      badgeLabel: "Trade Compliance",
    };
  }
  return {
    card: "bg-gray-100",
    date: "text-gray-800",
    badge: "",
    body: "text-gray-600",
    badgeLabel: "",
  };
}
