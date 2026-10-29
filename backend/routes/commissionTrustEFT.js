const express = require("express");
const router = express.Router();
const {
  CommissionTrustEFT,
  CommissionTrustEFTCounter,
} = require("../models/CommissionTrustEFT");
const Trade = require("../models/Trade");
const Agent = require("../models/Agent");
const Ledger = require("../models/Ledger");
const { computeAgentCommissionYtd } = require("../utils/agentCommissionYtd");
const {
  resolveBuilderNameFromFinalize,
} = require("../utils/resolveBuilderName");

/** Office total fees for an agent on a trade (matches CommissionTrustPayments / EFT receipt logic). */
function officeShareForAgentOnTrade(trade, agentId) {
  if (!trade || !trade.agentCommissionList) return 0;
  const aid = String(agentId ?? "");
  if (trade.keyInfo?.classification === "AGENT DOUBLE ENDER") {
    const rows = trade.agentCommissionList.filter(
      (a) =>
        String(a.agentId) === aid &&
        a.classification === "AGENT DOUBLE ENDER",
    );
    return rows.reduce((s, a) => s + parseFloat(a.totalFees || 0), 0);
  }
  const row = trade.agentCommissionList.find((a) => String(a.agentId) === aid);
  return parseFloat(row?.totalFees || 0);
}

// POST to reset the EFT counter to 1999 (so next EFT will be 2000)
router.post("/reset-counter", async (req, res) => {
  try {
    await CommissionTrustEFTCounter.findByIdAndUpdate(
      { _id: "commissionTrustEFTCounter" },
      { seq: 1999 },
      { upsert: true },
    );
    res.json({ message: "EFT counter reset to 1999. Next EFT will be 2000." });
  } catch (error) {
    console.error("Error resetting EFT counter:", error);
    res.status(500).json({ message: "Server error while resetting counter" });
  }
});

// POST to migrate existing EFT records and update counter to start from 2000
router.post("/migrate-to-2000", async (req, res) => {
  try {
    // Get all existing Commission Trust EFTs
    const existingEFTs = await CommissionTrustEFT.find().sort({ eftNumber: 1 });

    if (existingEFTs.length === 0) {
      // No existing EFTs, just set counter to 1999
      await CommissionTrustEFTCounter.findByIdAndUpdate(
        { _id: "commissionTrustEFTCounter" },
        { seq: 1999 },
        { upsert: true },
      );
      return res.json({
        message:
          "No existing EFTs found. Counter set to 1999. Next EFT will be 2000.",
        migratedCount: 0,
      });
    }

    // Check if any EFT numbers are below 2000
    const lowEFTs = existingEFTs.filter((eft) => eft.eftNumber < 2000);

    if (lowEFTs.length === 0) {
      // All EFTs are already 2000+, just ensure counter is set correctly
      const maxEFTNumber = Math.max(
        ...existingEFTs.map((eft) => eft.eftNumber),
      );
      await CommissionTrustEFTCounter.findByIdAndUpdate(
        { _id: "commissionTrustEFTCounter" },
        { seq: maxEFTNumber },
        { upsert: true },
      );
      return res.json({
        message: `All EFTs are already 2000+. Counter set to ${maxEFTNumber}. Next EFT will be ${
          maxEFTNumber + 1
        }.`,
        migratedCount: 0,
      });
    }

    // Migrate EFTs starting from 2000
    let newEFTNumber = 2000;
    for (const eft of lowEFTs) {
      // Update the EFT number
      await CommissionTrustEFT.findByIdAndUpdate(eft._id, {
        eftNumber: newEFTNumber,
      });

      // Update any related ledger entries
      const Ledger = require("../models/Ledger");
      await Ledger.updateMany(
        { eftNumber: eft.eftNumber },
        { eftNumber: newEFTNumber },
      );

      newEFTNumber++;
    }

    // Set counter to the last used number
    await CommissionTrustEFTCounter.findByIdAndUpdate(
      { _id: "commissionTrustEFTCounter" },
      { seq: newEFTNumber - 1 },
      { upsert: true },
    );

    res.json({
      message: `Successfully migrated ${
        lowEFTs.length
      } EFT records to start from 2000. Counter set to ${
        newEFTNumber - 1
      }. Next EFT will be ${newEFTNumber}.`,
      migratedCount: lowEFTs.length,
    });
  } catch (error) {
    console.error("Error migrating EFT records:", error);
    res
      .status(500)
      .json({ message: "Server error while migrating EFT records" });
  }
});

