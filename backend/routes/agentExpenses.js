const express = require("express");
const router = express.Router();
const {
  AgentExpense,
  AgentExpenseCounter,
  EXPENSE_LINE_KEYS,
} = require("../models/AgentExpense");
const Agent = require("../models/Agent");
const Ledger = require("../models/Ledger");

const NO_TAX_KEYS = new Set(["bankCharge", "garnishment"]);

const LINE_LABELS = {
  deskFee: "Desk fee",
  courierFee: "Courier fee",
  bankCharge: "Bank charge",
  otherFee: "Other fee",
  commissionDeduction: "Commission deduction",
  garnishment: "Garnishment",
};

const ACCOUNT_NAMES = {
  "12100": "A/R - Agt's Recoverable- Gen Exp",
  "23000": "HST Collected",
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseLocalDate(value) {
  if (!value) return new Date();
  const raw = String(value).trim();
  if (raw.includes("/")) {
    const parts = raw.split("/");
    if (parts.length === 3) {
      // Accept MM/DD/YYYY
      const [m, d, y] = parts;
      return new Date(
        `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`
      );
    }
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return new Date(`${raw.slice(0, 10)}T00:00:00`);
  }
  return new Date(raw);
}

function normalizeLines(raw = {}) {
  const lines = {};
  for (const key of EXPENSE_LINE_KEYS) {
    lines[key] = round2(raw[key] || 0);
  }
  return lines;
}

function computeTotals(lines, taxRatePercent) {
  const rate = Number(taxRatePercent);
  const taxRate =
    Number.isFinite(rate) && rate > 0
      ? rate > 1
        ? rate / 100
        : rate
      : 0.13;

  let amount = 0;
  let hst = 0;
  const breakdown = [];

  for (const key of EXPENSE_LINE_KEYS) {
    const base = round2(lines[key] || 0);
    if (base <= 0) continue;
    const taxable = !NO_TAX_KEYS.has(key);
    const lineHst = taxable ? round2(base * taxRate) : 0;
    const lineTotal = round2(base + lineHst);
    amount = round2(amount + base);
    hst = round2(hst + lineHst);
    breakdown.push({
      key,
      label: LINE_LABELS[key],
      base,
      hst: lineHst,
      total: lineTotal,
      taxable,
      isCommissionDeduction: key === "commissionDeduction",
    });
  }

  return {
    amount,
    hst,
    total: round2(amount + hst),
    taxRate: round2(taxRate * 100),
    breakdown,
  };
}

function invoiceTaxRateDecimal(row) {
  const rate = Number(row?.taxRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0.13;
  return rate > 1 ? rate / 100 : rate;
}

/** Incl. HST capacity for one expense type on an AE invoice. */
function lineTotalOnInvoice(row, key) {
  const base = round2(row?.lines?.[key] || 0);
  if (base <= 0) return 0;
  const taxable = !NO_TAX_KEYS.has(key);
  const hst = taxable ? round2(base * invoiceTaxRateDecimal(row)) : 0;
  return round2(base + hst);
}

/**
 * Dollars already applied to one expense type on an invoice.
 * Prefer per-line application metadata; fall back to invoice applied ratio.
 */
function lineAppliedOnInvoice(row, key) {
  const apps = row?.applications || [];
  let fromLines = 0;
  let hasLineMeta = false;
  for (const app of apps) {
    const v = Number(app?.lines?.[key]) || 0;
    if (v > 0) hasLineMeta = true;
    fromLines = round2(fromLines + v);
  }
  if (hasLineMeta || apps.length > 0) {
    // When apps exist, lines hold dollars applied per type (new sync) or 0.
    // If older apps lack this key, fromLines stays 0 for that key.
    if (hasLineMeta) return fromLines;
  }
  const capacity = lineTotalOnInvoice(row, key);
  if (capacity <= 0) return 0;
  const totalAll = round2(row.total || 0);
  const appliedAll = round2(row.applied || 0);
  if (totalAll <= 0 || appliedAll <= 0) return 0;
  return round2(capacity * (appliedAll / totalAll));
}

function lineBalanceOnInvoice(row, key) {
  return round2(lineTotalOnInvoice(row, key) - lineAppliedOnInvoice(row, key));
}

function emptyLineMap() {
  const m = {};
  for (const key of EXPENSE_LINE_KEYS) m[key] = 0;
  return m;
}

function buildLedgerEntries({
  breakdown,
  glAccount,
  glAccountName,
  aeNumber,
  invoiceNumber,
  agentName,
  postDate,
}) {
  const dateStr =
    postDate instanceof Date
      ? postDate.toISOString().slice(0, 10)
      : String(postDate).slice(0, 10);
  const descBase = `AE ${aeNumber} Inv #${invoiceNumber} - ${agentName}`;
  const entries = [];

  for (const line of breakdown) {
    const lineDesc = `${descBase} - ${line.label}`;

    if (line.isCommissionDeduction) {
      // Debit 12100 (amount), Debit 23000 (HST), Credit selected G/L (total)
      entries.push({
        accountNumber: "12100",
        accountName: ACCOUNT_NAMES["12100"],
        debit: line.base,
        credit: 0,
        description: lineDesc,
        reference: aeNumber,
        type: "AgentExpense",
        date: dateStr,
        chequeDate: postDate,
      });
      if (line.hst > 0) {
        entries.push({
          accountNumber: "23000",
          accountName: ACCOUNT_NAMES["23000"],
          debit: line.hst,
          credit: 0,
          description: lineDesc,
          reference: aeNumber,
          type: "AgentExpense",
          date: dateStr,
          chequeDate: postDate,
        });
      }
      entries.push({
        accountNumber: glAccount,
        accountName: glAccountName || glAccount,
        debit: 0,
        credit: line.total,
        description: lineDesc,
        reference: aeNumber,
        type: "AgentExpense",
        date: dateStr,
        chequeDate: postDate,
      });
      continue;
    }

    // Standard / no-tax:
    // Credit selected G/L (amount), Debit 12100 (total), Credit 23000 (HST if any)
    entries.push({
      accountNumber: glAccount,
      accountName: glAccountName || glAccount,
      debit: 0,
      credit: line.base,
      description: lineDesc,
      reference: aeNumber,
      type: "AgentExpense",
      date: dateStr,
      chequeDate: postDate,
    });
    entries.push({
      accountNumber: "12100",
      accountName: ACCOUNT_NAMES["12100"],
      debit: line.total,
      credit: 0,
      description: lineDesc,
      reference: aeNumber,
      type: "AgentExpense",
      date: dateStr,
      chequeDate: postDate,
    });
    if (line.hst > 0) {
      entries.push({
        accountNumber: "23000",
        accountName: ACCOUNT_NAMES["23000"],
        debit: 0,
        credit: line.hst,
        description: lineDesc,
        reference: aeNumber,
        type: "AgentExpense",
        date: dateStr,
        chequeDate: postDate,
      });
    }
  }

  return entries;
}

router.get("/next-numbers", async (_req, res) => {
  try {
    const nums = await AgentExpenseCounter.peekNextNumbers();
    res.json(nums);
  } catch (error) {
    console.error("Error peeking AE numbers:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.agentId) filter.agentId = req.query.agentId;
    const rows = await AgentExpense.find(filter).sort({ createdAt: -1 }).lean();
    res.json(
      rows.map((r) => ({
        ...r,
        balance: round2((r.total || 0) - (r.applied || 0)),
      }))
    );
  } catch (error) {
    console.error("Error listing agent expenses:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/totals-by-type", async (req, res) => {
  try {
    const filter = {};
    if (req.query.agentId) filter.agentId = req.query.agentId;
    if (req.query.from || req.query.to) {
      filter.invoiceDate = {};
      if (req.query.from) {
        filter.invoiceDate.$gte = parseLocalDate(req.query.from);
      }
      if (req.query.to) {
        const to = parseLocalDate(req.query.to);
        to.setHours(23, 59, 59, 999);
        filter.invoiceDate.$lte = to;
      }
    }

    const rows = await AgentExpense.find(filter).lean();
    const map = new Map();

    for (const row of rows) {
      const agentKey = String(row.agentId);
      const agentName = row.agentName || "";

      for (const key of EXPENSE_LINE_KEYS) {
        const lineTotal = lineTotalOnInvoice(row, key);
        if (lineTotal <= 0) continue;
        const lineApplied = lineAppliedOnInvoice(row, key);
        const lineBalance = round2(lineTotal - lineApplied);
        const mapKey = `${agentKey}|${key}`;
        const existing = map.get(mapKey) || {
          agentId: row.agentId,
          agentName,
          expenseKey: key,
          expense: LINE_LABELS[key],
          total: 0,
          applied: 0,
          balance: 0,
          trades: new Set(),
        };
        existing.total = round2(existing.total + lineTotal);
        existing.applied = round2(existing.applied + lineApplied);
        existing.balance = round2(existing.balance + lineBalance);

        for (const app of row.applications || []) {
          if ((Number(app?.lines?.[key]) || 0) <= 0) continue;
          const tn = String(app.tradeNumber || "").trim();
          if (tn) existing.trades.add(tn);
        }
        // Legacy invoices: trade list on appliedTrades when line has applied via ratio
        if (lineApplied > 0 && !(row.applications || []).length) {
          for (const t of row.appliedTrades || []) {
            const trimmed = String(t || "").trim();
            if (trimmed) existing.trades.add(trimmed);
          }
        }
        map.set(mapKey, existing);
      }
    }

    const result = Array.from(map.values())
      .map((r) => ({
        ...r,
        trades: Array.from(r.trades).join(", "),
      }))
      .sort((a, b) =>
        a.agentName === b.agentName
          ? a.expense.localeCompare(b.expense)
          : a.agentName.localeCompare(b.agentName)
      );

    res.json(result);
  } catch (error) {
    console.error("Error building expense totals:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/balances/:agentId", async (req, res) => {
  try {
    const rows = await AgentExpense.find({ agentId: req.params.agentId }).lean();
    const posted = {};
    const remaining = {};
    for (const key of EXPENSE_LINE_KEYS) {
      posted[key] = 0;
      remaining[key] = 0;
    }

    for (const row of rows) {
      for (const key of EXPENSE_LINE_KEYS) {
        const lineTotal = lineTotalOnInvoice(row, key);
        if (lineTotal <= 0) continue;
        const lineApplied = lineAppliedOnInvoice(row, key);
        posted[key] = round2(posted[key] + lineTotal);
        remaining[key] = round2(remaining[key] + (lineTotal - lineApplied));
      }
    }

    res.json({ posted, remaining });
  } catch (error) {
    console.error("Error fetching agent expense balances:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * Per-agent, per-fee-type amounts (tax-inclusive) applied on a specific trade.
 * Used by Financial sheet to print Desk fee / Other fee / etc. as separate rows.
 */
router.get("/applied-on-trade/:tradeNumber", async (req, res) => {
  try {
    const tradeNumber = String(req.params.tradeNumber || "").trim();
    if (!tradeNumber) {
      return res.status(400).json({ message: "tradeNumber is required" });
    }

    const rows = await AgentExpense.find({
      $or: [
        { "applications.tradeNumber": tradeNumber },
        { appliedTrades: tradeNumber },
      ],
    }).lean();

    /** @type {Record<string, { agentId: string, employeeNo: number|null, agentName: string, appliedIncl: Record<string, number> }>} */
    const byEmployee = {};

    const ensureAgent = (row) => {
      const empKey =
        row.agentEmployeeNo != null && row.agentEmployeeNo !== ""
          ? String(row.agentEmployeeNo)
          : null;
      const idKey = String(row.agentId);
      const primary = empKey || idKey;
      if (!byEmployee[primary]) {
        byEmployee[primary] = {
          agentId: idKey,
          employeeNo:
            row.agentEmployeeNo != null ? Number(row.agentEmployeeNo) : null,
          agentName: row.agentName || "",
          appliedIncl: emptyLineMap(),
        };
      }
      const bucket = byEmployee[primary];
      if (empKey) byEmployee[empKey] = bucket;
      byEmployee[idKey] = bucket;
      return bucket;
    };

    for (const row of rows) {
      const apps = (row.applications || []).filter(
        (a) => String(a.tradeNumber || "").trim() === tradeNumber,
      );

      if (apps.length > 0) {
        const bucket = ensureAgent(row);
        for (const app of apps) {
          let hasLineMeta = false;
          for (const key of EXPENSE_LINE_KEYS) {
            const v = Number(app?.lines?.[key]) || 0;
            if (v > 0) {
              hasLineMeta = true;
              bucket.appliedIncl[key] = round2(bucket.appliedIncl[key] + v);
            }
          }
          // Legacy app without per-line meta: split amount across invoice line capacities
          if (!hasLineMeta) {
            const appAmt = round2(Number(app.amount) || 0);
            if (appAmt <= 0) continue;
            const capacities = {};
            let capSum = 0;
            for (const key of EXPENSE_LINE_KEYS) {
              const cap = lineTotalOnInvoice(row, key);
              if (cap > 0) {
                capacities[key] = cap;
                capSum = round2(capSum + cap);
              }
            }
            if (capSum <= 0) continue;
            for (const key of Object.keys(capacities)) {
              const share = round2(appAmt * (capacities[key] / capSum));
              if (share > 0) {
                bucket.appliedIncl[key] = round2(
                  bucket.appliedIncl[key] + share,
                );
              }
            }
          }
        }
        continue;
      }

      // Legacy: trade listed on appliedTrades only — allocate invoice applied by line ratio
      if ((row.appliedTrades || []).some((t) => String(t).trim() === tradeNumber)) {
        const bucket = ensureAgent(row);
        const appliedAll = round2(row.applied || 0);
        const totalAll = round2(row.total || 0);
        if (appliedAll <= 0 || totalAll <= 0) continue;
        for (const key of EXPENSE_LINE_KEYS) {
          const capacity = lineTotalOnInvoice(row, key);
          if (capacity <= 0) continue;
          const share = round2(capacity * (appliedAll / totalAll));
          if (share > 0) {
            bucket.appliedIncl[key] = round2(bucket.appliedIncl[key] + share);
          }
        }
      }
    }

    res.json({ tradeNumber, byEmployeeNo: byEmployee });
  } catch (error) {
    console.error("Error fetching applied-on-trade expenses:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      agentId,
      glAccount,
      glAccountName,
      invoiceDate,
      postDate,
      taxRate,
      lines: rawLines,
      invoiceNumber: bodyInvoice,
    } = req.body;

    if (!agentId) {
      return res.status(400).json({ message: "Agent is required" });
    }
    if (!glAccount) {
      return res.status(400).json({ message: "G/L Account is required" });
    }

    const agent = await Agent.findById(agentId);
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    const lines = normalizeLines(rawLines);
    const hasAny = EXPENSE_LINE_KEYS.some((k) => lines[k] > 0);
    if (!hasAny) {
      return res
        .status(400)
        .json({ message: "Enter at least one expense amount" });
    }

    const totals = computeTotals(lines, taxRate);
    const nums = await AgentExpenseCounter.getNextNumbers();
    const aeNumber = nums.aeNumber;
    const invoiceNumber = (bodyInvoice || "").trim() || nums.invoiceNumber;
    const agentName =
      `${agent.firstName || ""} ${agent.lastName || ""}`.trim() ||
      agent.legalName ||
      "Agent";
    const parsedInvoiceDate = parseLocalDate(invoiceDate);
    const parsedPostDate = parseLocalDate(postDate);

    const expense = new AgentExpense({
      aeNumber,
      invoiceNumber,
      agentId,
      agentEmployeeNo: agent.employeeNo,
      agentName,
      glAccount,
      glAccountName: glAccountName || "",
      invoiceDate: parsedInvoiceDate,
      postDate: parsedPostDate,
      taxRate: totals.taxRate,
      lines,
      amount: totals.amount,
      hst: totals.hst,
      total: totals.total,
      applied: 0,
      appliedTrades: [],
    });

    await expense.save();

    const ledgerRows = buildLedgerEntries({
      breakdown: totals.breakdown,
      glAccount,
      glAccountName: glAccountName || glAccount,
      aeNumber,
      invoiceNumber,
      agentName,
      postDate: parsedPostDate,
    });

    for (const row of ledgerRows) {
      await Ledger.create(row);
    }

    const json = expense.toObject({ virtuals: true });
    json.balance = round2(json.total - (json.applied || 0));
    res.status(201).json(json);
  } catch (error) {
    console.error("Error posting agent expense:", error);
    res.status(500).json({ message: "Server error while posting expense" });
  }
});

/**
 * When office expenses are added on a trade (Agent Commission), mark them Applied
 * on matching Agent Expense invoice lines (FIFO per expense type) and record the trade #.
 * Body: { tradeNumber, agents: [{ employeeNo, amounts: { deskFee, ... }, taxRate }] }
 */
router.post("/sync-trade", async (req, res) => {
  try {
    const tradeNumber = String(req.body?.tradeNumber ?? "").trim();
    const agentsPayload = Array.isArray(req.body?.agents) ? req.body.agents : [];
    if (!tradeNumber) {
      return res.status(400).json({ message: "tradeNumber is required" });
    }

    // 1) Remove prior applications for this trade from all AE invoices
    const previouslyApplied = await AgentExpense.find({
      "applications.tradeNumber": tradeNumber,
    });
    for (const doc of previouslyApplied) {
      doc.applications = (doc.applications || []).filter(
        (a) => String(a.tradeNumber) !== tradeNumber,
      );
      doc.recomputeApplied();
      await doc.save();
    }

    // Also clear legacy appliedTrades entries without applications
    const legacy = await AgentExpense.find({
      appliedTrades: tradeNumber,
      $or: [
        { applications: { $exists: false } },
        { applications: { $size: 0 } },
      ],
    });
    for (const doc of legacy) {
      doc.appliedTrades = (doc.appliedTrades || []).filter(
        (t) => String(t) !== tradeNumber,
      );
      if (!(doc.applications || []).length && doc.appliedTrades.length === 0) {
        doc.applied = 0;
      }
      await doc.save();
    }

    const results = [];

    for (const entry of agentsPayload) {
      const employeeNo = entry.employeeNo ?? entry.agentEmployeeNo;
      const amounts = entry.amounts || {};
      const taxRate = entry.taxRate != null ? entry.taxRate : 13;

      let agentDoc = null;
      if (entry.agentId) {
        agentDoc = await Agent.findById(entry.agentId);
      }
      if (!agentDoc && employeeNo != null && employeeNo !== "") {
        agentDoc = await Agent.findOne({ employeeNo: Number(employeeNo) });
      }
      if (!agentDoc) continue;

      const totals = computeTotals(normalizeLines(amounts), taxRate);
      if (totals.total <= 0) {
        results.push({
          agentId: agentDoc._id,
          employeeNo: agentDoc.employeeNo,
          applied: 0,
        });
        continue;
      }

      const invoices = await AgentExpense.find({ agentId: agentDoc._id }).sort({
        invoiceDate: 1,
        createdAt: 1,
      });

      let appliedForAgent = 0;
      let unallocated = 0;
      const appliedByType = emptyLineMap();

      // Apply each expense type only against invoices that carry that type
      for (const line of totals.breakdown) {
        let remainingToApply = line.total;
        if (remainingToApply <= 0) continue;

        for (const inv of invoices) {
          if (remainingToApply <= 0) break;
          const lineBal = lineBalanceOnInvoice(inv, line.key);
          if (lineBal <= 0) continue;

          const take = round2(Math.min(lineBal, remainingToApply));
          if (take <= 0) continue;

          const lineMeta = emptyLineMap();
          lineMeta[line.key] = take;

          inv.applications = inv.applications || [];
          inv.applications.push({
            tradeNumber,
            amount: take,
            lines: lineMeta,
            at: new Date(),
          });
          inv.recomputeApplied();
          await inv.save();

          remainingToApply = round2(remainingToApply - take);
          appliedForAgent = round2(appliedForAgent + take);
          appliedByType[line.key] = round2(
            appliedByType[line.key] + take,
          );
        }

        unallocated = round2(unallocated + remainingToApply);
      }

      results.push({
        agentId: agentDoc._id,
        employeeNo: agentDoc.employeeNo,
        requested: totals.total,
        applied: appliedForAgent,
        appliedByType,
        unallocated,
      });
    }

    res.json({ tradeNumber, results });
  } catch (error) {
    console.error("Error syncing agent expenses from trade:", error);
    res.status(500).json({ message: "Server error while syncing expenses" });
  }
});

module.exports = router;
