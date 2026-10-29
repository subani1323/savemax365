/**
 * YTD totals for an agent's commission EFTs — aligned with EFT receipt / commission grid:
 * - Gross: sum of pre-rebate agent base (`amount` + buyer rebate when applicable) per EFT
 * - Buyer rebate: sum of `buyerRebateAmount` (YTD column on receipt when present)
 * - Office: sum of plan amount (`feesDeducted`) per EFT; fallback from agent fee plan if missing
 * - Office expenses: recovered AE lines excl. commission deduction (base + HST where taxable)
 * - Commission deduction: commission deduction line alone (base + HST)
 * - HST: sum of taxRate × (agent amount − office plan) per EFT (matches Financial sheet / receipt)
 * - NET: sum of eft.amount
 * Date window: Jan 1 through EFT cheque date (inclusive), using chequeDate || date.
 */

const DEFAULT_TAX_RATE = 0.13;
const INCLUSIVE_HST_FRACTION = DEFAULT_TAX_RATE / (1 + DEFAULT_TAX_RATE);

const OFFICE_EXPENSE_FIELDS = [
  { key: "deskFee", taxable: true },
  { key: "courierFee", taxable: true },
  { key: "bankCharge", taxable: false },
  { key: "otherFee", taxable: true },
  { key: "commissionDeduction", taxable: true },
  { key: "garnishment", taxable: false },
];
const NO_TAX_EXPENSE_KEYS = new Set(["bankCharge", "garnishment"]);

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Decimal rate (e.g. 0.13); supports custom whole percent on trade. */
function getTradeTaxRate(trade) {
  if (trade?.customTaxRate != null && trade.customTaxRate !== "") {
    const n = Number(trade.customTaxRate);
    if (!Number.isFinite(n)) return DEFAULT_TAX_RATE;
    if (n > 1 && n <= 100) return n / 100;
    return n;
  }
  return DEFAULT_TAX_RATE;
}

/**
 * @param {string} throughDateStr - MM/DD/YYYY or YYYY-MM-DD
 * @returns {{ start: Date, end: Date, year: number } | null}
 */
function parseThroughBounds(throughDateStr) {
  if (!throughDateStr || typeof throughDateStr !== "string") return null;
  const s = throughDateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
    if (!y || !m || !d) return null;
    const start = new Date(y, 0, 1, 0, 0, 0, 0);
    const end = new Date(y, m - 1, d, 23, 59, 59, 999);
    return { start, end, year: y };
  }
  if (s.includes("/")) {
    const parts = s.split("/");
    if (parts.length !== 3) return null;
    const [month, day, year] = parts.map((x) => parseInt(x, 10));
    if (!year || !month || !day) return null;
    const start = new Date(year, 0, 1, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);
    return { start, end, year };
  }
  return null;
}

function effectivePaymentDate(eft) {
  return eft.chequeDate || eft.date;
}