// POST to create a new Commission Trust EFT for Agent Commission Transfer
router.post("/agent-commission", async (req, res) => {
  try {
    const { tradeId, amount, recipient, agentId, agentName, chequeDate } =
      req.body;

    if (!tradeId) {
      return res.status(400).json({ message: "Trade ID is required" });
    }

    const trade = await Trade.findById(tradeId);
    if (!trade) {
      return res.status(404).json({ message: "Trade not found" });
    }

    // Initialize counter to ensure it starts from 1999 (so next will be 2000)
    await CommissionTrustEFTCounter.initializeCounter();
    const nextEFTNumber = await CommissionTrustEFTCounter.getNextEFTNumber();

    // Parse MM/DD/YYYY format correctly to avoid timezone issues
    let parsedChequeDate = new Date();
    if (chequeDate) {
      const [month, day, year] = chequeDate.split("/");
      parsedChequeDate = new Date(
        `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`,
      );
    }

    const newEFT = new CommissionTrustEFT({
      eftNumber: nextEFTNumber,
      tradeId: tradeId,
      amount: amount,
      recipient: recipient,
      type: "AgentCommissionTransfer",
      agentId: agentId,
      agentName: agentName,
      description: "Agent Commission Payment",
      date: new Date(),
      chequeDate: parsedChequeDate,
    });

    await newEFT.save();

    // Link EFT to Trade
    await Trade.findByIdAndUpdate(tradeId, {
      $push: { commissionTrustEFTs: newEFT._id },
    });

    // Build address from trade keyInfo
    let tradeAddress = "";
    if (trade.keyInfo) {
      const addressParts = [
        trade.keyInfo.streetNumber,
        trade.keyInfo.streetName,
        trade.keyInfo.unit,
        trade.keyInfo.city,
        trade.keyInfo.province,
      ].filter((part) => part && part.trim() !== "");
      tradeAddress = addressParts.join(" ");
    }

    // Get trade number
    const tradeNumber =
      trade.tradeNumber || trade.keyInfo?.tradeNumber || "N/A";

    // --- Add ledger entries for debit and credit ---
    // Account 10004 (Commission Trust) - Received From
    const commissionTrustDescription = `Trade #: ${tradeNumber}, Received From: ${agentName} - Commission Trust - ${tradeAddress}`;

    // Account 21500 (Commission Payable) - Paid To
    const commissionPayableDescription = `Trade #: ${tradeNumber}, Paid to: ${agentName} - Commission Trust - ${tradeAddress}`;

    // Debit 21500 Commission Payable
    const debitEntry = new (require("../models/Ledger"))({
      accountNumber: "21500",
      accountName: "Commission Payable",
      debit: amount,
      credit: 0,
      description: commissionPayableDescription,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
      tradeNumber: tradeNumber,
      payee: agentName,
    });
    await debitEntry.save();
    // Credit 10004 Cash - Commission Trust Account
    const creditEntry = new (require("../models/Ledger"))({
      accountNumber: "10004",
      accountName: "CASH - COMMISSION TRUST ACCOUNT",
      debit: 0,
      credit: amount,
      description: commissionTrustDescription,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
      tradeNumber: tradeNumber,
      payee: agentName,
    });
    await creditEntry.save();
    // --- End ledger entries ---

    res.status(201).json({ eftNumber: nextEFTNumber });
  } catch (error) {
    console.error("Error creating Commission Trust EFT record:", error);
    res.status(500).json({ message: "Server error while creating EFT record" });
  }
});

