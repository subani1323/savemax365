import { getTradeTaxRate } from "../constants/tax";
import { roundTo2 } from "./numberUtils";

export const TRUST_ACTIVITY_EXCLUDED_EFT_TYPES = new Set([
  "BuilderRepayment",
  "GeneralToCommissionTransfer",
]);

export function excludeSeparateTrustActivityEfts(efts) {
  return (efts || []).filter(
    (eft) => !TRUST_ACTIVITY_EXCLUDED_EFT_TYPES.has(eft.type),
  );
}

export function filterLedgerEntriesForTrade(allLedgerEntries, trade) {
  const tradeNumber = trade?.tradeNumber || trade?.keyInfo?.tradeNumber;
  if (!tradeNumber) return [];
  return (allLedgerEntries || []).filter(
    (entry) =>
      entry.tradeNumber === tradeNumber ||
      (entry.description &&
        entry.description.includes(`Trade #: ${tradeNumber}`)),
  );
}

function eftKey(eft) {
  const n = eft?.eftNumber;
  if (n == null || n === "") return "";
  return String(n)
    .replace(/^EFT#?/i, "")
    .trim();
}

function extractReceivedFrom(description, payee) {
  if (payee) return String(payee).trim();
  if (!description) return "";
  const match = String(description).match(
    /Received From:\s*([^-]+?)(?:\s*-|$)/i,
  );
  return match ? match[1].trim() : "";
}

/** Ledger Dr 10004 finalize / balance cash (not RE→CT Commission Trust transfers). */
function isFinalizeCashLedgerEntry(entry, excludeEftNumbers = new Set()) {
  if (!entry || entry.accountNumber !== "10004") return false;
  if (!(Number(entry.debit) > 0)) return false;
  const desc = entry.description || "";
  if (!/Received From:/i.test(desc)) return false;
  if (/commission trust/i.test(desc)) return false;
  const key = eftKey({
    eftNumber: entry.eftNumber || entry.reference?.replace(/^EFT#?/i, ""),
  });
  if (key && excludeEftNumbers.has(key)) return false;
  return true;
}

function ledgerEntryToCommissionReceived(entry) {
  const recipient =
    extractReceivedFrom(entry.description, entry.payee) || "N/A";
  const rawEft =
    entry.eftNumber ||
    (entry.reference ? String(entry.reference).replace(/^EFT#?/i, "") : "");
  return {
    eftNumber: rawEft,
    date: entry.date || entry.chequeDate,
    chequeDate: entry.chequeDate || entry.date,
    amount: entry.debit || entry.amount,
    recipient,
    type: "CommissionTransfer",
    description: "Commission Received",
    _id: entry._id ? `ledger-${entry._id}` : `ledger-${rawEft || Date.now()}`,
    _fromLedger: true,
  };
}

function asCommissionReceivedRow(eft) {
  return {
    ...eft,
    type:
      eft.type === "CommissionReceived"
        ? "CommissionReceived"
        : "CommissionTransfer",
    description: "Commission Received",
  };
}

/**
 * Same commission-trust rows as Trade Details → Commission Trust Activity.
 * Always surfaces finalize / 4000-series "Commission Received" cash (ledger or EFT),
 * matching Real Estate Trust Commission Transfer rows when present.
 */
export function buildDisplayCommissionTrustEfts(
  trade,
  realEstateTrustEFTs,
  commissionTrustEFTs,
  ledgerEntries,
) {
  const basePayouts = [...(commissionTrustEFTs || [])];
  const normalizedClassification = String(trade?.keyInfo?.classification || "")
    .toUpperCase()
    .trim();

  const reTransfer = (realEstateTrustEFTs || []).find(
    (eft) => eft.type === "CommissionTransfer",
  );

  const excludeEftNumbers = new Set();
  if (reTransfer) excludeEftNumbers.add(eftKey(reTransfer));

  // CT rows already stored as Commission Received
  const ctReceivedRows = basePayouts.filter(
    (eft) =>
      eft.type === "CommissionReceived" ||
      (eft.description &&
        /commission received/i.test(eft.description) &&
        eft.type !== "OutsideBrokerCommission" &&
        eft.type !== "AgentCommissionTransfer" &&
        eft.type !== "OurBrokerageCommission"),
  );
  ctReceivedRows.forEach((eft) => {
    const k = eftKey(eft);
    if (k) excludeEftNumbers.add(k);
  });

  // Finalize Confirm Payment → Dr 10004 "Received From:" (EFT 4000 series typically)
  const ledgerReceipts = (ledgerEntries || [])
    .filter((entry) => isFinalizeCashLedgerEntry(entry, excludeEftNumbers))
    .map(ledgerEntryToCommissionReceived);

  ledgerReceipts.forEach((eft) => {
    const k = eftKey(eft);
    if (k) excludeEftNumbers.add(k);
  });

  // Prefer stored CT CommissionReceived; fall back to ledger synthesis
  const incoming = [];

  if (reTransfer) {
    incoming.push(asCommissionReceivedRow(reTransfer));
  }

  for (const row of ctReceivedRows) {
    const k = eftKey(row);
    if (k && incoming.some((e) => eftKey(e) === k)) continue;
    incoming.push(asCommissionReceivedRow(row));
  }

  for (const row of ledgerReceipts) {
    const k = eftKey(row);
    if (k && incoming.some((e) => eftKey(e) === k)) continue;
    // Also skip if same amount already covered by RE transfer alone? Keep both when different EFTs.
    incoming.push(row);
  }

  // Listing / ADE: optional trust-record fallback when ledger missing but deposits short
  if (
    !ledgerReceipts.length &&
    !ctReceivedRows.length &&
    (normalizedClassification === "LISTING SIDE" ||
      normalizedClassification === "AGENT DOUBLE ENDER" ||
      normalizedClassification === "AGENT DOUBLLE ENDER")
  ) {
    const trustRecords = trade?.trustRecords || [];
    const commissionIncome = trade?.commission?.commissionIncomeRows?.[0] || {};
    const listingAmount = commissionIncome.listingAmount
      ? parseFloat(commissionIncome.listingAmount)
      : 0;
    const sellingAmount = commissionIncome.sellingAmount
      ? parseFloat(commissionIncome.sellingAmount)
      : 0;
    const taxRateForTrust = getTradeTaxRate(trade);
    const totalCommission = roundTo2(
      listingAmount +
        sellingAmount +
        roundTo2(listingAmount * taxRateForTrust) +
        roundTo2(sellingAmount * taxRateForTrust),
    );
    const trustAmount = trustRecords.reduce((sum, record) => {
      const amount = parseFloat(
        record.amount || record.depositAmount || record.total || 0,
      );
      return sum + amount;
    }, 0);

    if (trustAmount < totalCommission) {
      const receivedFromRecord = trustRecords.find(
        (record) => record.receivedFrom && record.paymentType === "EFT",
      );
      if (receivedFromRecord) {
        const eftNumber =
          receivedFromRecord.reference?.replace(/^EFT#?/i, "") ||
          receivedFromRecord.eftNumber ||
          "";
        if (!eftNumber || !excludeEftNumbers.has(String(eftNumber))) {
          incoming.push({
            eftNumber,
            date: receivedFromRecord.depositDate || receivedFromRecord.date,
            chequeDate:
              receivedFromRecord.depositDate || receivedFromRecord.date,
            amount: parseFloat(
              receivedFromRecord.amount ||
                receivedFromRecord.depositAmount ||
                receivedFromRecord.total ||
                0,
            ),
            recipient: receivedFromRecord.receivedFrom || "",
            type: "CommissionTransfer",
            description: "Commission Received",
            _id: `balance-${receivedFromRecord._id || Date.now()}`,
          });
        }
      }
    }
  }

  // Co-op heuristic: CT row that looks like received commission (legacy)
  if (!incoming.length && normalizedClassification === "CO-OPERATING SIDE") {
    const heuristic = basePayouts.find(
      (eft) =>
        eft.description &&
        (eft.description.includes("Received From") ||
          eft.description.includes("Received from") ||
          /Received From:.*Commission Trust/i.test(eft.description) ||
          eft.description.includes("Commission Received")),
    );
    if (heuristic) {
      incoming.push(asCommissionReceivedRow(heuristic));
    } else {
      const byRecipient = basePayouts.find(
        (eft) =>
          eft.recipient &&
          (eft.recipient.includes("HomeLife") ||
            eft.recipient.includes("Future Realty") ||
            eft.recipient.includes("Realty Inc")),
      );
      if (byRecipient) incoming.push(asCommissionReceivedRow(byRecipient));
    }
  }

  const incomingIds = new Set(
    incoming.map((e) => String(e._id || "")).filter(Boolean),
  );
  const incomingKeys = new Set(incoming.map(eftKey).filter(Boolean));

  const remainingPayouts = basePayouts.filter((eft) => {
    if (eft.type === "CommissionReceived") return false;
    if (eft._id && incomingIds.has(String(eft._id))) return false;
    const k = eftKey(eft);
    if (k && incomingKeys.has(k)) return false;
    if (
      eft.description &&
      /commission received/i.test(eft.description) &&
      eft.type !== "OutsideBrokerCommission" &&
      eft.type !== "AgentCommissionTransfer" &&
      eft.type !== "OurBrokerageCommission"
    ) {
      return false;
    }
    return true;
  });

  return [...incoming, ...remainingPayouts];
}
