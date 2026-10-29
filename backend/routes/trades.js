const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Trade = require("../models/Trade");
const { sanitizeAgentCommissionList } = require("../utils/money");

// Parse trade number to (base, suffix) for ordering. e.g. 279 -> [279, 0], "279-A" -> [279, 1], "326-D" -> [326, 4] (A=1..Z=26)
function parseTradeNumber(tn) {
  if (tn === null || tn === undefined) return null;
  const s = String(tn).trim();
  const match = s.match(/^(\d+)(?:-([A-Za-z]))?$/i);
  if (!match) return null;
  const base = parseInt(match[1], 10);
  const suffix = (match[2] || "").toUpperCase();
  if (suffix.length !== 0 && suffix.length !== 1) return null;
  const suffixOrder =
    suffix === "" ? 0 : suffix.charCodeAt(0) - 64; // A=1, B=2, … Z=26
  if (suffix && (suffixOrder < 1 || suffixOrder > 26)) return null;
  return { base, suffixOrder, key: `${base}-${suffixOrder}` };
}

function compareTradeNumbers(a, b) {
  const pa = parseTradeNumber(a);
  const pb = parseTradeNumber(b);
  if (!pa) return pb ? 1 : 0;
  if (!pb) return -1;
  if (pa.base !== pb.base) return pa.base - pb.base;
  return pa.suffixOrder - pb.suffixOrder;
}

// Return successor. Numeric only (279) -> 280. With suffix: 279-A->279-B, 279-B->279-C or 280 (if 2 installments), 279-C->280, 326-D->326-E
function nextTradeNumberAfter(tn, tradesByTn) {
  const p = parseTradeNumber(tn);
  if (!p) return 200;
  if (p.suffixOrder === 0) return p.base + 1; // 279 -> 280 (no pre-construction)
  if (p.suffixOrder === 3) return p.base + 1; // After …-C (pre-construction), next is numeric
  if (p.suffixOrder < 3) {
    // After 279-B: if -A has 2 installments, next is 280; else 279-C
    if (p.suffixOrder === 2) {
      const baseA = tradesByTn[`${p.base}-A`];
      const installments = baseA?.keyInfo?.preConstructionInstallments;
      if (installments === 2) return p.base + 1;
    }
    const nextSuffix = ["A", "B", "C"][p.suffixOrder];
    return `${p.base}-${nextSuffix}`;
  }
  // D (4) and beyond: next letter, then roll to numeric after Z
  const nextCode = 64 + p.suffixOrder + 1;
  if (nextCode <= 90) return `${p.base}-${String.fromCharCode(nextCode)}`;
  return p.base + 1;
}

// ✅ Get next available trade number (supports numeric and pre-construction 279-A, 279-B, 279-C)
router.get("/next-number", async (req, res) => {
  try {
    const trades = await Trade.find({}, "tradeNumber keyInfo.preConstructionInstallments");

    if (trades.length === 0) {
      return res.json({ nextNumber: 200 });
    }

    const sorted = [...trades]
      .map((t) => t.tradeNumber)
      .filter((tn) => parseTradeNumber(tn))
      .sort(compareTradeNumbers);

    const tradesByTn = {};
    for (const t of trades) {
      const k = typeof t.tradeNumber === "number" ? String(t.tradeNumber) : t.tradeNumber;
      tradesByTn[k] = t;
    }

    const maxTn = sorted[sorted.length - 1];
    const nextNumber = nextTradeNumberAfter(maxTn, tradesByTn);
    const nextVal = typeof nextNumber === "number" ? nextNumber : nextNumber;

    res.json({ nextNumber: nextVal });
  } catch (error) {
    res.status(500).json({
      message: "Error getting next trade number",
      error: error.message,
    });
  }
});

// ✅ POST - Save a complete trade (tradeNumber may be number or string e.g. "279-A")
router.post("/full", async (req, res) => {
  try {
    const raw = req.body.tradeNumber;
    if (raw === undefined || raw === null || raw === "") {
      return res.status(400).json({ message: "Trade number is required" });
    }

    let tradeNumber;
    const str = String(raw).trim();
    if (/^\d+-[A-Za-z]$/i.test(str)) {
      tradeNumber = str;
    } else {
      const num = Number(raw);
      if (Number.isNaN(num) || num < 200) {
        return res.status(400).json({ message: "Invalid trade number" });
      }
      tradeNumber = num;
    }

    console.log("Received trade data:", JSON.stringify(req.body, null, 2));
    console.log("Conditions data:", req.body.conditions);

    const keyInfo = {
      ...req.body.keyInfo,
      tradeNumber,
    };
    if (req.body.keyInfo?.preConstructionInstallments) {
      keyInfo.preConstructionInstallments = req.body.keyInfo.preConstructionInstallments;
    }
    const tradeData = {
      ...req.body,
      tradeNumber,
      keyInfo,
      agentCommissionList: sanitizeAgentCommissionList(
        req.body.agentCommissionList || [],
      ),
    };

    console.log("Trade data to save:", JSON.stringify(tradeData, null, 2));

    const existing = await Trade.findOne({ tradeNumber });
    if (existing) {
      return res.status(400).json({ message: "Trade number already exists" });
    }

    const trade = new Trade(tradeData);
    await trade.save();
    res.status(201).json(trade);
  } catch (err) {
    console.error("Error saving trade:", err);
    res.status(400).json({ message: err.message });
  }
});