// POST to create a new Commission Trust EFT for Refund of Deposit
router.post("/refund-deposit", async (req, res) => {
  try {
    const { tradeId, amount, recipient, description, chequeDate } = req.body;

    if (!tradeId) {
      return res.status(400).json({ message: "Trade ID is required" });
    }

    const trade = await Trade.findById(tradeId);
    if (!trade) {
      return res.status(404).json({ message: "Trade not found" });
    }

    // Initialize counter to ensure it starts from 1999 (so next will be 2000)
    await CommissionTrustEFTCounter.initializeCounter();
    const nextEFTNumber = await CommissionTrustEFTCounter.getNextEFTNumber();

    // Parse MM/DD/YYYY format correctly to avoid timezone issues
    let parsedChequeDate = new Date();
    if (chequeDate) {
      const [month, day, year] = chequeDate.split("/");
      parsedChequeDate = new Date(
        `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`,
      );
    }

    const newEFT = new CommissionTrustEFT({
      eftNumber: nextEFTNumber,
      tradeId: tradeId,
      amount: amount,
      recipient: recipient,
      type: "RefundOfDeposit",
      description: description || "Transfer Refund",
      date: new Date(),
      chequeDate: parsedChequeDate,
    });

    await newEFT.save();

    // Link EFT to Trade
    await Trade.findByIdAndUpdate(tradeId, {
      $push: { commissionTrustEFTs: newEFT._id },
    });

    // --- Add ledger entries for debit and credit ---
    const ledgerDescription = `Trade #: ${trade.tradeNumber}, Paid to: ${recipient}`;
    // Debit 21300 Liability For Trust Funds
    const debitEntry = new (require("../models/Ledger"))({
      accountNumber: "21300",
      accountName: "Liability For Trust Funds",
      debit: amount,
      credit: 0,
      description: ledgerDescription,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
    });
    await debitEntry.save();
    // Credit 10002 Cash - Trust
    const creditEntry = new (require("../models/Ledger"))({
      accountNumber: "10002",
      accountName: "CASH - TRUST",
      debit: 0,
      credit: amount,
      description: ledgerDescription,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
    });
    await creditEntry.save();
    // --- End ledger entries ---

    res.status(201).json({ eftNumber: nextEFTNumber });
  } catch (error) {
    console.error("Error creating Commission Trust EFT record:", error);
    res.status(500).json({ message: "Server error while creating EFT record" });
  }
});

