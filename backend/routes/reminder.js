const express = require("express");
const router = express.Router();
const mongoose = require("mongoose"); // Import mongoose
const Reminder = require("../models/Reminder");
const Trade = require("../models/Trade");

const pad2 = (n) => String(n).padStart(2, "0");

const formatDDMMYYYY = (d) => {
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const formatYYYYMMDD = (d) => {
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const buildTradeAddress = (keyInfo) => {
  if (!keyInfo) return "";
  const streetNumber = keyInfo.streetNumber || "";
  const streetName = keyInfo.streetName || "";
  const unit = keyInfo.unit ? ` ${keyInfo.unit}` : "";
  return `${streetNumber} ${streetName}${unit}`.trim();
};

const escapeRegExp = (str) => String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ensureTradeClosingTomorrowReminders = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const tomorrowISO = formatYYYYMMDD(tomorrow);
  const todayDDMM = formatDDMMYYYY(today);
  const tomorrowDDMM = formatDDMMYYYY(tomorrow);

  // 1) Create/refresh reminders for trades closing tomorrow
  const tradesClosingTomorrow = await Trade.find({
    "keyInfo.closeDate": { $in: [tomorrowISO, tomorrowDDMM] },
  }).select({ tradeNumber: 1, keyInfo: 1 });

  for (const trade of tradesClosingTomorrow) {
    const tradeNo = trade.tradeNumber;
    const baseText = `Trade #${tradeNo} closing date is tomorrow`;
    const address = buildTradeAddress(trade.keyInfo);
    const reminderText = `${baseText}${address ? ` - ${address}` : ""} (Closing: ${tomorrowDDMM})`;

    // De-dupe: remove any existing reminder for this trade's "closing tomorrow"
    await Reminder.deleteMany({
      reminder: { $regex: `Trade #${tradeNo}\\s+closing date is tomorrow`, $options: "i" },
    });

    await Reminder.create({
      date: todayDDMM,
      reminder: reminderText,
    });
  }

  // 2) Create/refresh reminders for CONDITIONS due tomorrow
  // To keep it simple and reliable, wipe + recreate condition reminders each fetch.
  await Reminder.deleteMany({
    reminder: { $regex: "condition due tomorrow", $options: "i" },
  });

  const tradesWithConditionsDueTomorrow = await Trade.find({
    conditions: {
      $elemMatch: { dueDate: { $in: [tomorrowISO, tomorrowDDMM] } },
    },
  }).select({ tradeNumber: 1, keyInfo: 1, conditions: 1 });

  for (const trade of tradesWithConditionsDueTomorrow) {
    const tradeNo = trade.tradeNumber;
    const address = buildTradeAddress(trade.keyInfo);

    const dueTomorrowConditions = Array.isArray(trade.conditions)
      ? trade.conditions.filter(
          (c) => (c?.dueDate || "") === tomorrowISO || (c?.dueDate || "") === tomorrowDDMM
        )
      : [];

    for (const cond of dueTomorrowConditions) {
      const conditionText = (cond?.conditionText || "").trim();
      const baseText = `Trade #${tradeNo} condition due tomorrow`;
      const reminderText = `${baseText}${
        conditionText ? `: ${conditionText}` : ""
      }${address ? ` - ${address}` : ""} (Due: ${tomorrowDDMM})`;

      // Extra de-dupe (in case of multiple fetches racing)
      await Reminder.deleteMany({
        reminder: {
          $regex: `${escapeRegExp(baseText)}${
            conditionText ? `:\\s*${escapeRegExp(conditionText)}` : ""
          }`,
          $options: "i",
        },
      });

      await Reminder.create({
        date: todayDDMM,
        reminder: reminderText,
      });
    }
  }

  // 3) Cleanup: delete stale "closing tomorrow" reminders for trades that are NOT closing tomorrow
  const existingClosingTomorrowReminders = await Reminder.find({
    reminder: { $regex: "closing date is tomorrow", $options: "i" },
  }).select({ _id: 1, reminder: 1 });

  const tradeNos = [];
  const idToTradeNo = new Map();
  const re = /Trade\s+#(\d+)\s+closing date is tomorrow/i;
  for (const r of existingClosingTomorrowReminders) {
    const m = (r.reminder || "").match(re);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (!Number.isNaN(n)) {
        tradeNos.push(n);
        idToTradeNo.set(String(r._id), n);
      }
    }
  }

  if (tradeNos.length) {
    const trades = await Trade.find({ tradeNumber: { $in: tradeNos } }).select({
      tradeNumber: 1,
      keyInfo: 1,
    });
    const tradeNoToClose = new Map(
      trades.map((t) => [t.tradeNumber, t.keyInfo?.closeDate || ""])
    );

    const staleIds = [];
    for (const r of existingClosingTomorrowReminders) {
      const tradeNo = idToTradeNo.get(String(r._id));
      if (!tradeNo) continue;
      const close = tradeNoToClose.get(tradeNo) || "";
      if (close !== tomorrowISO) staleIds.push(r._id);
    }
    if (staleIds.length) {
      await Reminder.deleteMany({ _id: { $in: staleIds } });
    }
  }
};

