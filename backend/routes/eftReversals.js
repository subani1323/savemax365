const express = require("express");
const router = express.Router();
const Trade = require("../models/Trade");
const Agent = require("../models/Agent");
const Ledger = require("../models/Ledger");
const EFTReversal = require("../models/EFTReversal");
const { RealEstateTrustEFT } = require("../models/RealEstateTrustEFT");
const { CommissionTrustEFT } = require("../models/CommissionTrustEFT");
const { GeneralAccountEFT } = require("../models/GeneralAccountEFT");

const getSectionModel = (section) => {
  if (section === "real-estate") return RealEstateTrustEFT;
  if (section === "commission") return CommissionTrustEFT;
  if (section === "general") return GeneralAccountEFT;
  return null;
};

const getSectionLedgerAccount = (section) => {
  if (section === "real-estate") return "10002";
  if (section === "commission") return "10004";
  if (section === "general") return "10001";
  return null;
};

const COMMISSION_REVERSAL_CREDIT_BY_ACCOUNT = {
  "21100": {
    accountNumber: "21100",
    accountName: "A/P - Other Brokers & Referrals",
  },
  "21400": {
    accountNumber: "21400",
    accountName: "Liability to Builder",
  },
  "10001": {
    accountNumber: "10001",
    accountName: "CASH - CURRENT ACCOUNT",
  },
  "21500": {
    accountNumber: "21500",
    accountName: "Commission Payable",
  },
};

const isOutsideBrokerCommissionEft = (commissionEftType, sourceDescription) => {
  if (commissionEftType === "OutsideBrokerCommission") {
    return true;
  }
  const desc = String(sourceDescription || "").toLowerCase();
  return /outside\s+broker/i.test(desc);
};

const isBuilderRepaymentEft = (commissionEftType, sourceDescription) => {
  if (commissionEftType === "BuilderRepayment") return true;
  return /builder\s+repayment/i.test(String(sourceDescription || ""));
};

const isOfficeTransferCommissionEft = (commissionEftType, sourceDescription) => {
  if (
    commissionEftType === "GeneralToCommissionTransfer" ||
    commissionEftType === "OurBrokerageCommission"
  ) {
    return true;
  }
  const desc = String(sourceDescription || "").toLowerCase();
  return (
    /office\s+share/i.test(desc) ||
    /transfer\s+office/i.test(desc) ||
    /our\s+brokerage/i.test(desc)
  );
};

const getReversalLedgerPosting = (
  section,
  commissionEftType,
  sourceDescription = "",
) => {
  if (section === "real-estate") {
    return {
      debit: { accountNumber: "10002", accountName: "CASH - TRUST" },
      credit: {
        accountNumber: "21300",
        accountName: "LIABILITY FOR TRUST FUNDS HELD",
      },
    };
  }
  if (section === "commission") {
    const debit = {
      accountNumber: "10004",
      accountName: "CASH - COMMISSION TRUST ACCOUNT",
    };
    let credit;
    if (isBuilderRepaymentEft(commissionEftType, sourceDescription)) {
      credit = COMMISSION_REVERSAL_CREDIT_BY_ACCOUNT["21400"];
    } else if (isOutsideBrokerCommissionEft(commissionEftType, sourceDescription)) {
      credit = COMMISSION_REVERSAL_CREDIT_BY_ACCOUNT["21100"];
    } else if (isOfficeTransferCommissionEft(commissionEftType, sourceDescription)) {
      credit = COMMISSION_REVERSAL_CREDIT_BY_ACCOUNT["10001"];
    } else {
      credit = COMMISSION_REVERSAL_CREDIT_BY_ACCOUNT["21500"];
    }
    return { debit, credit };
  }
  if (section === "general") {
    return {
      debit: { accountNumber: "10001", accountName: "CASH - CURRENT ACCOUNT" },
      credit: { accountNumber: "21000", accountName: "ACCOUNTS PAYABLE" },
    };
  }
  if (section === "deposit-received") {
    return {
      debit: {
        accountNumber: "12101",
        accountName: "A/R - Agt's Recoverable - Commission",
      },
      credit: {
        accountNumber: "10004",
        accountName: "CASH - COMMISSION TRUST ACCOUNT",
      },
    };
  }
  return null;
};

const extractDepositEftNumber = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  // Prefer explicit EFT# format, but accept a numeric string too.
  const eftMatch = raw.match(/EFT#?\s*(\d+)/i);
  if (eftMatch) return eftMatch[1];

  if (/^\d+$/.test(raw)) return raw;
  return null;
};

const payeeFromDepositDescription = (description) => {
  const text = String(description || "");
  const match = text.match(/Received\s+From:\s*(.+?)(?:\s*-\s*|$)/i);
  return match ? match[1].trim() : "";
};

const tradeNumberForDepositLookup = (trade) =>
  String(trade?.tradeNumber || trade?.keyInfo?.tradeNumber || "").trim();