// POST to create a new Commission Trust EFT for Outside Broker Commission
router.post("/outside-broker", async (req, res) => {
  try {
    console.log("Outside broker EFT request received:", req.body);
    const { tradeId, amount, recipient, description, chequeDate } = req.body;

    if (!tradeId) {
      console.log("Trade ID missing");
      return res.status(400).json({ message: "Trade ID is required" });
    }

    console.log("Looking for trade with ID:", tradeId);
    const trade = await Trade.findById(tradeId);
    if (!trade) {
      console.log("Trade not found");
      return res.status(404).json({ message: "Trade not found" });
    }

    console.log("Trade found, getting next EFT number");
    // Initialize counter to ensure it starts from 1999 (so next will be 2000)
    await CommissionTrustEFTCounter.initializeCounter();
    const nextEFTNumber = await CommissionTrustEFTCounter.getNextEFTNumber();
    console.log("Next EFT number:", nextEFTNumber);

    // Parse MM/DD/YYYY format correctly to avoid timezone issues
    let parsedChequeDate = new Date();
    if (chequeDate) {
      const [month, day, year] = chequeDate.split("/");
      parsedChequeDate = new Date(
        `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`,
      );
    }

    console.log("Creating new EFT record");
    const newEFT = new CommissionTrustEFT({
      eftNumber: nextEFTNumber,
      tradeId: tradeId,
      amount: amount,
      recipient: recipient,
      type: "OutsideBrokerCommission",
      description: description || "Transfer commission to outside broker",
      date: new Date(),
      chequeDate: parsedChequeDate,
    });

    console.log("Saving EFT record");
    await newEFT.save();
    console.log("EFT record saved successfully");

    // Link EFT to Trade
    console.log("Linking EFT to trade");
    await Trade.findByIdAndUpdate(tradeId, {
      $push: { commissionTrustEFTs: newEFT._id },
    });

    // Build address from trade keyInfo
    let tradeAddress = "";
    if (trade.keyInfo) {
      const addressParts = [
        trade.keyInfo.streetNumber,
        trade.keyInfo.streetName,
        trade.keyInfo.unit,
        trade.keyInfo.city,
        trade.keyInfo.province,
      ].filter((part) => part && part.trim() !== "");
      tradeAddress = addressParts.join(" ");
    }

    // Get trade number
    const tradeNumber =
      trade.tradeNumber || trade.keyInfo?.tradeNumber || "N/A";

    // --- Add ledger entries for debit and credit ---
    // Account 10004 (Commission Trust) - Received From
    const commissionTrustDescription = `Trade #: ${tradeNumber}, Received From: ${recipient} - Commission Trust - ${tradeAddress}`;

    // Account 21100 (A/P) - Paid To
    const apDescription = `Trade #: ${tradeNumber}, Paid to: ${recipient} - Commission Trust - ${tradeAddress}`;

    // Debit 21100 A/P - Other Brokers & Referrals
    const debitEntry = new (require("../models/Ledger"))({
      accountNumber: "21100",
      accountName: "A/P - Other Brokers & Referrals",
      debit: amount,
      credit: 0,
      description: apDescription,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
      tradeNumber: tradeNumber,
      payee: recipient,
    });
    await debitEntry.save();
    // Credit 10004 Cash - Commission Trust Account
    const creditEntry = new (require("../models/Ledger"))({
      accountNumber: "10004",
      accountName: "CASH - COMMISSION TRUST ACCOUNT",
      debit: 0,
      credit: amount,
      description: commissionTrustDescription,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
      tradeNumber: tradeNumber,
      payee: recipient,
    });
    await creditEntry.save();
    // --- End ledger entries ---

    console.log("Sending success response");
    res.status(201).json({ eftNumber: nextEFTNumber });
  } catch (error) {
    console.error("Error creating Commission Trust EFT record:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      message: "Server error while creating EFT record",
      error: error.message,
    });
  }
});

