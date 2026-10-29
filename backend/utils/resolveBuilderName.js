const Ledger = require("../models/Ledger");

const DEFAULT_TAX_RATE = 0.13;

const getTradeTaxRate = (trade) => {
  if (trade?.customTaxRate != null && trade.customTaxRate !== "") {
    const n = Number(trade.customTaxRate);
    if (Number.isFinite(n)) return n;
  }
  return DEFAULT_TAX_RATE;
};

const getTrustDepositAmount = (trade) => {
  const records = trade?.trustRecords || [];
  if (records.length === 0) return 0;
  const first = records[0];
  return parseFloat(first.amount || first.depositAmount || first.total || 0) || 0;
};

const getTotalCommissionAmount = (trade) => {
  const row = trade?.commission?.commissionIncomeRows?.[0] || {};
  const listingAmount = parseFloat(row.listingAmount || 0) || 0;
  const sellingAmount = parseFloat(row.sellingAmount || 0) || 0;
  const taxRate = getTradeTaxRate(trade);
  const listingTax =
    row.listingTax != null && row.listingTax !== ""
      ? parseFloat(row.listingTax) || 0
      : listingAmount * taxRate;
  const sellingTax =
    row.sellingTax != null && row.sellingTax !== ""
      ? parseFloat(row.sellingTax) || 0
      : sellingAmount * taxRate;
  return listingAmount + sellingAmount + listingTax + sellingTax;
};

/** Name entered on Confirm Payment when deposit < total commission (finalize). */
const parseFinalizeReceivedFrom = (description) => {
  if (!description) return "";
  const dashMatch = description.match(/\s-\sReceived From:\s*(.+?)\s*$/i);
  if (dashMatch) return dashMatch[1].trim();
  const match = description.match(/Received From:\s*([^-]+?)(?:\s*-|$)/i);
  return match ? match[1].trim() : "";
};

const isFinalizeBalancePaymentEntry = (entry) => {
  const desc = entry?.description || "";
  if (!desc || !/received\s+from:/i.test(desc)) return false;
  if (/commission trust/i.test(desc)) return false;
  return desc.includes(" - Received From:");
};

/**
 * Builder name = "Received From" on the finalize balance payment (deposit < total commission).
 * Must not use trust deposit payee / trustRecords.receivedFrom.
 */
async function resolveBuilderNameFromFinalize(trade) {
  const tradeNumber = String(
    trade.tradeNumber || trade.keyInfo?.tradeNumber || "",
  );
  const trustAmount = getTrustDepositAmount(trade);
  const totalCommission = getTotalCommissionAmount(trade);

  if (totalCommission <= 0 || trustAmount >= totalCommission) {
    return {
      builderName: "",
      source: null,
      requiresBalancePayment: false,
      message:
        "Builder name applies when trust deposit is less than total commission and finalize records Received From.",
    };
  }

  const tnEscaped = tradeNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tradeNumPattern = new RegExp(`Trade\\s*#:?\\s*${tnEscaped}`, "i");

  const entries = await Ledger.find({
    accountNumber: "10004",
    debit: { $gt: 0 },
    description: { $regex: /Received\s+From:/i },
    $or: [{ tradeNumber }, { description: tradeNumPattern }],
  }).sort({ createdAt: -1 });

  const balanceEntries = entries.filter(isFinalizeBalancePaymentEntry);

  const pick =
    balanceEntries.find((e) => e.description.includes(" - Received From:")) ||
    balanceEntries[0];

  const calculatedShortfall =
    Math.round((totalCommission - trustAmount) * 100) / 100;

  const suggestedRepaymentAmount =
    pick && Number(pick.debit) > 0
      ? Math.round(Number(pick.debit) * 100) / 100
      : calculatedShortfall;

  if (pick) {
    const builderName = parseFinalizeReceivedFrom(pick.description);
    if (builderName) {
      return {
        builderName,
        source: "finalizeBalancePayment",
        requiresBalancePayment: true,
        suggestedRepaymentAmount,
        calculatedShortfall,
      };
    }
  }

  return {
    builderName: "",
    source: null,
    requiresBalancePayment: true,
    suggestedRepaymentAmount: calculatedShortfall,
    calculatedShortfall,
    message:
      "No Received From found on finalize balance payment. Complete trade finalize Confirm Payment first.",
  };
}

module.exports = {
  resolveBuilderNameFromFinalize,
  getTrustDepositAmount,
  getTotalCommissionAmount,
};
