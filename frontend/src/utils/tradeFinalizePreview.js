import { roundTo2 } from "./numberUtils";

/**
 * Ledger lines that belong under Commission Trust / transfer flows, not the main
 * trade finalization journal on the printout.
 */
export function isCommissionTrustOffJournalLedgerRow(row) {
  if (!row?.description || !/commission trust/i.test(row.description))
    return false;
  const cr = parseFloat(row.credit) || 0;
  const dr = parseFloat(row.debit) || 0;
  return (
    (row.accountNumber === "10004" && cr > 0) ||
    (row.accountNumber === "21500" && dr > 0) ||
    (row.accountNumber === "10004" && dr > 0) ||
    (row.accountNumber === "10002" && cr > 0)
  );
}

export const ledgerRowMatchesTradeTag = (row, tradeNumber) => {
  const tn = String(tradeNumber ?? "").trim();
  if (!tn) return false;
  const desc = String(row?.description || "");
  if (desc.includes(`Trade #: ${tn}`) || desc.includes(`Trade #:${tn}`)) {
    return true;
  }
  const escaped = tn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`Trade\\s*#:?\\s*${escaped}\\b`, "i").test(desc);
};

export const rowBelongsToTrade = (row, trade) => {
  const tn = String(
    trade?.tradeNumber ?? trade?.keyInfo?.tradeNumber ?? "",
  ).trim();
  return ledgerRowMatchesTradeTag(row, tn);
};

/** Commission trust EFT reversals from EFT Reversal tab (REV-####, EFT reversal (commission)). */
export function isCommissionEftReversalLedgerRow(row, tradeNumber) {
  if (!ledgerRowMatchesTradeTag(row, tradeNumber)) return false;
  const eft = String(row?.eftNumber ?? "").trim();
  const desc = String(row?.description || "");
  if (/^REV-\d+$/i.test(eft)) return true;
  return /eft\s+reversal\s*\(commission\)/i.test(desc);
}

/** Mirror of commission-trust EFT activity (already listed under Commission Reversals). */
export function isCommissionTrustPaymentMirrorOnBatchReversal(row) {
  const desc = String(row?.description || "");
  if (!/received\s+from/i.test(desc) && !/paid\s+to/i.test(desc)) {
    return false;
  }
  if (/commission\s+trust/i.test(desc)) return true;
  return isCommissionTrustOffJournalLedgerRow(row);
}

/** Finalize / deposit-received batch reversals (REV#trade, REV-FIN-*). */
export function isFinalizeBatchReversalLedgerRow(row, tradeNumber) {
  const eft = String(row?.eftNumber ?? "").trim();
  if (!eft || !/^REV/i.test(eft)) return false;
  if (isCommissionEftReversalLedgerRow(row, tradeNumber)) return false;
  if (isCommissionTrustPaymentMirrorOnBatchReversal(row)) return false;
  if (!ledgerRowMatchesTradeTag(row, tradeNumber)) return false;
  const tn = String(tradeNumber ?? "").replace(/\s+/g, "");
  if (/^REV#/i.test(eft)) {
    return eft.toUpperCase() === `REV#${tn}`.toUpperCase();
  }
  if (/^REV-FIN-/i.test(eft)) {
    return eft.toUpperCase().includes(tn.toUpperCase());
  }
  const desc = String(row?.description || "");
  if (/deposit\s+received\s+reversal/i.test(desc)) return true;
  return /^REV$/i.test(eft);
}

export function isReversalLedgerRow(row, tradeNumber) {
  return (
    isFinalizeBatchReversalLedgerRow(row, tradeNumber) ||
    isCommissionEftReversalLedgerRow(row, tradeNumber)
  );
}

/** Builder repayment, general→commission transfer, commission recall — separate print table. */
export function isPostFinalizeActivityLedgerRow(row, tradeNumber) {
  const desc = String(row?.description || "");
  const tradeTag = `Trade #: ${tradeNumber}`;
  if (!desc.includes(tradeTag) && !desc.includes(`Trade #:${tradeNumber}`)) {
    return false;
  }
  return (
    /builder\s+repayment/i.test(desc) ||
    /commission\s+transfer\s+from\s+general/i.test(desc) ||
    /general\s+to\s+commission/i.test(desc) ||
    /commission\s+recalled/i.test(desc)
  );
}