/** yyyy-mm-dd in server local calendar (lexicographic compare = chronological). */
function toYmdLocal(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isEftInYtdWindow(eft, bounds) {
  const eff = effectivePaymentDate(eft);
  if (!eff) return false;
  const ymd = toYmdLocal(eff);
  const startYmd = toYmdLocal(bounds.start);
  const endYmd = toYmdLocal(bounds.end);
  if (!ymd || !startYmd || !endYmd) return false;
  return ymd >= startYmd && ymd <= endYmd;
}

function normId(v) {
  if (v == null || v === "") return "";
  return String(v).trim();
}

/**
 * Whether this EFT belongs to the requested agent (employee # or raw eft.agentId).
 * Handles eft.agentId = employee string, or Mongo agent _id, vs URL param = employee #.
 */
function matchesTargetAgent(eft, requestedAgentId, agents) {
  const want = normId(requestedAgentId);
  if (!want) return false;
  const raw = normId(eft.agentId);
  if (raw === want) return true;

  const agentForEft = agents.find(
    (a) => normId(a.employeeNo) === raw || String(a._id) === raw,
  );
  if (
    agentForEft?.employeeNo != null &&
    normId(agentForEft.employeeNo) !== ""
  ) {
    if (normId(agentForEft.employeeNo) === want) return true;
  }

  const agentByWant = agents.find((a) => normId(a.employeeNo) === want);
  if (agentByWant && String(agentByWant._id) === raw) return true;

  return false;
}

/** Desk/plan dollar amount (before HST on office fees), for fallback when trade row has no feesDeducted. */
function calculatedBasePlanFee(eft, agent) {
  if (!agent?.feeInfo) return 0;
  const amt = parseFloat(eft.amount) || 0;
  switch (agent.feeInfo) {
    case "referralBroker":
      return 0;
    case "plan250":
      return 250;
    case "plan500":
      return 500;
    case "plan9010":
      return round2(amt * 0.1);
    case "plan955":
      return round2(amt * 0.05);
    case "plan8515":
      return round2(amt * DEFAULT_TAX_RATE);
    case "plan5050":
      return round2(amt * 0.5);
    case "plan8020":
      return round2(amt * 0.2);
    case "plan150":
      return 150;
    default:
      return 0;
  }
}

function normalizeExpenseRate(taxRate) {
  let r = Number(taxRate);
  if (!Number.isFinite(r) || r < 0) return DEFAULT_TAX_RATE;
  if (r > 1 && r <= 100) r = r / 100;
  return r;
}

/** Resolve selected office expense bases on a trade agent row. */
function resolveOfficeExpenseAmounts(agentRow = {}) {
  const amounts = agentRow.officeExpenseAmounts || {};
  if (agentRow.officeExpensesEnabled === false) return {};
  if (
    agentRow.officeExpenseSelected &&
    typeof agentRow.officeExpenseSelected === "object"
  ) {
    const out = {};
    for (const field of OFFICE_EXPENSE_FIELDS) {
      if (!agentRow.officeExpenseSelected[field.key]) continue;
      const base = round2(parseFloat(amounts[field.key]) || 0);
      if (base > 0) out[field.key] = base;
    }
    return out;
  }
  const out = {};
  for (const field of OFFICE_EXPENSE_FIELDS) {
    const base = round2(parseFloat(amounts[field.key]) || 0);
    if (base > 0) out[field.key] = base;
  }
  return out;
}

function recoveryTotalForAmounts(amounts, taxRate) {
  const rate = normalizeExpenseRate(taxRate);
  let taxableBase = 0;
  let noTaxBase = 0;
  for (const field of OFFICE_EXPENSE_FIELDS) {
    const base = round2(amounts?.[field.key] || 0);
    if (base <= 0) continue;
    if (NO_TAX_EXPENSE_KEYS.has(field.key) || !field.taxable) {
      noTaxBase = round2(noTaxBase + base);
    } else {
      taxableBase = round2(taxableBase + base);
    }
  }
  return round2(taxableBase * (1 + rate) + noTaxBase);
}

/** Office expenses (excl. commission deduction) + commission deduction recovery for one agent row. */
function splitOfficeExpenseRecovery(agentRow, trade) {
  const resolved = resolveOfficeExpenseAmounts(agentRow);
  const officeRate =
    agentRow?.officeExpenseTaxRate != null && agentRow.officeExpenseTaxRate !== ""
      ? agentRow.officeExpenseTaxRate
      : getTradeTaxRate(trade);
  const commissionBase = round2(resolved.commissionDeduction || 0);
  const withoutCd = { ...resolved };
  delete withoutCd.commissionDeduction;
  return {
    officeExpenses: recoveryTotalForAmounts(withoutCd, officeRate),
    commissionDeduction: recoveryTotalForAmounts(
      commissionBase > 0 ? { commissionDeduction: commissionBase } : {},
      officeRate,
    ),
  };
}

/** Same matching order as FinancialReportsAgentsPayment.jsx */
function findAgentCommissionRow(trade, eft, agent) {
  let agentCommission = null;
  if (trade?.agentCommissionList?.length > 0) {
    agentCommission = trade.agentCommissionList.find(
      (ac) => String(ac.agentId) === String(eft.agentId),
    );
    if (!agentCommission) {
      agentCommission = trade.agentCommissionList.find(
        (ac) => ac.agentName === eft.agentName,
      );
    }
    if (!agentCommission && agent?.employeeNo != null) {
      agentCommission = trade.agentCommissionList.find(
        (ac) => String(ac.agentId) === String(agent.employeeNo),
      );
    }
    if (!agentCommission && trade.agentCommissionList.length === 1) {
      agentCommission = trade.agentCommissionList[0];
    }
  }
  return agentCommission;
}

/**
 * Sum agent base (`amount`) and plan amount (`feesDeducted`) for this EFT’s trade row(s).
 * Mirrors CommissionTrustPayments (AGENT DOUBLE ENDER = all matching double-ender rows).
 */
function aggregateAgentCommissionForEft(trade, eft, agent) {
  if (!trade?.agentCommissionList?.length) {
    return {
      totalAmount: 0,
      totalPlanAmount: 0,
      totalBuyerRebate: 0,
      totalOfficeExpenses: 0,
      totalCommissionDeduction: 0,
      rows: [],
    };
  }
  const isDouble = trade.keyInfo?.classification === "AGENT DOUBLE ENDER";
  const matchRow = (ac) => {
    if (String(ac.agentId) === String(eft.agentId)) return true;
    if (eft.agentName && ac.agentName === eft.agentName) return true;
    if (
      agent?.employeeNo != null &&
      String(ac.agentId) === String(agent.employeeNo)
    ) {
      return true;
    }
    return false;
  };
  let rows = trade.agentCommissionList.filter(matchRow);
  if (isDouble) {
    rows = rows.filter((ac) => ac.classification === "AGENT DOUBLE ENDER");
  }
  if (rows.length === 0) {
    const single = findAgentCommissionRow(trade, eft, agent);
    rows = single ? [single] : [];
  }
  const totalAmount = rows.reduce(
    (s, ac) => s + (parseFloat(ac.amount) || 0),
    0,
  );
  const totalPlanAmount = rows.reduce(
    (s, ac) => s + (parseFloat(ac.feesDeducted) || 0),
    0,
  );
  const totalBuyerRebate = rows.reduce((s, ac) => {
    if (
      String(ac.buyerRebateIncluded || "").toLowerCase() === "yes" &&
      ac.buyerRebateAmount
    ) {
      return s + (parseFloat(ac.buyerRebateAmount) || 0);
    }
    return s;
  }, 0);
  let totalOfficeExpenses = 0;
  let totalCommissionDeduction = 0;
  for (const ac of rows) {
    const split = splitOfficeExpenseRecovery(ac, trade);
    totalOfficeExpenses = round2(totalOfficeExpenses + split.officeExpenses);
    totalCommissionDeduction = round2(
      totalCommissionDeduction + split.commissionDeduction,
    );
  }
  return {
    totalAmount,
    totalPlanAmount,
    totalBuyerRebate,
    totalOfficeExpenses,
    totalCommissionDeduction,
    rows,
  };
}

/**
 * @param {string} requestedAgentId - employee # or eft.agentId string
 * @param {string} throughDateStr
 * @param {import('mongoose').Model} CommissionTrustEFT
 * @param {import('mongoose').Model} Agent
 */
async function computeAgentCommissionYtd(
  requestedAgentId,
  throughDateStr,
  CommissionTrustEFT,
  Agent,
) {
  const bounds = parseThroughBounds(throughDateStr);
  if (!bounds) {
    const err = new Error("INVALID_THROUGH_DATE");
    err.code = "INVALID_THROUGH_DATE";
    throw err;
  }
  const [efts, agents] = await Promise.all([
    CommissionTrustEFT.find({ type: "AgentCommissionTransfer" })
      .populate("tradeId")
      .lean(),
    Agent.find().lean(),
  ]);

  let ytdOffice = 0;
  let ytdOfficeExpenses = 0;
  let ytdCommissionDeduction = 0;
  let ytdHst = 0;
  let ytdNet = 0;
  let ytdGrossBase = 0;
  let ytdBuyerRebate = 0;

  for (const eft of efts) {
    if (!matchesTargetAgent(eft, requestedAgentId, agents)) continue;
    if (!isEftInYtdWindow(eft, bounds)) continue;

    const agent = agents.find(
      (a) =>
        a.employeeNo?.toString() === String(eft.agentId) ||
        String(a._id) === String(eft.agentId),
    );

    const trade =
      eft.tradeId && typeof eft.tradeId === "object" ? eft.tradeId : null;

    const net = parseFloat(eft.amount) || 0;

    const {
      totalAmount,
      totalPlanAmount,
      totalBuyerRebate,
      totalOfficeExpenses,
      totalCommissionDeduction,
    } = aggregateAgentCommissionForEft(trade, eft, agent);

    // Trade agent `amount` is full commission; buyer rebate is separate (YTD rebate column still sums totalBuyerRebate).
    let rowGross = totalAmount;
    let rowOfficePlan = totalPlanAmount;

    if (rowOfficePlan <= 0 && agent?.feeInfo) {
      rowOfficePlan = calculatedBasePlanFee(eft, agent);
    }

    const taxableAfterPlan = Math.max(0, round2(rowGross - rowOfficePlan));
    let rowHst;
    if (trade && rowGross > 0) {
      rowHst = round2(taxableAfterPlan * getTradeTaxRate(trade));
    } else {
      rowHst = round2(net * INCLUSIVE_HST_FRACTION);
    }

    if (rowGross <= 0) {
      rowGross = round2(net - rowHst);
    }

    ytdNet += net;
    ytdOffice += rowOfficePlan;
    ytdOfficeExpenses += totalOfficeExpenses || 0;
    ytdCommissionDeduction += totalCommissionDeduction || 0;
    ytdHst += rowHst;
    ytdGrossBase += rowGross;
    ytdBuyerRebate += totalBuyerRebate;
  }

  return {
    ytdGrossEarningsExHST: round2(ytdGrossBase),
    ytdOfficeShareLess: round2(ytdOffice),
    ytdOfficeExpenses: round2(ytdOfficeExpenses),
    ytdCommissionDeduction: round2(ytdCommissionDeduction),
    ytdBuyerRebate: round2(ytdBuyerRebate),
    ytdHstOnAgentShare: round2(ytdHst),
    ytdNetPay: round2(ytdNet),
  };
}

module.exports = {
  parseThroughBounds,
  computeAgentCommissionYtd,
  DEFAULT_TAX_RATE,
  INCLUSIVE_HST_FRACTION,
};