const isFinalizeDepositReceivedLedgerRow = (row, tradeNumber) => {
  if (!row || row.accountNumber !== "10004") return false;
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  if (debit <= 0 && credit <= 0) return false;

  const description = String(row.description || "");
  if (!/received\s+from/i.test(description)) return false;
  // Commission transfer RE trust → commission trust uses 10004 Dr but is not a finalize deposit payment.
  if (/commission\s+trust/i.test(description)) return false;

  if (!tradeNumber) return true;
  const escaped = tradeNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`Trade\\s*#:\\s*${escaped}\\b`, "i").test(description);
};

/** Trial balance / ledger reference for finalize-batch reversal lines (e.g. REV#354). */
const finalizeReversalLedgerRef = (tradeNumber) =>
  `REV#${String(tradeNumber || "").replace(/\s+/g, "")}`;

/**
 * On finalize-batch reverse only (not on original finalize posting):
 * - Original Debit 12200 → reverse against 21400 (Liability to Builder)
 * - Original Credit 12200 → reverse against 12101 (A/R - Agt's Recoverable - Commission)
 */
const mapFinalizeReversalAccount = (line) => {
  const acct = String(line?.accountNumber || "").trim();
  if (acct !== "12200") {
    return {
      accountNumber: line.accountNumber,
      accountName: line.accountName,
    };
  }
  const wasDebit = (parseFloat(line.debit) || 0) > 0;
  const wasCredit = (parseFloat(line.credit) || 0) > 0;
  if (wasDebit) {
    return {
      accountNumber: "21400",
      accountName: "Liability to Builder",
    };
  }
  if (wasCredit) {
    return {
      accountNumber: "12101",
      accountName: "A/R - Agt's Recoverable - Commission",
    };
  }
  return {
    accountNumber: line.accountNumber,
    accountName: line.accountName,
  };
};

/** Build flipped + remapped ledger lines for a finalize (deposit-received) reversal. */
const buildFinalizeReversalLedgerLines = (finalizeLines) =>
  (finalizeLines || []).map((line) => {
    const mapped = mapFinalizeReversalAccount(line);
    return {
      accountNumber: mapped.accountNumber,
      accountName: mapped.accountName,
      debit: parseFloat(line.credit) || 0,
      credit: parseFloat(line.debit) || 0,
      description: line.description,
    };
  });

const isExcludedFromFinalizeReversalLedger = (row) => {
  const desc = String(row.description || "");
  const eft = String(row.eftNumber || "").trim();
  if (/^REV$/i.test(eft)) return true;
  if (/^REV-/i.test(eft)) return true;
  if (/^REV#/i.test(eft)) return true;
  if (/finalize\s+reversal/i.test(desc)) return true;
  const excludePatterns = [
    /builder\s+repayment/i,
    /commission\s+recalled/i,
    /commission\s+transfer\s+from\s+general/i,
    /general\s+to\s+commission/i,
    /deposit\s+received\s+reversal/i,
    /eft\s+reversal/i,
    /paid\s+to:/i,
  ];
  return excludePatterns.some((p) => p.test(desc));
};

const ledgerRowMatchesTrade = (row, tradeNumber) => {
  if (!row || !tradeNumber) return false;
  if (
    row.tradeNumber != null &&
    String(row.tradeNumber).trim() === String(tradeNumber).trim()
  ) {
    return true;
  }
  const escaped = String(tradeNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`Trade\\s*#:?\\s*${escaped}\\b`, "i").test(
    String(row.description || ""),
  );
};

/** Match original commission payment debit (21100 / 21400 / 10001 / 21500) for reversal credit. */
const inferCommissionReversalCreditFromLedger = async (
  sourceEftNumber,
  tradeNumber,
) => {
  const raw = String(sourceEftNumber || "").trim();
  if (!raw) return null;

  const eftMatchers = new Set([raw]);
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    eftMatchers.add(numeric);
    eftMatchers.add(String(numeric));
  }

  const rows = await Ledger.find({
    $or: Array.from(eftMatchers).map((eft) => ({ eftNumber: eft })),
  }).lean();

  const priority = ["21400", "21100", "10001", "21500"];
  for (const accountNumber of priority) {
    const hit = rows.find((row) => {
      if (row.accountNumber !== accountNumber) return false;
      if ((parseFloat(row.debit) || 0) <= 0) return false;
      if (tradeNumber && !ledgerRowMatchesTrade(row, tradeNumber)) return false;
      return true;
    });
    if (hit) {
      return (
        COMMISSION_REVERSAL_CREDIT_BY_ACCOUNT[accountNumber] || {
          accountNumber: hit.accountNumber,
          accountName: hit.accountName,
        }
      );
    }
  }
  return null;
};

/** Ledger lines posted at trade finalization (transaction details), excluding later modules. */
const getFinalizeTransactionLines = async (trade) => {
  const tradeNumber = tradeNumberForDepositLookup(trade);
  if (!tradeNumber) return [];

  const escaped = tradeNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tradeDescRegex = new RegExp(`Trade\\s*#:?\\s*${escaped}\\b`, "i");

  const rows = await Ledger.find({
    $or: [{ tradeNumber }, { description: tradeDescRegex }],
  })
    .sort({ createdAt: 1 })
 

  return rows
    .filter((row) => {
      if (!ledgerRowMatchesTrade(row, tradeNumber)) return false;
      if (isExcludedFromFinalizeReversalLedger(row)) return false;
      const debit = parseFloat(row.debit) || 0;
      const credit = parseFloat(row.credit) || 0;
      return debit > 0 || credit > 0;
    })
    .map((row) => ({
      ledgerId: String(row._id),
      date: row.date || row.chequeDate || null,
      accountNumber: row.accountNumber,
      accountName: row.accountName,
      debit: parseFloat(row.debit) || 0,
      credit: parseFloat(row.credit) || 0,
      description: String(row.description || "").trim(),
    }));
};