const parseChequeDate = (chequeDate) => {
  if (!chequeDate) return new Date();
  const [month, day, year] = String(chequeDate).split("/");
  return new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`,
  );
};

const buildTradeAddressFromKeyInfo = (trade) => {
  if (!trade?.keyInfo) return "";
  const addressParts = [
    trade.keyInfo.streetNumber,
    trade.keyInfo.streetName,
    trade.keyInfo.unit,
    trade.keyInfo.city,
    trade.keyInfo.province,
  ].filter((part) => part && String(part).trim() !== "");
  return addressParts.join(" ");
};

// GET builder name + suggested repayment from finalize balance payment
router.get("/builder-name/:tradeId", async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.tradeId);
    if (!trade) {
      return res.status(404).json({ message: "Trade not found" });
    }
    const result = await resolveBuilderNameFromFinalize(trade);
    res.json(result);
  } catch (error) {
    console.error("Error resolving builder name:", error);
    res.status(500).json({ message: "Server error while resolving builder name" });
  }
});

// POST Builder Repayment — pay finalize balance recipient from commission trust
router.post("/builder-repayment", async (req, res) => {
  try {
    const { tradeId, amount, builderName, chequeDate, notes } = req.body;
    if (!tradeId) {
      return res.status(400).json({ message: "Trade ID is required" });
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Amount must be greater than 0" });
    }
    const recipient = String(builderName || "").trim();
    if (!recipient) {
      return res.status(400).json({ message: "Builder name is required" });
    }

    const trade = await Trade.findById(tradeId);
    if (!trade) {
      return res.status(404).json({ message: "Trade not found" });
    }

    const existing = await CommissionTrustEFT.findOne({
      tradeId,
      type: "BuilderRepayment",
    });
    if (existing && !trade.keyInfo?.voided) {
      return res.status(409).json({
        message: "Builder repayment already recorded for this trade",
        eftNumber: existing.eftNumber,
      });
    }

    await CommissionTrustEFTCounter.initializeCounter();
    const nextEFTNumber = await CommissionTrustEFTCounter.getNextEFTNumber();
    const parsedChequeDate = parseChequeDate(chequeDate);
    const tradeNumber =
      trade.tradeNumber || trade.keyInfo?.tradeNumber || "N/A";
    const tradeAddress = buildTradeAddressFromKeyInfo(trade);
    const stubNote = notes || "Builder repayment";
    const ledgerDescription = `Trade #: ${tradeNumber}, Builder repayment - ${recipient}${
      tradeAddress ? ` - ${tradeAddress}` : ""
    }`;

    const newEFT = new CommissionTrustEFT({
      eftNumber: nextEFTNumber,
      tradeId,
      amount: numericAmount,
      recipient,
      type: "BuilderRepayment",
      description: ledgerDescription,
      date: new Date(),
      chequeDate: parsedChequeDate,
    });
    await newEFT.save();
    await Trade.findByIdAndUpdate(tradeId, {
      $push: { commissionTrustEFTs: newEFT._id },
    });

    await Ledger.create({
      accountNumber: "21400",
      accountName: "Liability to Builder",
      debit: numericAmount,
      credit: 0,
      description: ledgerDescription,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
      tradeNumber: String(tradeNumber),
      payee: recipient,
    });
    await Ledger.create({
      accountNumber: "10004",
      accountName: "CASH - COMMISSION TRUST ACCOUNT",
      debit: 0,
      credit: numericAmount,
      description: `Trade #: ${tradeNumber}, Paid To: ${recipient} - Commission Trust${
        tradeAddress ? ` - ${tradeAddress}` : ""
      }`,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
      tradeNumber: String(tradeNumber),
      payee: recipient,
    });

    res.status(201).json({
      eftNumber: nextEFTNumber,
      builderName: recipient,
      description: ledgerDescription,
      note: stubNote,
    });
  } catch (error) {
    console.error("Error creating builder repayment EFT:", error);
    res.status(500).json({
      message: "Server error while creating builder repayment",
      error: error.message,
    });
  }
});

// POST General to Commission — transfer funds from general (current) to commission trust
router.post("/general-to-commission", async (req, res) => {
  try {
    const { tradeId, amount, chequeDate, notes } = req.body;
    if (!tradeId) {
      return res.status(400).json({ message: "Trade ID is required" });
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Amount must be greater than 0" });
    }

    const trade = await Trade.findById(tradeId);
    if (!trade) {
      return res.status(404).json({ message: "Trade not found" });
    }

    const existing = await CommissionTrustEFT.findOne({
      tradeId,
      type: "GeneralToCommissionTransfer",
    });
    if (existing && !trade.keyInfo?.voided) {
      return res.status(409).json({
        message: "General to Commission transfer already recorded for this trade",
        eftNumber: existing.eftNumber,
      });
    }

    await CommissionTrustEFTCounter.initializeCounter();
    const nextEFTNumber = await CommissionTrustEFTCounter.getNextEFTNumber();
    const parsedChequeDate = parseChequeDate(chequeDate);
    const tradeNumber =
      trade.tradeNumber || trade.keyInfo?.tradeNumber || "N/A";
    const tradeAddress = buildTradeAddressFromKeyInfo(trade);
    const recipient = "Save Max Success Realty., Brokerage";
    const ledgerDescription = `Trade #: ${tradeNumber}, Commission transfer from General to Commission${
      tradeAddress ? ` - ${tradeAddress}` : ""
    }`;

    const newEFT = new CommissionTrustEFT({
      eftNumber: nextEFTNumber,
      tradeId,
      amount: numericAmount,
      recipient,
      type: "GeneralToCommissionTransfer",
      description: ledgerDescription,
      date: new Date(),
      chequeDate: parsedChequeDate,
    });
    await newEFT.save();
    await Trade.findByIdAndUpdate(tradeId, {
      $push: { commissionTrustEFTs: newEFT._id },
    });

    await Ledger.create({
      accountNumber: "10004",
      accountName: "CASH - COMMISSION TRUST ACCOUNT",
      debit: numericAmount,
      credit: 0,
      description: ledgerDescription,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
      tradeNumber: String(tradeNumber),
      payee: recipient,
    });
    await Ledger.create({
      accountNumber: "10001",
      accountName: "CASH - CURRENT ACCOUNT",
      debit: 0,
      credit: numericAmount,
      description: `Trade #: ${tradeNumber}, Paid to: ${recipient}`,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
      tradeNumber: String(tradeNumber),
      payee: recipient,
    });

    res.status(201).json({
      eftNumber: nextEFTNumber,
      description: ledgerDescription,
      note: notes || "Commission transfer from General to Commission",
    });
  } catch (error) {
    console.error("Error creating general to commission transfer:", error);
    res.status(500).json({
      message: "Server error while creating general to commission transfer",
      error: error.message,
    });
  }
});