/** Same deposit posted twice — show one row per logical line */
export function dedupeTrustDepositLedgerRows(rows) {
  const key = (r) =>
    [
      r.accountNumber,
      r.debit || 0,
      r.credit || 0,
      (r.description || "").trim().toLowerCase(),
    ].join("|");
  const best = new Map();
  for (const r of rows) {
    const k = key(r);
    const prev = best.get(k);
    const d = String(r.date || "");
    if (!prev || d > String(prev.date || "")) best.set(k, r);
  }
  return Array.from(best.values()).sort((a, b) =>
    String(a.date || "").localeCompare(String(b.date || "")),
  );
}

function isMainTransactionDetailRow(row, tradeNumber) {
  const desc = String(row?.description || "");
  return (
    !isReversalLedgerRow(row, tradeNumber) &&
    !isPostFinalizeActivityLedgerRow(row, tradeNumber) &&
    !isCommissionTrustOffJournalLedgerRow(row) &&
    !desc.includes("Paid to:") &&
    !(
      (row.accountNumber === "10002" || row.accountNumber === "21300") &&
      /received\s+from/i.test(String(row.description || ""))
    ) &&
    !(
      desc.includes("Commission Trust Payment") &&
      !desc.includes("Received From:") &&
      !desc.includes("Trade #:")
    )
  );
}

/**
 * Build journal rows for Print Details: main table, reversals, and post-finalize activity.
 * When not finalized, uses getTransactionDetails() only (includes Confirm Payment clearing).
 */
export function buildTradeFinalizePreview({
  trade,
  ledgerEntries,
  isFinalized,
  getTransactionDetails,
}) {
  const tradeNumber = trade?.tradeNumber;
  let details = [];
  let finalizeReversalRows = [];
  let commissionReversalRows = [];
  let postFinalizeActivityRows = [];
  let suppressFinalizeReversalTable = false;

  if (isFinalized) {
    const tradeLedgerRows = (ledgerEntries || []).filter(
      (row) => row?.description && rowBelongsToTrade(row, trade),
    );

    finalizeReversalRows = tradeLedgerRows.filter((row) =>
      isFinalizeBatchReversalLedgerRow(row, tradeNumber),
    );

    commissionReversalRows = tradeLedgerRows.filter((row) =>
      isCommissionEftReversalLedgerRow(row, tradeNumber),
    );

    postFinalizeActivityRows = tradeLedgerRows.filter((row) =>
      isPostFinalizeActivityLedgerRow(row, tradeNumber),
    );

    details = tradeLedgerRows.filter((row) =>
      isMainTransactionDetailRow(row, tradeNumber),
    );

    if (details.length === 0 && finalizeReversalRows.length > 0) {
      suppressFinalizeReversalTable = true;
      details = finalizeReversalRows.map((row) => ({
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        debit: parseFloat(row.credit) || 0,
        credit: parseFloat(row.debit) || 0,
        description: row.description,
        date: row.date || row.chequeDate,
        eftNumber: row.eftNumber,
      }));
    } else if (details.length === 0 && tradeLedgerRows.length === 0) {
      details = getTransactionDetails() || [];
    }
  } else {
    // getTransactionDetails() already includes Confirm Payment clearing
    // (10004 Dr / 12200 Cr) when We Hold = No and paymentAmount > 0.
    // Do not append those rows again here or Print Details doubles them.
    details = getTransactionDetails() || [];
  }

  return {
    details,
    finalizeReversalRows,
    commissionReversalRows,
    postFinalizeActivityRows,
    suppressFinalizeReversalTable,
  };
}

/** Absorb penny round-off in display: adjust a 21300 entry so totals balance */
export function applyPennyBalanceTo21300(details) {
  let totalDebit = 0;
  let totalCredit = 0;
  details.forEach((row) => {
    totalDebit += Number(row.debit) || 0;
    totalCredit += Number(row.credit) || 0;
  });

  const netDiff = roundTo2(totalCredit - totalDebit);
  if (Math.abs(netDiff) > 0 && Math.abs(netDiff) < 0.02) {
    const adjAmt = Math.abs(netDiff);
    if (netDiff < 0) {
      const adjRow = details.find(
        (r) =>
          r.accountNumber === "21300" &&
          (parseFloat(r.credit) || 0) >= adjAmt,
      );
      if (adjRow) {
        adjRow.credit = roundTo2((parseFloat(adjRow.credit) || 0) + adjAmt);
        totalCredit = roundTo2(totalCredit + adjAmt);
      }
    } else {
      const adjRow = details.find(
        (r) =>
          r.accountNumber === "21300" && (parseFloat(r.debit) || 0) >= adjAmt,
      );
      if (adjRow) {
        adjRow.debit = roundTo2((parseFloat(adjRow.debit) || 0) + adjAmt);
        totalDebit = roundTo2(totalDebit + adjAmt);
      }
    }
  }

  return {
    totalDebit,
    totalCredit,
    closingBalance: roundTo2(totalCredit - totalDebit).toFixed(2),
  };
}

