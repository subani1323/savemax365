/**
 * Trade dashboard searchable fields: progressTracker paths, plus keyInfo / EFT-derived dates.
 * `match` strings are used for the Trade Dashboard search box (case-insensitive).
 */
export const PROGRESS_TRACKER_FIELDS = [
  {
    key: "finalizedDate",
    label: "Deal finalized — date",
    match: [
      "deal finalized",
      "finalized date",
      "deal finalized date",
      "finalized",
    ],
    kind: "date",
  },
  {
    key: "eftsIssuedLatest",
    label: "EFTs issued — date (latest)",
    match: [
      "efts issued",
      "eft issued",
      "efts issued date",
      "eft latest",
      "eft date",
    ],
    kind: "date",
    source: "computedEft",
  },
  {
    key: "complianceComplete",
    label: "Compliance complete",
    match: ["compliance", "compliance complete"],
    kind: "compliance",
    order: ["No", "Outstanding", "Complete"],
  },
  {
    key: "depositReceiptIssued",
    label: "Deposit receipt issued",
    match: ["deposit receipt", "receipt issued"],
    kind: "yesNo",
  },
  {
    key: "depositCoversCommission",
    label: "Deposit covers commission",
    match: ["deposit covers", "covers commission"],
    kind: "yesNoUnset",
  },
  {
    key: "openTRSSent",
    label: "Open TRS sent",
    match: ["open trs", "trs sent", "trs"],
    kind: "yesNo",
  },
  {
    key: "openTRSSentDate",
    label: "Open TRS sent — date",
    match: ["open trs sent date", "open trs date", "trs sent date"],
    kind: "date",
  },
  {
    key: "commissionInvoiceReceived",
    label: "Commission invoice received",
    match: ["commission invoice received", "invoice received"],
    kind: "enum",
    order: ["No", "Requested", "Yes", "(Not set)"],
  },
  {
    key: "commissionInvoiceReceivedDate",
    label: "Commission invoice received — date",
    match: ["commission invoice received date", "invoice received date"],
    kind: "date",
  },
  {
    key: "commissionInvoiceSentListing",
    label: "Commission invoice sent (listing)",
    match: [
      "commission invoice sent listing",
      "invoice sent listing",
      "commission invoice sent",
    ],
    kind: "enum",
    order: ["N/A", "No", "Yes", "(Not set)"],
  },
  {
    key: "commissionInvoiceSentListingDate",
    label: "Commission invoice sent (listing) — date",
    match: [
      "commission invoice sent date",
      "commission invoice sent listing date",
      "invoice sent listing date",
    ],
    kind: "date",
  },
  {
    key: "commissionInvoiceSentCoop",
    label: "Commission invoice sent (co-op)",
    match: ["commission invoice sent co", "invoice sent co-op", "co-op invoice"],
    kind: "yesNo",
  },
  {
    key: "commissionInvoiceSentCoopDate",
    label: "Commission invoice sent (co-op) — date",
    match: ["commission invoice sent co-op date", "invoice sent co-op date"],
    kind: "date",
  },
  {
    key: "closingConfirmationReceived",
    label: "Closing confirmation received",
    match: ["closing confirmation", "confirmation received"],
    kind: "yesNo",
  },
  {
    key: "paymentReceivedDate",
    label: "Payment received — date",
    match: ["payment received", "payment received date"],
    kind: "date",
  },
  {
    key: "paymentConfirmationSentDate",
    label: "Payment confirmation sent — date",
    match: ["payment confirmation", "confirmation sent"],
    kind: "date",
  },
  {
    key: "closedTRSDate",
    label: "Closed TRS — date",
    match: ["closed trs", "trs date", "closed trs date"],
    kind: "date",
  },
  {
    key: "fileCompleteDate",
    label: "File complete — date",
    match: ["file complete", "file complete date"],
    kind: "date",
  },
];

export function findProgressFieldByQuery(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  const fields = [...PROGRESS_TRACKER_FIELDS];
  if (q.includes("co-op") || q.includes("coop")) {
    const idx = fields.findIndex((f) => f.key === "commissionInvoiceSentCoop");
    if (idx > 0) {
      const [coop] = fields.splice(idx, 1);
      fields.unshift(coop);
    }
  }
  for (const f of fields) {
    const labelLower = f.label.toLowerCase();
    let score = 0;
    if (labelLower === q) score = 100;
    else if (labelLower.includes(q)) score = 80 + q.length;
    else if (q.includes(labelLower.slice(0, Math.min(6, labelLower.length))))
      score = 50;
    for (const m of f.match) {
      if (m === q) score = Math.max(score, 95);
      else if (m.includes(q) || q.includes(m))
        score = Math.max(score, 60 + Math.min(m.length, q.length));
    }
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return bestScore >= 40 ? best : null;
}

export function orderedBuckets(field, bucketKeys) {
  const unique = [...new Set(bucketKeys)];
  if (field.kind === "date") {
    const noDate = "(No date)";
    const dates = unique
      .filter((k) => k !== noDate && /^\d{4}-\d{2}-\d{2}$/.test(k))
      .sort((a, b) => a.localeCompare(b));
    const tail = unique.includes(noDate) ? [noDate] : [];
    return [...dates, ...tail];
  }
  if (field.kind === "compliance") {
    const order = field.order || ["No", "Outstanding", "Complete"];
    return order.filter((b) => unique.includes(b)).concat(
      unique.filter((b) => !order.includes(b)).sort(),
    );
  }
  if (field.kind === "yesNo" || field.kind === "yesNoUnset") {
    const order = ["Yes", "No"];
    return order.filter((b) => unique.includes(b)).concat(
      unique.filter((b) => !order.includes(b)).sort(),
    );
  }
  if (field.order) {
    return field.order.filter((b) => unique.includes(b)).concat(
      unique.filter((b) => !field.order.includes(b)).sort(),
    );
  }
  return unique.sort();
}