/** Commission trust cash received at trade finalization (10004 Dr / 12200 Cr). */
const getFinalizeDepositLedgerCandidates = async (trade) => {
  const tradeNumber = tradeNumberForDepositLookup(trade);
  if (!tradeNumber) return [];

  const escaped = tradeNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tradeDescRegex = new RegExp(`Trade\\s*#:\\s*${escaped}\\b`, "i");

  const ledgerRows = await Ledger.find({
    accountNumber: "10004",
    $or: [{ debit: { $gt: 0 } }, { credit: { $gt: 0 } }],
    description: tradeDescRegex,
  })
    .sort({ createdAt: -1 })
    .lean();

  const byEft = new Map();
  for (const row of ledgerRows) {
    if (!isFinalizeDepositReceivedLedgerRow(row, tradeNumber)) continue;

    const rawEft = String(row.eftNumber || "").trim();
    if (!rawEft || /^REV/i.test(rawEft)) continue;

    const eftNumber = extractDepositEftNumber(rawEft) || rawEft;
    const amount = Math.max(
      parseFloat(row.debit) || 0,
      parseFloat(row.credit) || 0,
    );
    if (amount <= 0) continue;

    const recipient = payeeFromDepositDescription(row.description);
    const existing = byEft.get(eftNumber);
    if (!existing || amount > existing.amount) {
      byEft.set(eftNumber, {
        eftNumber,
        amount,
        recipient,
        date: row.date || row.chequeDate || "",
        type: "DepositReceived",
        description: String(row.description || "").trim(),
        reference: row.reference || "",
      });
    }
  }

  return Array.from(byEft.values());
};

const getTrustDepositEftCandidates = async (trade) => {
  if (!trade?._id) return [];

  const trustEfts = await RealEstateTrustEFT.find({
    tradeId: trade._id,
    type: "TrustDeposit",
  })
    .sort({ createdAt: -1 })
    .lean();

  return trustEfts.map((eft) => ({
    eftNumber: String(eft.eftNumber),
    amount: parseFloat(eft.amount) || 0,
    recipient: eft.recipient || "",
    date: eft.date || eft.chequeDate || "",
    type: "TrustDeposit",
    description: eft.description || "",
    reference: "",
  }));
};