export function sumLedgerRows(rows) {
  let debit = 0;
  let credit = 0;
  rows.forEach((row) => {
    debit += Number(row.debit) || 0;
    credit += Number(row.credit) || 0;
  });
  return {
    debit,
    credit,
    net: roundTo2(credit - debit).toFixed(2),
  };
}

export function filterTrustDepositRowsForPrint(ledgerEntries, tradeNumber) {
  return dedupeTrustDepositLedgerRows(
    (ledgerEntries || []).filter(
      (row) =>
        (row.accountNumber === "10002" || row.accountNumber === "21300") &&
        row.description &&
        ledgerRowMatchesTradeTag(row, tradeNumber) &&
        row.description.toLowerCase().includes("received from") &&
        !/^rev/i.test(String(row.eftNumber || "").trim()) &&
        !/reversal/i.test(String(row.description || "")),
    ),
  );
}

export function getTradeTotalCommissionAmount(
  listingAmount,
  sellingAmount,
  listingTax,
  sellingTax,
) {
  return roundTo2(
    (parseFloat(listingAmount) || 0) +
      (parseFloat(sellingAmount) || 0) +
      (parseFloat(listingTax) || 0) +
      (parseFloat(sellingTax) || 0),
  );
}

/** When deposit >= total commission: credit excess deposit to 21300. */
export function buildSecondDepositLiabilityEntry(
  depositAmount,
  totalCommissionAmount,
  commissionDescription,
  commissionDate,
) {
  const dep = parseFloat(depositAmount) || 0;
  const total = parseFloat(totalCommissionAmount) || 0;
  if (dep < total) return null;
  return {
    accountNumber: "21300",
    accountName: "Deposit Liability",
    debit: 0,
    credit: roundTo2(dep - total),
    description: commissionDescription,
    date: commissionDate,
  };
}

export function buildSecondDepositLiabilitySpread(
  depositAmount,
  listingAmount,
  sellingAmount,
  listingTax,
  sellingTax,
  commissionDescription,
  commissionDate,
) {
  const total = getTradeTotalCommissionAmount(
    listingAmount,
    sellingAmount,
    listingTax,
    sellingTax,
  );
  const entry = buildSecondDepositLiabilityEntry(
    depositAmount,
    total,
    commissionDescription,
    commissionDate,
  );
  return entry ? [entry] : [];
}

/**
 * When deposit < total commission:
 * - Finalize date: 12200 debit (A/R accrual)
 * - Closing date (optional): 10004 debit + 12200 credit to clear A/R when paid
 */
export function buildDepositShortfallLedgerEntries({
  depositAmount,
  totalCommissionAmount,
  commissionDescription,
  commissionDate,
  closingDate,
  tradeNumber,
  address,
  receivedFrom = "",
  includePaymentClearing = false,
  paymentAmount = 0,
  /** "accrual" | "clearing" | "both" */
  mode = "both",
}) {
  const dep = parseFloat(depositAmount) || 0;
  const total = parseFloat(totalCommissionAmount) || 0;
  const shortfall = roundTo2(Math.max(0, total - dep));
  if (shortfall <= 0) return [];

  const rows = [];
  const postAccrual = mode === "accrual" || mode === "both";
  const postClearing =
    (mode === "clearing" || mode === "both") && includePaymentClearing;

  if (postAccrual) {
    rows.push({
      accountNumber: "12200",
      accountName: "A/R - Commission From Deals",
      debit: shortfall,
      credit: 0,
      description: commissionDescription,
      date: commissionDate,
    });
  }

  if (postClearing) {
    const payAmt = roundTo2(paymentAmount > 0 ? paymentAmount : shortfall);
    const receivedPart = String(receivedFrom || "").trim()
      ? ` - Received From: ${receivedFrom.trim()}`
      : "";
    const paymentDescription = `Trade #: ${tradeNumber} - ${address}${receivedPart}`;
    rows.push(
      {
        accountNumber: "10004",
        accountName: "Cash - Commission Trust Account",
        debit: payAmt,
        credit: 0,
        description: paymentDescription,
        date: closingDate,
      },
      {
        accountNumber: "12200",
        accountName: "A/R - Commission From Deals",
        debit: 0,
        credit: payAmt,
        description: paymentDescription,
        date: closingDate,
      },
    );
  }

  return rows;
}