// POST to create a new Commission Trust EFT for Our Brokerage Commission
router.post("/our-brokerage", async (req, res) => {
  try {
    const { tradeId, amount, recipient, description, chequeDate } = req.body;
    if (!tradeId) {
      return res.status(400).json({ message: "Trade ID is required" });
    }
    const trade = await Trade.findById(tradeId);
    if (!trade) {
      return res.status(404).json({ message: "Trade not found" });
    }
    // Initialize counter to ensure it starts from 1999 (so next will be 2000)
    await CommissionTrustEFTCounter.initializeCounter();
    const nextEFTNumber = await CommissionTrustEFTCounter.getNextEFTNumber();

    // Parse MM/DD/YYYY format correctly to avoid timezone issues
    let parsedChequeDate = new Date();
    if (chequeDate) {
      const [month, day, year] = chequeDate.split("/");
      parsedChequeDate = new Date(
        `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`,
      );
    }

    const newEFT = new CommissionTrustEFT({
      eftNumber: nextEFTNumber,
      tradeId: tradeId,
      amount: amount,
      recipient: recipient,
      type: "OurBrokerageCommission",
      description: description || "Transfer Office Share",
      date: new Date(),
      chequeDate: parsedChequeDate,
    });
    await newEFT.save();
    // Link EFT to Trade
    await Trade.findByIdAndUpdate(tradeId, {
      $push: { commissionTrustEFTs: newEFT._id },
    });
    // --- Add ledger entries for debit and credit ---
    const ledgerDescription = `Trade #: ${trade.tradeNumber}, Paid to: ${recipient}`;
    // Debit 10001 Cash - Current Account
    const debitEntry = new (require("../models/Ledger"))({
      accountNumber: "10001",
      accountName: "CASH - CURRENT ACCOUNT",
      debit: amount,
      credit: 0,
      description: ledgerDescription,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
    });
    await debitEntry.save();
    // Credit 10004 Cash - Commission Trust Account
    const creditEntry = new (require("../models/Ledger"))({
      accountNumber: "10004",
      accountName: "CASH - COMMISSION TRUST ACCOUNT",
      debit: 0,
      credit: amount,
      description: ledgerDescription,
      eftNumber: nextEFTNumber,
      chequeDate: parsedChequeDate,
    });
    await creditEntry.save();
    // --- End ledger entries ---
    res.status(201).json({ eftNumber: nextEFTNumber });
  } catch (error) {
    console.error("Error creating Our Brokerage Commission EFT record:", error);
    res.status(500).json({ message: "Server error while creating EFT record" });
  }
});

