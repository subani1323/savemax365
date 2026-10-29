const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ReconciliationSettings = require("../models/ReconciliationSettings");

// Normalize date to start-of-day UTC so GET and PUT always match the same document
function toStartOfDayUTC(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toEndOfDayUTC(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

// Get reconciliation settings for a specific account and date range
// If mergeClearedForAccount=true, also returns allClearedLedgerIds for this account (all ranges) so prior-uncleared list can show correct cleared state
router.get("/:accountNumber", async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const { fromDate, toDate, mergeClearedForAccount } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        message: "fromDate and toDate are required",
      });
    }

    const startDate = toStartOfDayUTC(fromDate);
    const endDate = toEndOfDayUTC(toDate);
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Invalid fromDate or toDate" });
    }

    const settings = await ReconciliationSettings.findOne({
      accountNumber,
      fromDate: startDate,
      toDate: endDate,
    });

    let payload = settings
      ? settings.toObject ? settings.toObject() : settings
      : { clearedTransactions: [] };

    if (
      (mergeClearedForAccount === "true" || mergeClearedForAccount === true) &&
      accountNumber
    ) {
      const allSettings = await ReconciliationSettings.find({
        accountNumber,
      }).select("clearedTransactions");
      const allClearedLedgerIds = [];
      allSettings.forEach((s) => {
        (s.clearedTransactions || []).forEach((ct) => {
          if (ct.ledgerId) allClearedLedgerIds.push(String(ct.ledgerId));
        });
      });
      payload.allClearedLedgerIds = [...new Set(allClearedLedgerIds)];
    }

    res.json(payload);
  } catch (error) {
    console.error("Error fetching reconciliation settings:", error);
    res.status(500).json({ message: error.message });
  }
});

// Save reconciliation settings (create or update)
router.post("/:accountNumber", async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const { fromDate, toDate, clearedTransactions, statementAmount } = req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        message: "fromDate and toDate are required",
      });
    }

    const startDate = new Date(fromDate);
    startDate.setUTCHours(0, 0, 0, 0);

    const endDate = new Date(toDate);
    endDate.setUTCHours(23, 59, 59, 999);

    // Use upsert to create or update
    const settings = await ReconciliationSettings.findOneAndUpdate(
      {
        accountNumber,
        fromDate: startDate,
        toDate: endDate,
      },
      {
        accountNumber,
        fromDate: startDate,
        toDate: endDate,
        statementAmount: statementAmount !== undefined ? statementAmount : null,
        clearedTransactions: clearedTransactions || [],
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      },
    );

    res.json(settings);
  } catch (error) {
    console.error("Error saving reconciliation settings:", error);
    res.status(500).json({ message: error.message });
  }
});

// Update cleared transactions for a specific account and date range
router.put("/:accountNumber/cleared-transactions", async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const { fromDate, toDate, ledgerId, shouldClear } = req.body;

    if (!fromDate || !toDate || ledgerId == null || ledgerId === "") {
      return res.status(400).json({
        message: "fromDate, toDate, and ledgerId are required",
      });
    }

    const startDate = toStartOfDayUTC(fromDate);
    const endDate = toEndOfDayUTC(toDate);
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Invalid fromDate or toDate" });
    }

    let ledgerObjectId;
    try {
      const idStr =
        typeof ledgerId === "string"
          ? ledgerId
          : String(ledgerId?.toString?.() ?? ledgerId);
      if (!idStr || idStr.length < 12) {
        throw new Error("ledgerId too short");
      }
      ledgerObjectId =
        ledgerId instanceof mongoose.Types.ObjectId
          ? ledgerId
          : new mongoose.Types.ObjectId(idStr);
    } catch (idErr) {
      console.error(
        "Invalid ledgerId for cleared-transactions:",
        ledgerId,
        idErr,
      );
      return res.status(400).json({
        message: "Invalid ledgerId. It must be a valid MongoDB ObjectId.",
      });
    }

    const filter = {
      accountNumber,
      fromDate: startDate,
      toDate: endDate,
    };

    let updated;

    if (shouldClear) {
      // Ensure document exists (find or create), then add to cleared list
      let doc = await ReconciliationSettings.findOne(filter);
      if (!doc) {
        doc = new ReconciliationSettings({
          accountNumber,
          fromDate: startDate,
          toDate: endDate,
          clearedTransactions: [],
        });
        await doc.save();
      }
      // Remove if already present, then add (avoid duplicate)
      const alreadyCleared = (doc.clearedTransactions || []).some(
        (ct) => ct.ledgerId && String(ct.ledgerId) === String(ledgerObjectId),
      );
      if (!alreadyCleared) {
        doc.clearedTransactions = doc.clearedTransactions || [];
        doc.clearedTransactions.push({
          ledgerId: ledgerObjectId,
          clearedAt: new Date(),
          clearedBy: "user",
        });
        await doc.save();
      }
      updated = await ReconciliationSettings.findOne(filter);
    } else {
      // Unclear: remove this ledgerId from every document for this account
      await ReconciliationSettings.updateMany(
        {
          accountNumber,
          "clearedTransactions.ledgerId": ledgerObjectId,
        },
        { $pull: { clearedTransactions: { ledgerId: ledgerObjectId } } },
      );
      updated = await ReconciliationSettings.findOne(filter);
      if (!updated) {
        return res.json({
          accountNumber,
          fromDate: startDate,
          toDate: endDate,
          clearedTransactions: [],
        });
      }
      updated = updated.toObject ? updated.toObject() : updated;
    }

    if (!updated) {
      return res.status(404).json({
        message: "Reconciliation settings not found for this date range",
      });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating cleared transactions:", error);
    res.status(500).json({
      message: error?.message || "Internal Server Error",
    });
  }
});

// Update statement amount for a specific account and date range
router.put("/:accountNumber/statement-amount", async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const { fromDate, toDate, statementAmount } = req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        message: "fromDate and toDate are required",
      });
    }

    const startDate = new Date(fromDate);
    startDate.setUTCHours(0, 0, 0, 0);

    const endDate = new Date(toDate);
    endDate.setUTCHours(23, 59, 59, 999);

    let settings = await ReconciliationSettings.findOne({
      accountNumber,
      fromDate: startDate,
      toDate: endDate,
    });

    if (!settings) {
      // Create new settings if they don't exist
      settings = new ReconciliationSettings({
        accountNumber,
        fromDate: startDate,
        toDate: endDate,
        statementAmount: statementAmount !== undefined ? statementAmount : null,
        clearedTransactions: [],
      });
    } else {
      // Update existing settings
      settings.statementAmount =
        statementAmount !== undefined ? statementAmount : null;
    }

    await settings.save();
    res.json(settings);
  } catch (error) {
    console.error("Error updating statement amount:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