// GET /api/reminders - Fetch all reminders
router.get("/", async (req, res) => {
  try {
    // Auto-generate system reminders before returning
    await ensureTradeClosingTomorrowReminders();
    const reminders = await Reminder.find().sort({ date: 1 }); // Sort by date, or as preferred
    res.json(reminders);
  } catch (err) {
    console.error("❌ Failed to fetch reminders:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// POST /api/reminders
router.post("/", async (req, res) => {
  const { date, reminder } = req.body;

  if (!date || !reminder) {
    return res.status(400).json({ message: "Date and reminder are required." });
  }

  try {
    const newReminder = new Reminder({ date, reminder });
    await newReminder.save();
    res.status(201).json({ message: "Reminder saved successfully." });
  } catch (err) {
    console.error("❌ Failed to save reminder:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// PUT /api/reminders/:id - Update a reminder
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { date, reminder } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid reminder ID." });
  }

  if (!date || !reminder) {
    return res
      .status(400)
      .json({ message: "Date and reminder are required for update." });
  }

  try {
    const updatedReminder = await Reminder.findByIdAndUpdate(
      id,
      { date, reminder },
      { new: true, runValidators: true }, // Return the updated document and run schema validators
    );

    if (!updatedReminder) {
      return res.status(404).json({ message: "Reminder not found." });
    }

    res.json({
      message: "Reminder updated successfully.",
      reminder: updatedReminder,
    });
  } catch (err) {
    console.error("❌ Failed to update reminder:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// DELETE /api/reminders/testdelete - DIAGNOSTIC ROUTE
router.delete("/testdelete", async (req, res) => {
  // const { id } = req.params; // No ID in this test route

  // if (!mongoose.Types.ObjectId.isValid(id)) {
  //   return res.status(400).json({ message: "Invalid reminder ID for test." });
  // }

  try {
    // const deletedReminder = await Reminder.findByIdAndDelete(id); // Cannot delete without an ID

    // if (!deletedReminder) {
    //   return res.status(404).json({ message: "Reminder not found for test." });
    // }

    res.json({ message: "Test delete route reached successfully." });
  } catch (err) {
    console.error("❌ Error in test delete route:", err);
    res.status(500).json({ message: "Internal Server Error in test delete" });
  }
});

// Original DELETE /api/reminders/:id - Delete a reminder
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid reminder ID." });
  }

  try {
    const deletedReminder = await Reminder.findByIdAndDelete(id);

    if (!deletedReminder) {
      return res.status(404).json({ message: "Reminder not found." });
    }

    res.json({ message: "Reminder deleted successfully." });
  } catch (err) {
    console.error("❌ Failed to delete reminder:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = router;