/**
 * Record-only row for Trade Info / Commission Trust Activity when the user completes
 * Finalize Trade → Confirm Payment. Ledger lines (10004 / 12200) are already posted there;
 * this persists the EFT metadata so /commission-trust-eft/trade/:id returns it.
 */
router.post("/finalize-trade-payment", async (req, res) => {
  try {
    const { tradeId, amount, recipient, eftNumber, chequeDate } = req.body;

    if (!tradeId) {
      return res.status(400).json({ message: "Trade ID is required" });
    }

    const trade = await Trade.findById(tradeId);
    if (!trade) {
      return res.status(404).json({ message: "Trade not found" });
    }

    const rawEft = eftNumber != null ? String(eftNumber).trim() : "";
    const eftMatch = rawEft.match(/EFT(\d+)/i);
    const parsedEft = eftMatch
      ? parseInt(eftMatch[1], 10)
      : parseInt(rawEft, 10);
    if (!Number.isFinite(parsedEft) || parsedEft < 2000) {
      return res.status(400).json({
        message: "A valid EFT number (>= 2000) is required",
      });
    }

    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ message: "A positive amount is required" });
    }

    const recipientStr = (recipient || "").trim();
    if (!recipientStr) {
      return res.status(400).json({ message: "Recipient is required" });
    }

    let parsedChequeDate = new Date();
    if (chequeDate) {
      if (chequeDate.includes("/")) {
        const [month, day, year] = chequeDate.split("/");
        parsedChequeDate = new Date(
          `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`,
        );
      } else {
        parsedChequeDate = new Date(`${chequeDate}T00:00:00`);
      }
    }

    const existingSame = await CommissionTrustEFT.findOne({
      tradeId,
      type: "CommissionReceived",
      eftNumber: parsedEft,
    });
    if (existingSame) {
      return res.status(200).json({
        message: "Record already exists",
        eftNumber: existingSame.eftNumber,
      });
    }

    const conflict = await CommissionTrustEFT.findOne({
      eftNumber: parsedEft,
      tradeId: { $ne: tradeId },
    });
    if (conflict) {
      return res.status(409).json({
        message: "This EFT number is already assigned to another commission trust record",
      });
    }

    const newEFT = new CommissionTrustEFT({
      eftNumber: parsedEft,
      tradeId,
      amount: amt,
      recipient: recipientStr,
      type: "CommissionReceived",
      description: "Commission Received",
      date: new Date(),
      chequeDate: parsedChequeDate,
    });

    await newEFT.save();

    await Trade.findByIdAndUpdate(tradeId, {
      $push: { commissionTrustEFTs: newEFT._id },
    });

    res.status(201).json({ eftNumber: parsedEft });
  } catch (error) {
    console.error("Error recording finalize trade payment EFT:", error);
    res.status(500).json({ message: "Server error while recording EFT" });
  }
});

// GET all Commission Trust EFTs
router.get("/", async (req, res) => {
  try {
    const efts = await CommissionTrustEFT.find().populate("tradeId");
    res.json(efts);
  } catch (error) {
    console.error("Error fetching Commission Trust EFTs:", error);
    res.status(500).json({ message: "Server error while fetching EFTs" });
  }
});

// GET EFTs by trade ID
router.get("/trade/:tradeId", async (req, res) => {
  try {
    const { tradeId } = req.params;
    const efts = await CommissionTrustEFT.find({ tradeId }).populate("tradeId");
    res.json(efts);
  } catch (error) {
    console.error("Error fetching EFTs for trade:", error);
    res.status(500).json({ message: "Server error while fetching EFTs" });
  }
});