// ✅ GET all trades (sorted by trade number: 280, 279-C, 279-B, 279-A, 279)
router.get("/", async (req, res) => {
  try {
    const trades = await Trade.find();
    trades.sort((a, b) => -compareTradeNumbers(a.tradeNumber, b.tradeNumber));
    res.json(trades);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const PROGRESS_REPORT_TRACKER_KEYS = [
  "action",
  "notes",
  "followUpDate",
  "tradeCategory",
  "complianceStatus",
];

// PATCH progress report fields onto progressTracker (must be before GET /:id)
router.patch("/:id/progress-report", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid trade id" });
    }

    const { progressTracker } = req.body || {};
    if (!progressTracker || typeof progressTracker !== "object") {
      return res
        .status(400)
        .json({ message: "progressTracker object is required" });
    }

    const $set = {};
    for (const key of PROGRESS_REPORT_TRACKER_KEYS) {
      if (Object.prototype.hasOwnProperty.call(progressTracker, key)) {
        $set[`progressTracker.${key}`] = progressTracker[key] ?? "";
      }
    }
    if (!Object.keys($set).length) {
      return res.status(400).json({ message: "No progress report fields to update" });
    }

    const trade = await Trade.findByIdAndUpdate(
      id,
      { $set },
      { new: true, runValidators: true },
    );
    if (!trade) return res.status(404).json({ message: "Trade not found" });

    res.json(trade);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ✅ GET single trade by ID
router.get("/:id", async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.id);
    if (!trade) return res.status(404).json({ message: "Trade not found" });
    res.json(trade);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH append a trade notepad entry (Trade Details Note button)
router.patch("/:id/notes", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid trade id" });
    }

    const text = String(req.body?.text || "").trim();
    const authorName = String(req.body?.authorName || "").trim();
    if (!text) {
      return res.status(400).json({ message: "Note text is required" });
    }
    if (!authorName) {
      return res.status(400).json({ message: "Author name is required" });
    }

    const updatedTrade = await Trade.findByIdAndUpdate(
      id,
      {
        $push: {
          tradeNotes: {
            text,
            authorName,
            createdAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    );

    if (!updatedTrade) {
      return res.status(404).json({ message: "Trade not found" });
    }

    res.json(updatedTrade);
  } catch (err) {
    console.error("Error saving trade note:", err);
    res.status(400).json({ message: err.message });
  }
});

// ✅ PUT - Update a trade
router.put("/:id", async (req, res) => {
  try {
    const updateData = { ...req.body };

    if (updateData.agentCommissionInfo) {
      updateData.agentCommissionList =
        updateData.agentCommissionInfo.agents || [];
      delete updateData.agentCommissionInfo;
    }

    if (Array.isArray(updateData.agentCommissionList)) {
      updateData.agentCommissionList = sanitizeAgentCommissionList(
        updateData.agentCommissionList,
      );
    }

    if (updateData.tradeNumber !== undefined) {
      const raw = updateData.tradeNumber;
      updateData.tradeNumber =
        typeof raw === "string" && /^\d+-[A-Za-z]$/i.test(String(raw).trim())
          ? String(raw).trim()
          : Number(raw);
    }

    if (updateData.keyInfo?.tradeNumber !== undefined) {
      const raw = updateData.keyInfo.tradeNumber;
      updateData.keyInfo.tradeNumber =
        typeof raw === "string" && /^\d+-[A-Za-z]$/i.test(String(raw).trim())
          ? String(raw).trim()
          : Number(raw);
    }

    if (
      updateData.progressTracker &&
      typeof updateData.progressTracker === "object"
    ) {
      const existing = await Trade.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Trade not found" });
      }
      const prev =
        existing.progressTracker?.toObject?.() ||
        existing.progressTracker ||
        {};
      updateData.progressTracker = {
        ...prev,
        ...updateData.progressTracker,
      };
    }

    const updatedTrade = await Trade.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true },
    );

    if (!updatedTrade)
      return res.status(404).json({ message: "Trade not found" });

    res.json(updatedTrade);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ✅ DELETE - Remove a trade
router.delete("/:id", async (req, res) => {
  try {
    const deletedTrade = await Trade.findByIdAndDelete(req.params.id);
    if (!deletedTrade)
      return res.status(404).json({ message: "Trade not found" });

    res.json({ message: "Trade deleted", trade: deletedTrade });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET trade with all EFTs (Real Estate Trust and Commission Trust)
router.get("/:id/with-efts", async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.id)
      .populate("realEstateTrustEFTs")
      .populate("commissionTrustEFTs");

    if (!trade) {
      return res.status(404).json({ message: "Trade not found" });
    }

    res.json(trade);
  } catch (error) {
    console.error("Error fetching trade with EFTs:", error);
    res
      .status(500)
      .json({ message: "Server error while fetching trade with EFTs" });
  }
});

// Finalize a trade (can only be done once)
router.post("/finalize/:tradeNumber", async (req, res) => {
  try {
    const { tradeNumber } = req.params;
    const { finalizedDate } = req.body;
    const tn =
      /^\d+-[A-Za-z]$/i.test(tradeNumber) ? tradeNumber : Number(tradeNumber);
    const trade = await Trade.findOne({ tradeNumber: tn });
    if (!trade) {
      return res
        .status(404)
        .json({ success: false, message: "Trade not found" });
    }
    if (trade.isFinalized) {
      return res
        .status(400)
        .json({ success: false, message: "Trade already finalized" });
    }

    // Set finalized date and mark as finalized
    trade.isFinalized = true;
    if (finalizedDate) {
      trade.keyInfo = trade.keyInfo || {};
      trade.keyInfo.finalizedDate = finalizedDate;
    }

    await trade.save();
    res.json({ success: true, message: "Trade finalized successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
