/**
 * Normalize stored trade / EFT dates to YYYY-MM-DD for Trade Dashboard grouping.
 * Matches calendar intent for: ISO date or datetime, plain YYYY-MM-DD, DD/MM/YYYY
 * (slashes, common in this app — see Info2Form), and Date instances.
 */
export function toCalendarIsoDay(raw) {
  if (raw == null) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    const y = raw.getFullYear();
    const mo = raw.getMonth() + 1;
    const d = raw.getDate();
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const s0 = String(raw).trim();
  if (!s0) return null;

  const isoPrefix = s0.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoPrefix) {
    const y = parseInt(isoPrefix[1], 10);
    const mo = parseInt(isoPrefix[2], 10);
    const d = parseInt(isoPrefix[3], 10);
    if (
      !Number.isNaN(y) &&
      !Number.isNaN(mo) &&
      !Number.isNaN(d) &&
      y > 1900 &&
      mo >= 1 &&
      mo <= 12 &&
      d >= 1 &&
      d <= 31
    ) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  const slash = s0.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const day = parseInt(slash[1], 10);
    const month = parseInt(slash[2], 10);
    const year = parseInt(slash[3], 10);
    if (
      !Number.isNaN(year) &&
      !Number.isNaN(month) &&
      !Number.isNaN(day) &&
      year > 1900 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const dt = new Date(s0);
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const mo = dt.getMonth() + 1;
    const d = dt.getDate();
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/**
 * Resolve a progress-tracker date field the same way as ProgressTrackerModal
 * (progressTracker first, then keyInfo fallbacks for fields that can live in either place).
 * @param {Object} trade
 * @param {string} key - field key (e.g. fileCompleteDate, finalizedDate)
 * @returns {string} raw stored value or ""
 */
export function resolveProgressDateRaw(trade, key) {
  if (!trade) return "";
  const pt = trade.progressTracker || {};
  const k = trade.keyInfo || {};
  let raw;
  switch (key) {
    case "paymentReceivedDate":
      raw = pt.paymentReceivedDate || k.paymentReceivedDate;
      break;
    case "paymentConfirmationSentDate":
      raw = pt.paymentConfirmationSentDate || k.paymentConfirmationSentDate;
      break;
    case "closedTRSDate":
      raw = pt.closedTRSDate || k.closedTRSDate;
      break;
    case "fileCompleteDate":
      raw = pt.fileCompleteDate || k.fileCompleteDate;
      break;
    default:
      raw = pt[key] ?? k[key];
  }
  if (raw === undefined || raw === null) return "";
  if (raw instanceof Date) {
    return toCalendarIsoDay(raw) || "";
  }
  return String(raw).trim();
}

/** Local calendar today as YYYY-MM-DD (Progress Tracker invoice date, etc.). */
export function todayCalendarIso() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