// GET YTD agent commission EFT totals for receipt (Jan 1 through throughDate, inclusive)
router.get("/agent-ytd/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { throughDate } = req.query;
    if (!throughDate || typeof throughDate !== "string") {
      return res.status(400).json({
        message:
          "throughDate query param (YYYY-MM-DD or MM/DD/YYYY) is required",
      });
    }
    const data = await computeAgentCommissionYtd(
      agentId,
      throughDate,
      CommissionTrustEFT,
      Agent,
    );
    res.json(data);
  } catch (error) {
    if (error.code === "INVALID_THROUGH_DATE") {
      return res.status(400).json({ message: "Invalid throughDate" });
    }
    console.error("Error computing agent YTD:", error);
    res.status(500).json({ message: "Server error while computing YTD" });
  }
});

// GET EFTs by agent ID
router.get("/agent/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const efts = await CommissionTrustEFT.find({ agentId }).populate("tradeId");
    res.json(efts);
  } catch (error) {
    console.error("Error fetching EFTs for agent:", error);
    res.status(500).json({ message: "Server error while fetching EFTs" });
  }
});

// GET trade with all related EFTs
router.get("/trade/:tradeId/with-efts", async (req, res) => {
  try {
    const { tradeId } = req.params;
    const trade = await Trade.findById(tradeId)
      .populate("realEstateTrustEFTs")
      .populate("commissionTrustEFTs");
    res.json(trade);
  } catch (error) {
    console.error("Error fetching trade with EFTs:", error);
    res
      .status(500)
      .json({ message: "Server error while fetching trade with EFTs" });
  }
});

// Check if EFT already exists for a trade and type
// For AgentCommissionTransfer type, optionally check by agentId as well
router.get("/check-existing/:tradeId/:type", async (req, res) => {
  try {
    const { tradeId, type } = req.params;
    const { agentId } = req.query;

    const trade = await Trade.findById(tradeId).select("keyInfo.voided").lean();
    if (trade?.keyInfo?.voided) {
      return res.json({
        exists: false,
        voided: true,
        count: 0,
        ...(type === "OutsideBrokerCommission" ? { recipients: [] } : {}),
      });
    }

    // Build query - for AgentCommissionTransfer, also check agentId if provided
    const query = {
      tradeId: tradeId,
      type: type,
    };

    // If type is AgentCommissionTransfer and agentId is provided, check for that specific agent
    // Make sure to match exact agentId and exclude records with null/undefined agentId
    if (type === "AgentCommissionTransfer" && agentId) {
      // Explicitly ensure agentId exists and matches exactly (exclimage.pngudes null/undefined)
      query.agentId = { $exists: true, $eq: agentId };
    }

    const existingEFTs = await CommissionTrustEFT.find(query);

    const count = existingEFTs.length;

    if (count > 0) {
      const payload = {
        exists: true,
        count: count,
        eftNumber: existingEFTs[0].eftNumber,
        type: existingEFTs[0].type,
        date: existingEFTs[0].date,
        amount: existingEFTs[0].amount,
        recipient: existingEFTs[0].recipient,
        agentId: existingEFTs[0].agentId,
      };
      // For Outside Broker Commission, return all recipients so frontend can show per-broker EFT status
      if (type === "OutsideBrokerCommission") {
        payload.recipients = existingEFTs
          .map((e) => e.recipient)
          .filter(Boolean);
      }
      res.json(payload);
    } else {
      res.json({
        exists: false,
        count: 0,
        ...(type === "OutsideBrokerCommission" ? { recipients: [] } : {}),
      });
    }
  } catch (error) {
    console.error("Error checking existing EFT:", error);
    res
      .status(500)
      .json({ message: "Server error while checking existing EFT" });
  }
});

module.exports = router;