const getDepositCandidatesForTrade = async (trade) => {
  const isFinalized = Boolean(trade?.keyInfo?.finalizedDate);

  // Finalized trades: use commission-trust payment posted at finalize (e.g. 10004 Dr $3020), not trust form amount.
  const ledgerCandidates = await getFinalizeDepositLedgerCandidates(trade);
  if (isFinalized) {
    return ledgerCandidates.filter((c) => c.amount > 0);
  }

  if (ledgerCandidates.length > 0) {
    return ledgerCandidates;
  }

  // Not finalized yet: trust deposit EFTs (real EFT numbers from Real Estate Trust).
  const trustEftCandidates = await getTrustDepositEftCandidates(trade);
  if (trustEftCandidates.length > 0) {
    return trustEftCandidates.filter((c) => c.amount > 0);
  }

  // Fallback: trust tab rows when EFT record is missing (resolve EFT from reference if present).
  const records = trade?.trustRecords || [];
  const fallback = [];
  records.forEach((record, index) => {
    const amount = parseFloat(record?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const receivedFlag = String(record?.received || "").toLowerCase();
    const weHold = String(record?.weHold || "").toLowerCase();
    if (receivedFlag !== "yes" && weHold !== "yes") return;

    const eftNumber =
      extractDepositEftNumber(record?.eftNumber || record?.reference) ||
      resolveDepositEftNumber(record);
    if (!eftNumber) return;

    fallback.push({
      eftNumber: String(eftNumber),
      amount,
      recipient: record?.receivedFrom || "",
      date: record?.depositDate || "",
      type: "DepositReceived",
      description:
        record?.receivedFrom && record?.reference
          ? `Deposit from ${record.receivedFrom}, Ref: ${record.reference}`
          : record?.receivedFrom
            ? `Deposit from ${record.receivedFrom}`
            : "Deposit received",
      reference: record?.reference || "",
      depositIndex: index,
    });
  });

  return fallback;
};

/** EFT Reversal page description + source EFT# (same style as single-deposit reversal). */
const getDepositReceivedReversalMeta = async (trade) => {
  const deposits = await getFinalizeDepositLedgerCandidates(trade);
  const primary =
    deposits.length > 0
      ? deposits.reduce((best, row) =>
          (parseFloat(row.amount) || 0) > (parseFloat(best.amount) || 0)
            ? row
            : best,
        )
      : null;

  const tradeNumber = tradeNumberForDepositLookup(trade);
  const sourceEftNumber = primary?.eftNumber
    ? String(primary.eftNumber)
    : "0";

  let description = String(primary?.description || "").trim();
  let payee = String(primary?.recipient || "").trim();
  if (!payee) payee = payeeFromDepositDescription(description);

  if (!description && tradeNumber) {
    const street = [
      trade?.keyInfo?.streetNumber,
      trade?.keyInfo?.streetName,
      trade?.keyInfo?.unit,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    description = `Trade #: ${tradeNumber}${street ? ` - ${street}` : ""}`;
    if (payee) {
      description = `${description} - Received From: ${payee}`;
    }
  } else if (payee && !description.toLowerCase().includes(payee.toLowerCase())) {
    description = `${description} - ${payee}`;
  }

  return { sourceEftNumber, description, payee, amount: parseFloat(primary?.amount) || 0 };
};

const decodeDepositSourceId = (sourceEftNumber) => {
  const match = String(sourceEftNumber || "").match(/^DEP-(\d+)$/i);
  return match ? Number(match[1]) : null;
};

const resolveDepositEftNumber = (record) => {
  if (!record) return null;
  if (record.eftNumber != null && String(record.eftNumber).trim() !== "") {
    return String(record.eftNumber).trim();
  }
  const ref = String(record.reference || "").trim();
  const match = ref.match(/EFT#?\s*(\d+)/i);
  if (match) return match[1];
  if (/^\d+$/.test(ref)) return ref;
  return null;
};

const getAgentNameFromId = async (agentId) => {
  if (!agentId) return "";
  try {
    const agent = await Agent.findById(agentId).select("firstName lastName");
    if (!agent) return "";
    return [agent.firstName, agent.lastName].filter(Boolean).join(" ").trim();
  } catch (error) {
    return "";
  }
};

const getSourceDescription = async (section, sourceEftNumber, tradeNumber) => {
  const Model = getSectionModel(section);
  if (!Model) return "";
  const sourceNumber = Number(sourceEftNumber);
  const sourceString = String(sourceEftNumber);

  const source = await Model.findOne({
    eftNumber: sourceNumber,
  }).select("description");

  if (source?.description && String(source.description).trim()) {
    return String(source.description).trim();
  }

  const accountNumber = getSectionLedgerAccount(section);
  if (!accountNumber) return "";

  // Prefer the same cash account row for that section.
  const ledgerRow = await Ledger.findOne({
    accountNumber,
    eftNumber: { $in: [sourceString, sourceNumber] },
  })
    .sort({ createdAt: -1 })
    .select("description");

  if (ledgerRow?.description) {
    return String(ledgerRow.description).trim();
  }

  // Fallback: any ledger row with matching EFT number (older rows can vary).
  const fallbackRow = await Ledger.findOne({
    eftNumber: { $in: [sourceString, sourceNumber] },
  })
    .sort({ createdAt: -1 })
    .select("description");

  if (fallbackRow?.description) {
    return String(fallbackRow.description).trim();
  }

  // Last fallback: look up by reference formatted as EFT#<number>.
  const referenceRow = await Ledger.findOne({
    accountNumber,
    reference: `EFT#${sourceString}`,
  }).select("description");

  if (referenceRow?.description) {
    return String(referenceRow.description).trim();
  }

  // Older data fallback: match description text containing EFT number.
  const descRegex = new RegExp(`EFT\\s*#?\\s*${sourceString}\\b`, "i");
  const tradeRegex =
    tradeNumber != null && tradeNumber !== ""
      ? new RegExp(`Trade\\s*#:\\s*${String(tradeNumber)}`, "i")
      : null;

  const textMatchRow = await Ledger.findOne({
    ...(accountNumber ? { accountNumber } : {}),
    $or: [{ description: descRegex }, { reference: descRegex }],
    ...(tradeRegex ? { description: tradeRegex } : {}),
  })
    .sort({ createdAt: -1 })
    .select("description");

  return textMatchRow?.description
    ? String(textMatchRow.description).trim()
    : "";
};

const getSourceDescriptionWithPayee = async (
  section,
  sourceEftNumber,
  tradeNumber,
) => {
  const Model = getSectionModel(section);
  if (!Model) return { description: "", payee: "" };

  const sourceNumber = Number(sourceEftNumber);

  // Get both description and recipient (payee) from the source EFT
  const source = await Model.findOne({
    eftNumber: sourceNumber,
  }).select("description recipient agentName agentId");

  const description =
    source?.description && String(source.description).trim()
      ? String(source.description).trim()
      : "";

  let payee = "";
  // For commission transactions, prioritize agentName then recipient then agentId-derived name
  if (section === "commission") {
    if (source?.agentName && String(source.agentName).trim()) {
      payee = String(source.agentName).trim();
    } else if (source?.recipient && String(source.recipient).trim()) {
      payee = String(source.recipient).trim();
    } else if (source?.agentId && String(source.agentId).trim()) {
      const agentName = await getAgentNameFromId(source.agentId);
      if (agentName) payee = agentName;
    }
  } else {
    // For other sections, use recipient and fall back to agentId if available
    if (source?.recipient && String(source.recipient).trim()) {
      payee = String(source.recipient).trim();
    } else if (source?.agentId && String(source.agentId).trim()) {
      const agentName = await getAgentNameFromId(source.agentId);
      if (agentName) payee = agentName;
    }
  }

  if (description || payee) {
    return { description, payee };
  }

  // Fallback to getSourceDescription if no direct match
  const fallbackDescription = await getSourceDescription(
    section,
    sourceEftNumber,
    tradeNumber,
  );
  return { description: fallbackDescription, payee: "" };
};

router.get("/", async (req, res) => {
  try {
    const { tradeId, section, invoiceNumber } = req.query;
    const query = {};
    if (tradeId) query.tradeId = tradeId;
    if (section) query.section = section;
    if (invoiceNumber) query.invoiceNumber = String(invoiceNumber);

    const reversals = await EFTReversal.find(query)
      .sort({ reversedAt: -1 })
      .populate("tradeId");
    const enriched = await Promise.all(
      reversals.map(async (r) => {
        const row = r.toObject();

        // Backfill chequeDate from ledger if missing (older reversal docs)
        if (!row.chequeDate && row.sourceEftNumber) {
          let ledgerRev = null;
          if (row.section === "deposit-received" && row.tradeNumber) {
            ledgerRev = await Ledger.findOne({
              eftNumber: finalizeReversalLedgerRef(row.tradeNumber),
              tradeNumber: row.tradeNumber,
            })
              .sort({ createdAt: -1 })
              .select("chequeDate");
            if (!ledgerRev?.chequeDate && /^FINALIZE-/i.test(String(row.sourceEftNumber))) {
              const legacyRef = `REV-FIN-${String(row.tradeNumber || "").replace(/\s+/g, "")}`;
              ledgerRev = await Ledger.findOne({ eftNumber: legacyRef })
                .sort({ createdAt: -1 })
                .select("chequeDate");
            }
          }
          if (!ledgerRev?.chequeDate) {
            const revRef = `REV-${row.sourceEftNumber}`;
            ledgerRev = await Ledger.findOne({ eftNumber: revRef })
              .sort({ createdAt: -1 })
              .select("chequeDate");
          }
          if (ledgerRev?.chequeDate) {
            row.chequeDate = ledgerRev.chequeDate;
          }
        }

        if (row.section === "deposit-received" && row.tradeId) {
          const tradeForMeta = await Trade.findById(row.tradeId).select(
            "tradeNumber keyInfo trustRecords",
          );
          if (tradeForMeta) {
            const meta = await getDepositReceivedReversalMeta(tradeForMeta);
            if (meta.amount > 0) {
              row.amount = Math.round(meta.amount * 100) / 100;
            }
            if (/^FINALIZE-/i.test(String(row.sourceEftNumber))) {
              if (meta.sourceEftNumber) {
                row.sourceEftNumber = meta.sourceEftNumber;
              }
              if (meta.description) {
                row.description = meta.description;
              }
            }
          }
        }

        if (row.section === "deposit-received" && row.sourceEftNumber) {
          if (/^FINALIZE-/i.test(String(row.sourceEftNumber))) {
            // FINALIZE-* legacy rows handled above via meta
          } else {
            const legacyDepIndex = decodeDepositSourceId(row.sourceEftNumber);
            if (legacyDepIndex != null && row.tradeId) {
              const trade = await Trade.findById(row.tradeId).select(
                "trustRecords tradeNumber keyInfo",
              );
              if (trade?.trustRecords?.[legacyDepIndex]) {
                const resolvedEft = resolveDepositEftNumber(
                  trade.trustRecords[legacyDepIndex],
                );
                if (resolvedEft) {
                  row.sourceEftNumber = resolvedEft;
                }
              }
            } else if (
              /^DEP-/i.test(String(row.sourceEftNumber)) &&
              row.tradeId
            ) {
              const trade = await Trade.findById(row.tradeId).select(
                "tradeNumber keyInfo",
              );
              const ledgerMatch =
                await getFinalizeDepositLedgerCandidates(trade);
              if (ledgerMatch[0]?.eftNumber) {
                row.sourceEftNumber = ledgerMatch[0].eftNumber;
              }
            }
          }
        }

        const looksLikeReversalText = String(row.description || "").includes(
          "EFT reversal",
        );
        if (!row.description || looksLikeReversalText) {
          if (row.section && row.sourceEftNumber) {
            let enrichedDescription = "";
            if (row.section === "general") {
              const generalEFT = await GeneralAccountEFT.findOne({
                eftNumber: Number(row.sourceEftNumber),
              }).select("description recipient");
              enrichedDescription = String(
                generalEFT?.description || "",
              ).trim();
              const payee = String(generalEFT?.recipient || "").trim();
              if (payee) {
                enrichedDescription = enrichedDescription
                  ? `${enrichedDescription} - ${payee}`
                  : payee;
              }
            } else if (row.section === "commission") {
              const commissionEFT = await CommissionTrustEFT.findOne({
                eftNumber: Number(row.sourceEftNumber),
              }).select("description recipient agentName");
              enrichedDescription = String(
                commissionEFT?.description || "",
              ).trim();
              // For commission, prioritize agentName
              let payee = String(commissionEFT?.agentName || "").trim();
              if (!payee) {
                payee = String(commissionEFT?.recipient || "").trim();
              }
              if (payee) {
                enrichedDescription = enrichedDescription
                  ? `${enrichedDescription} - ${payee}`
                  : payee;
              }
            } else {
              const { description, payee } =
                await getSourceDescriptionWithPayee(
                  row.section,
                  row.sourceEftNumber,
                  row.tradeNumber,
                );
              enrichedDescription = description;
              if (payee) {
                enrichedDescription = enrichedDescription
                  ? `${enrichedDescription} - ${payee}`
                  : payee;
              }
            }
            if (enrichedDescription) {
              row.description = enrichedDescription;
            }
          }
        }
        return row;
      }),
    );
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching EFT reversals:", error);
    res.status(500).json({ message: "Server error while fetching reversals" });
  }
});

router.post("/reverse", async (req, res) => {
  try {
    const {
      section,
      tradeId,
      invoiceNumber,
      sourceEftNumber,
      amount,
      notes,
      reversalDate,
    } = req.body;

    if (section === "deposit-received") {
      if (!tradeId) {
        return res.status(400).json({
          message: "section and tradeId are required",
        });
      }

      const trade = await Trade.findById(tradeId);
      if (!trade) return res.status(404).json({ message: "Trade not found" });

      const tradeNumber = tradeNumberForDepositLookup(trade);

      const existing = await EFTReversal.findOne({
        section,
        tradeId,
      });
      if (existing) {
        return res.status(409).json({
          message:
            "Finalize transactions for this trade are already reversed",
        });
      }

      const finalizeLines = await getFinalizeTransactionLines(trade);
      if (finalizeLines.length === 0) {
        return res.status(404).json({
          message:
            "No finalize transaction lines found on the ledger for this trade",
        });
      }

      const reversalMeta = await getDepositReceivedReversalMeta(trade);

      let parsedReversalDate = new Date();
      if (reversalDate) {
        const date = new Date(reversalDate);
        if (!Number.isNaN(date.getTime())) parsedReversalDate = date;
      }
      const ledgerChequeDate = new Date();

      let totalDebit = 0;
      let totalCredit = 0;

      const reversalLines = buildFinalizeReversalLedgerLines(finalizeLines);

      for (const line of reversalLines) {
        totalDebit += line.debit;
        totalCredit += line.credit;

        await Ledger.create({
          accountNumber: line.accountNumber,
          accountName: line.accountName,
          debit: line.debit,
          credit: line.credit,
          description: line.description,
          eftNumber: finalizeReversalLedgerRef(tradeNumber),
          chequeDate: ledgerChequeDate,
          tradeNumber,
        });
      }

      const displayAmount =
        reversalMeta.amount > 0
          ? reversalMeta.amount
          : finalizeLines
              .filter(
                (line) =>
                  (line.accountNumber === "10004" ||
                    line.accountNumber === "12200") &&
                  /received\s+from/i.test(line.description),
              )
              .reduce(
                (max, line) =>
                  Math.max(max, line.debit || 0, line.credit || 0),
                0,
              );

      const reversal = await EFTReversal.create({
        section,
        tradeId,
        tradeNumber,
        sourceEftNumber: reversalMeta.sourceEftNumber,
        amount: Math.round(displayAmount * 100) / 100,
        description: reversalMeta.description,
        notes: notes || "",
        reversedAt: parsedReversalDate,
        chequeDate: ledgerChequeDate,
      });

      return res.status(201).json({
        message: `Reversed ${finalizeLines.length} finalize transaction(s) for trade #${tradeNumber}`,
        reversal,
        lineCount: finalizeLines.length,
        totalDebit: Math.round(totalDebit * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
      });
    } else if (section === "general") {
      if (!invoiceNumber || !sourceEftNumber || !amount) {
        return res.status(400).json({
          message:
            "section, invoiceNumber, sourceEftNumber and amount are required",
        });
      }
      const existing = await EFTReversal.findOne({
        section,
        invoiceNumber: String(invoiceNumber),
        sourceEftNumber: String(sourceEftNumber),
      });
      if (existing) {
        return res
          .status(409)
          .json({ message: "This EFT is already reversed" });
      }
    } else {
      if (!tradeId || !sourceEftNumber || !amount) {
        return res.status(400).json({
          message: "section, tradeId, sourceEftNumber and amount are required",
        });
      }

      const trade = await Trade.findById(tradeId);
      if (!trade) return res.status(404).json({ message: "Trade not found" });

      const existing = await EFTReversal.findOne({
        section,
        tradeId,
        sourceEftNumber: String(sourceEftNumber),
      });
      if (existing) {
        return res
          .status(409)
          .json({ message: "This EFT is already reversed" });
      }
    }

    const Model = getSectionModel(section);
    if (section !== "deposit-received" && !Model) {
      return res.status(400).json({ message: "Invalid section" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Amount must be greater than 0" });
    }

    // Override should affect reversal date only (display/report), not ledger chequeDate.
    let parsedReversalDate = new Date();
    if (reversalDate) {
      const date = new Date(reversalDate);
      if (!Number.isNaN(date.getTime())) parsedReversalDate = date;
    }
    const ledgerChequeDate = new Date(); // always "today" for ledger

    const reversalRef = `REV-${sourceEftNumber}`;
    let tradeNumber = "";
    if (section !== "general") {
      const trade = await Trade.findById(tradeId).select("tradeNumber");
      tradeNumber = String(trade?.tradeNumber || "");
    }
    const genericReversalDescription =
      section === "general"
        ? `Invoice #: ${String(invoiceNumber)}, EFT reversal (${section}) for EFT#${sourceEftNumber}`
        : section === "deposit-received"
          ? `Trade #: ${tradeNumber}, Deposit received reversal for EFT#${sourceEftNumber}`
          : `Trade #: ${tradeNumber}, EFT reversal (${section}) for EFT#${sourceEftNumber}`;

    let sourceDescription = "";
    let payeeName = "";
    let commissionEftType = "";

    if (section === "deposit-received") {
      return res.status(400).json({
        message:
          "Use deposit-received reversal via trade selection only (no single EFT)",
      });
    } else if (section === "general") {
      const generalEFT = await GeneralAccountEFT.findOne({
        eftNumber: Number(sourceEftNumber),
        invoiceNumber: String(invoiceNumber),
      }).select("description recipient");
      sourceDescription = String(generalEFT?.description || "").trim();
      payeeName = String(generalEFT?.recipient || "").trim();
    } else if (section === "commission") {
      const commissionEFT = await CommissionTrustEFT.findOne({
        eftNumber: Number(sourceEftNumber),
      }).select("description recipient agentName agentId type");
      commissionEftType = String(commissionEFT?.type || "");
      sourceDescription = String(commissionEFT?.description || "").trim();
      // For commission, prioritize agentName
      payeeName = String(commissionEFT?.agentName || "").trim();
      if (!payeeName) {
        payeeName = String(commissionEFT?.recipient || "").trim();
      }
      if (!payeeName && commissionEFT?.agentId) {
        const agentNameFromId = await getAgentNameFromId(commissionEFT.agentId);
        if (agentNameFromId) payeeName = agentNameFromId;
      }
    } else {
      const { description, payee } = await getSourceDescriptionWithPayee(
        section,
        sourceEftNumber,
        tradeNumber,
      );
      sourceDescription = description;
      payeeName = payee;
    }

    // Combine description with payee name if available
    let finalDescription = sourceDescription;
    if (payeeName) {
      if (finalDescription) {
        finalDescription = `${finalDescription} - ${payeeName}`;
      } else {
        finalDescription = payeeName;
      }
    }
    if (!finalDescription) {
      finalDescription = genericReversalDescription;
    }

    // Ledger rows should remain a consistent "reversal" line for Trial Balance / GL views.
    // The original posting text is stored on the EFTReversal record for the EFT Reversal page.
    let ledgerDescription = genericReversalDescription;
    if (payeeName) {
      ledgerDescription = `${genericReversalDescription} - ${payeeName}`;
    }

    let posting = getReversalLedgerPosting(
      section,
      commissionEftType,
      sourceDescription,
    );
    if (section === "commission") {
      const creditFromLedger = await inferCommissionReversalCreditFromLedger(
        sourceEftNumber,
        tradeNumber,
      );
      if (creditFromLedger) {
        posting = {
          debit: {
            accountNumber: "10004",
            accountName: "CASH - COMMISSION TRUST ACCOUNT",
          },
          credit: creditFromLedger,
        };
      }
    }
    if (!posting) {
      return res.status(400).json({ message: "Invalid section" });
    }

    await Ledger.create({
      accountNumber: posting.debit.accountNumber,
      accountName: posting.debit.accountName,
      debit: numericAmount,
      credit: 0,
      description: ledgerDescription,
      eftNumber: reversalRef,
      chequeDate: ledgerChequeDate,
    });

    await Ledger.create({
      accountNumber: posting.credit.accountNumber,
      accountName: posting.credit.accountName,
      debit: 0,
      credit: numericAmount,
      description: ledgerDescription,
      eftNumber: reversalRef,
      chequeDate: ledgerChequeDate,
    });

    const reversalPayload =
      section === "general"
        ? {
            section,
            invoiceNumber: String(invoiceNumber),
            tradeId: undefined,
            tradeNumber: "",
            sourceEftNumber: String(sourceEftNumber),
            amount: numericAmount,
            description: finalDescription,
            notes: notes || "",
            reversedAt: parsedReversalDate,
          }
        : {
            section,
            tradeId,
            tradeNumber,
            sourceEftNumber: String(sourceEftNumber),
            amount: numericAmount,
            description: finalDescription,
            notes: notes || "",
            reversedAt: parsedReversalDate,
          };

    const reversal = await EFTReversal.create(reversalPayload);

    res.status(201).json({
      message: "EFT reversed successfully",
      reversal,
      ledgerPosting: {
        debitAccount: posting.debit.accountNumber,
        creditAccount: posting.credit.accountNumber,
      },
    });
  } catch (error) {
    console.error("Error reversing EFT:", error);
    res.status(500).json({ message: "Server error while reversing EFT" });
  }
});

router.get("/finalize-transactions/:tradeId", async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.tradeId);
    if (!trade) return res.status(404).json({ message: "Trade not found" });

    const tradeNumber = tradeNumberForDepositLookup(trade);
    const lines = await getFinalizeTransactionLines(trade);
    const reversalLines = buildFinalizeReversalLedgerLines(lines);
    const alreadyReversed = await EFTReversal.findOne({
      section: "deposit-received",
      tradeId: trade._id,
    });

    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    const reversalTotalDebit = reversalLines.reduce((s, l) => s + l.debit, 0);
    const reversalTotalCredit = reversalLines.reduce((s, l) => s + l.credit, 0);

    res.json({
      tradeId: trade._id,
      tradeNumber,
      alreadyReversed: Boolean(alreadyReversed),
      lines,
      reversalLines,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      reversalTotalDebit: Math.round(reversalTotalDebit * 100) / 100,
      reversalTotalCredit: Math.round(reversalTotalCredit * 100) / 100,
    });
  } catch (error) {
    console.error("Error fetching finalize transactions:", error);
    res.status(500).json({
      message: "Server error while fetching finalize transactions",
    });
  }
});

router.get("/deposit-candidates/:tradeId", async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.tradeId);
    if (!trade) return res.status(404).json({ message: "Trade not found" });
    res.json([]);
  } catch (error) {
    console.error("Error fetching deposit candidates:", error);
    res.status(500).json({
      message: "Server error while fetching deposit candidates",
    });
  }
});

