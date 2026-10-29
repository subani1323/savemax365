const express = require("express");
const router = express.Router();
const Trade = require("../models/Trade");
const Ledger = require("../models/Ledger");
const CommissionRecall = require("../models/CommissionRecall");
const { CommissionTrustEFT } = require("../models/CommissionTrustEFT");

const buildTradeAddress = (trade) => {
  if (!trade?.keyInfo) return "";
  const parts = [
    trade.keyInfo.streetNumber,
    trade.keyInfo.streetName,
    trade.keyInfo.unit,
    trade.keyInfo.city,
    trade.keyInfo.province,
  ].filter((p) => p && String(p).trim() !== "");
  return parts.join(" ");
};

const roundMoney = (n) => Math.round(Number(n) * 100) / 100;

const resolveAgentId = (agentRow) => {
  const id =
    agentRow?.agentId ??
    agentRow?.employeeNo ??
    agentRow?.agentNumber ??
    "";
  return String(id).trim();
};

/** Net commission paid / owed to agent on trade (matches Commission Trust EFT cheque). */
const getAgentNetPayFromTrade = (trade, agentId) => {
  const id = String(agentId);
  const isDouble =
    (trade?.keyInfo?.classification || "").toUpperCase() ===
    "AGENT DOUBLE ENDER";

  if (isDouble) {
    const rows = (trade.agentCommissionList || []).filter(
      (a) =>
        resolveAgentId(a) === id &&
        (a.classification || "").toUpperCase() === "AGENT DOUBLE ENDER",
    );
    const net = rows.reduce(
      (sum, a) => sum + (parseFloat(a.netCommission || 0) || 0),
      0,
    );
    return Math.max(0, roundMoney(net));
  }

  const row = (trade.agentCommissionList || []).find(
    (a) => resolveAgentId(a) === id,
  );
  const net = parseFloat(row?.netCommission || 0) || 0;
  return Math.max(0, roundMoney(net));
};

const getSuggestedRecallAmount = async (trade, agentId) => {
  const agentEft = await CommissionTrustEFT.findOne({
    tradeId: trade._id,
    type: "AgentCommissionTransfer",
    agentId: String(agentId),
  }).sort({ createdAt: -1 });

  if (agentEft?.amount != null && Number(agentEft.amount) > 0) {
    return {
      suggestedRecallAmount: roundMoney(agentEft.amount),
      amountSource: "agentCommissionEft",
      eftNumber: agentEft.eftNumber,
    };
  }

  return {
    suggestedRecallAmount: getAgentNetPayFromTrade(trade, agentId),
    amountSource: "tradeNetCommission",
    eftNumber: null,
  };
};

const getTradeAgentsForRecall = async (trade) => {
  const list = trade?.agentCommissionList || [];
  const base = list.filter(
    (a) => (a.classification || "").toUpperCase() !== "REFERRAL",
  );

  const seen = new Set();
  const agents = [];
  for (const a of base) {
    const agentId = resolveAgentId(a);
    if (!agentId) continue;
    if (seen.has(agentId)) continue;
    seen.add(agentId);

    const { suggestedRecallAmount, amountSource, eftNumber } =
      await getSuggestedRecallAmount(trade, agentId);

    agents.push({
      agentId,
      agentName: String(a.agentName || "").trim() || `Agent ${agentId}`,
      classification: a.classification || "",
      suggestedRecallAmount,
      amountSource,
      agentCommissionEftNumber: eftNumber,
    });
  }
  return agents;
};

const buildRecallRef = async (tradeNumber, agentId) => {
  const base = `CR-${String(tradeNumber).replace(/\s+/g, "")}-${agentId}`;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = await CommissionRecall.countDocuments({
    recallRef: new RegExp(`^${escaped}`),
  });
  return existing > 0 ? `${base}-${existing + 1}` : base;
};

router.get("/", async (req, res) => {
  try {
    const { tradeId } = req.query;
    const query = {};
    if (tradeId) query.tradeId = tradeId;

    const recalls = await CommissionRecall.find(query)
      .sort({ recalledAt: -1 })
      .populate("tradeId");
    res.json(recalls);
  } catch (error) {
    console.error("Error fetching commission recalls:", error);
    res.status(500).json({ message: "Server error while fetching recalls" });
  }
});

router.get("/trade-agents/:tradeId", async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.tradeId);
    if (!trade) return res.status(404).json({ message: "Trade not found" });

    const agents = await getTradeAgentsForRecall(trade);
    res.json({
      tradeId: trade._id,
      tradeNumber: String(trade.tradeNumber || trade.keyInfo?.tradeNumber || ""),
      agents,
    });
  } catch (error) {
    console.error("Error fetching trade agents:", error);
    res.status(500).json({ message: "Server error while fetching agents" });
  }
});

router.post("/recall", async (req, res) => {
  try {
    const { tradeId, agentId, agentName, amount, notes, recallDate } = req.body;

    if (!tradeId || !agentId || amount == null) {
      return res.status(400).json({
        message: "tradeId, agentId and amount are required",
      });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Amount must be greater than 0" });
    }

    const trade = await Trade.findById(tradeId);
    if (!trade) return res.status(404).json({ message: "Trade not found" });

    const tradeNumber = String(
      trade.tradeNumber || trade.keyInfo?.tradeNumber || "",
    );
    const agents = await getTradeAgentsForRecall(trade);
    const matched = agents.find((a) => String(a.agentId) === String(agentId));
    if (!matched) {
      return res.status(400).json({
        message: "Selected agent is not on this trade",
      });
    }

    const resolvedAgentName =
      String(agentName || "").trim() || matched.agentName;
    const recallRef = await buildRecallRef(tradeNumber, agentId);
    const address = buildTradeAddress(trade);

    let parsedRecalledAt = new Date();
    if (recallDate) {
      const d = new Date(recallDate);
      if (!Number.isNaN(d.getTime())) parsedRecalledAt = d;
    }
    const ledgerChequeDate = new Date();

    const ledgerDescription = `Trade #: ${tradeNumber}, Commission recalled - ${resolvedAgentName}${
      address ? ` - ${address}` : ""
    }`;

    const ledgerRef = recallRef;

    await Ledger.create({
      accountNumber: "10004",
      accountName: "CASH - COMMISSION TRUST ACCOUNT",
      debit: numericAmount,
      credit: 0,
      description: ledgerDescription,
      eftNumber: ledgerRef,
      chequeDate: ledgerChequeDate,
    });

    await Ledger.create({
      accountNumber: "12101",
      accountName: "A/R - Agt's Recoverable - Commission",
      debit: 0,
      credit: numericAmount,
      description: ledgerDescription,
      eftNumber: ledgerRef,
      chequeDate: ledgerChequeDate,
    });

    const recall = await CommissionRecall.create({
      tradeId,
      tradeNumber,
      agentId: String(agentId),
      agentName: resolvedAgentName,
      amount: numericAmount,
      recallRef,
      description: ledgerDescription,
      recalledAt: parsedRecalledAt,
      notes: notes || "",
    });

    res.status(201).json({
      message: "Commission recalled successfully",
      recall,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "A recall with this reference already exists for this trade",
      });
    }
    console.error("Error posting commission recall:", error);
    res.status(500).json({ message: "Server error while posting commission recall" });
  }
});

module.exports = router;