router.get("/trade-candidates/:section/:tradeId", async (req, res) => {
  try {
    const { section, tradeId } = req.params;
    if (section === "general") {
      return res.status(400).json({
        message:
          "General Account candidates must be selected by invoice number",
      });
    }
    if (section === "deposit-received") {
      return res.status(400).json({
        message:
          "Deposit Received candidates must use /deposit-candidates/:tradeId",
      });
    }
    const Model = getSectionModel(section);
    if (!Model) return res.status(400).json({ message: "Invalid section" });

    const efts = await Model.find({ tradeId }).sort({ createdAt: -1 });

    const reversed = await EFTReversal.find({
      section,
      tradeId,
      sourceEftNumber: { $in: efts.map((e) => String(e.eftNumber)) },
    }).select("sourceEftNumber");
    const reversedSet = new Set(reversed.map((r) => r.sourceEftNumber));

    const candidates = efts
      .filter((e) => !reversedSet.has(String(e.eftNumber)))
      .map((e) => ({
        eftNumber: e.eftNumber,
        amount: e.amount || 0,
        recipient: e.recipient || "",
        date: e.chequeDate || e.date,
        type: e.type,
        description: e.description || "",
      }));

    res.json(candidates);
  } catch (error) {
    console.error("Error fetching EFT candidates:", error);
    res
      .status(500)
      .json({ message: "Server error while fetching trade EFT candidates" });
  }
});

// List invoice numbers for General Account reversal selection
router.get("/general-invoices", async (_req, res) => {
  try {
    const rows = await GeneralAccountEFT.aggregate([
      { $match: { invoiceNumber: { $exists: true, $ne: "", $ne: null } } },
      { $group: { _id: "$invoiceNumber" } },
      { $sort: { _id: 1 } },
      { $limit: 500 },
    ]);
    res.json(rows.map((r) => String(r._id)));
  } catch (error) {
    console.error("Error fetching general invoice list:", error);
    res.status(500).json({ message: "Server error while fetching invoices" });
  }
});

// Candidate EFTs for a General Account invoice #
router.get("/invoice-candidates/:invoiceNumber", async (req, res) => {
  try {
    const invoiceNumber = String(req.params.invoiceNumber || "").trim();
    if (!invoiceNumber) {
      return res.status(400).json({ message: "invoiceNumber is required" });
    }

    const efts = await GeneralAccountEFT.find({ invoiceNumber })
      .sort({ createdAt: -1 })
      .lean();

    const reversed = await EFTReversal.find({
      section: "general",
      invoiceNumber,
      sourceEftNumber: { $in: efts.map((e) => String(e.eftNumber)) },
    }).select("sourceEftNumber");
    const reversedSet = new Set(reversed.map((r) => r.sourceEftNumber));

    const candidates = efts
      .filter((e) => !reversedSet.has(String(e.eftNumber)))
      .map((e) => ({
        eftNumber: e.eftNumber,
        amount: e.amount || 0,
        recipient: e.recipient || "",
        date: e.chequeDate || e.date,
        type: e.type,
        description: e.description || "",
        invoiceNumber: e.invoiceNumber || "",
      }));

    res.json(candidates);
  } catch (error) {
    console.error("Error fetching invoice EFT candidates:", error);
    res.status(500).json({
      message: "Server error while fetching invoice EFT candidates",
    });
  }
});

module.exports = router;
