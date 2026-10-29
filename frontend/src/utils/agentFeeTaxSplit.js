import { DEFAULT_TAX_RATE } from "../constants/tax";
import { EXPENSE_FIELDS, NO_TAX_EXPENSE_KEYS, roundMoney } from "./agentExpenseUtils";

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRate(taxRate) {
  let r = Number(taxRate);
  if (!Number.isFinite(r) || r < 0) return DEFAULT_TAX_RATE;
  if (r > 1 && r <= 100) r = r / 100;
  return r;
}

function positiveAmountMap(amounts = {}) {
  const out = {};
  for (const field of EXPENSE_FIELDS) {
    const base = roundMoney(amounts[field.key] || 0);
    if (base > 0) out[field.key] = base;
  }
  return out;
}

function selectionHasAnyTrue(selected) {
  if (!selected || typeof selected !== "object") return false;
  return EXPENSE_FIELDS.some((f) => selected[f.key] === true);
}

/**
 * Office expense bases being recovered on this trade (from agent.officeExpenseAmounts).
 * Uses selected lines when any are checked; otherwise all positive amounts.
 * Mongoose defaults often persist officeExpenseSelected as all-false — do not treat that
 * as "nothing selected" when amounts exist.
 */
export function resolveOfficeExpenseAmounts(agent = {}) {
  const amounts = agent.officeExpenseAmounts || {};
  const positive = positiveAmountMap(amounts);
  const hasPositive = Object.keys(positive).length > 0;

  // Explicitly disabled with no amounts → nothing
  if (agent.officeExpensesEnabled === false && !hasPositive) return {};

  const selected = agent.officeExpenseSelected;
  if (selectionHasAnyTrue(selected)) {
    const out = {};
    for (const field of EXPENSE_FIELDS) {
      if (!selected[field.key]) continue;
      const base = roundMoney(amounts[field.key] || 0);
      if (base > 0) out[field.key] = base;
    }
    if (Object.keys(out).length > 0) return out;
  }

  // Positive amounts (ignore all-false selection map / missing enabled flag)
  if (hasPositive) return positive;

  return {};
}

/**
 * Incl-HST office recovery implied by totalFees after plan (+ tax-override office HST).
 * Used when line amounts were not persisted on the trade agent.
 */
export function inferOfficeExpenseTo12100(agent = {}, taxRate = DEFAULT_TAX_RATE) {
  const rate = normalizeRate(
    agent?.officeExpenseTaxRate != null && agent.officeExpenseTaxRate !== ""
      ? agent.officeExpenseTaxRate
      : taxRate,
  );
  const feesDeducted = roundMoney(num(agent?.feesDeducted));
  const totalFees = roundMoney(num(agent?.totalFees));
  if (totalFees <= 0) return 0;

  let accounted = roundMoney(feesDeducted * (1 + rate));
  const taxOverridden =
    agent?.taxOverridden === true || agent?.taxOverridden === "true";
  if (taxOverridden) {
    accounted = roundMoney(accounted + roundMoney(num(agent?.amount) * rate));
  }
  return roundMoney(Math.max(0, totalFees - accounted));
}

export function computeOfficeExpenseRecovery(officeExpenseAmounts = {}, taxRate = DEFAULT_TAX_RATE) {
  const rate = normalizeRate(taxRate);
  let taxableBase = 0;
  let noTaxBase = 0;
  const lines = {};

  for (const field of EXPENSE_FIELDS) {
    const base = roundMoney(officeExpenseAmounts?.[field.key] || 0);
    if (base <= 0) continue;
    lines[field.key] = base;
    if (NO_TAX_EXPENSE_KEYS.has(field.key) || !field.taxable) {
      noTaxBase = roundMoney(noTaxBase + base);
    } else {
      taxableBase = roundMoney(taxableBase + base);
    }
  }

  const taxableInclHst = roundMoney(taxableBase * (1 + rate));
  const to12100 = roundMoney(taxableInclHst + noTaxBase);

  return {
    lines,
    taxableBase,
    noTaxBase,
    taxableInclHst,
    to12100,
    hasOffice: to12100 > 0,
  };
}

/**
 * Split what used to be a single Cr 23001 (totalFees − feesDeducted):
 * - plan HST → Cr 23001
 * - office expenses (base + HST where taxable) → Cr 12100
 */
export function getAgentFeeLedgerCredits(agent, taxRate = DEFAULT_TAX_RATE) {
  const rate = normalizeRate(taxRate);
  const feesDeducted = roundMoney(num(agent?.feesDeducted));
  const totalFees = roundMoney(num(agent?.totalFees));
  const planHst = roundMoney(feesDeducted * rate);

  const officeRate =
    agent?.officeExpenseTaxRate != null && agent.officeExpenseTaxRate !== ""
      ? agent.officeExpenseTaxRate
      : rate;
  const office = computeOfficeExpenseRecovery(
    resolveOfficeExpenseAmounts(agent),
    officeRate,
  );

  let officeTo12100 = office.to12100;
  if (!office.hasOffice && totalFees > 0) {
    officeTo12100 = inferOfficeExpenseTo12100(agent, taxRate);
  }

  return {
    feesDeducted,
    planHst,
    officeTo12100,
    /** Legacy combined "Tax For Deduction" display amount */
    taxForDeductionDisplay: roundMoney(planHst + officeTo12100),
    office,
  };
}

/**
 * Split recovered office expenses for EFT receipt / YTD:
 * - officeExpensesAmount: all selected lines except commission deduction (incl. HST where taxable)
 * - commissionDeductionAmount: commission deduction alone (incl. HST)
 */
export function splitOfficeExpenseRecoveryForReceipt(
  agent = {},
  taxRate = DEFAULT_TAX_RATE,
) {
  const officeRate =
    agent?.officeExpenseTaxRate != null && agent.officeExpenseTaxRate !== ""
      ? agent.officeExpenseTaxRate
      : taxRate;
  const resolved = resolveOfficeExpenseAmounts(agent);
  const commissionBase = roundMoney(resolved.commissionDeduction || 0);
  const withoutCd = { ...resolved };
  delete withoutCd.commissionDeduction;

  const office = computeOfficeExpenseRecovery(withoutCd, officeRate);
  const commission = computeOfficeExpenseRecovery(
    commissionBase > 0 ? { commissionDeduction: commissionBase } : {},
    officeRate,
  );

  return {
    officeExpensesAmount: office.to12100,
    commissionDeductionAmount: commission.to12100,
  };
}

/**
 * Scale a tax-inclusive per-type map so its sum equals targetIncl.
 */
export function scaleInclMapToTarget(inclMap = {}, targetIncl = 0) {
  const target = roundMoney(targetIncl);
  if (target <= 0) return null;
  let sum = 0;
  const positive = {};
  for (const field of EXPENSE_FIELDS) {
    const v = roundMoney(inclMap[field.key] || 0);
    if (v > 0) {
      positive[field.key] = v;
      sum = roundMoney(sum + v);
    }
  }
  if (sum <= 0) return null;
  if (sum === target) return positive;
  const out = {};
  let allocated = 0;
  const keys = Object.keys(positive);
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      out[key] = roundMoney(target - allocated);
    } else {
      const share = roundMoney((positive[key] / sum) * target);
      out[key] = share;
      allocated = roundMoney(allocated + share);
    }
  });
  return out;
}

/** Convert tax-inclusive per-type map to base amounts for officeExpenseAmounts. */
export function basesFromInclMap(inclMap = {}, taxRate = DEFAULT_TAX_RATE) {
  const rate = normalizeRate(taxRate);
  const out = {};
  for (const field of EXPENSE_FIELDS) {
    const incl = roundMoney(inclMap[field.key] || 0);
    if (incl <= 0) continue;
    const noTax = NO_TAX_EXPENSE_KEYS.has(field.key) || !field.taxable;
    out[field.key] = noTax ? incl : roundMoney(incl / (1 + rate));
  }
  return out;
}

/**
 * Resolve office expense bases for Financial sheet rows.
 * Falls back to totalFees remainder (as Other fee) when line amounts were not persisted.
 */
export function resolveOfficeExpenseAmountsForSheet(
  agent = {},
  taxRate = DEFAULT_TAX_RATE,
  candidateInclMaps = [],
) {
  const fromAgent = resolveOfficeExpenseAmounts(agent);
  if (Object.keys(fromAgent).length > 0) return fromAgent;

  const inferred = inferOfficeExpenseTo12100(agent, taxRate);
  const officeRate =
    agent?.officeExpenseTaxRate != null && agent.officeExpenseTaxRate !== ""
      ? agent.officeExpenseTaxRate
      : taxRate;

  for (const candidate of candidateInclMaps) {
    if (!candidate || typeof candidate !== "object") continue;
    const hasAny = EXPENSE_FIELDS.some(
      (f) => roundMoney(candidate[f.key] || 0) > 0,
    );
    if (!hasAny) continue;

    const inclSource =
      inferred > 0 ? scaleInclMapToTarget(candidate, inferred) : candidate;
    if (!inclSource) continue;
    const bases = basesFromInclMap(inclSource, officeRate);
    if (Object.keys(bases).length > 0) return bases;
  }

  // Last resort: totalFees has OE but no per-type breakdown — show as Other fee
  if (inferred > 0) {
    const rate = normalizeRate(officeRate);
    return { otherFee: roundMoney(inferred / (1 + rate)) };
  }

  return {};
}

/**
 * Financial sheet rows for office expenses on an agent (one row per fee type).
 * Listing/Selling columns follow the agent's sheet side (same as agent commission row).
 */
export function buildOfficeExpenseFinancialRows(
  agent = {},
  {
    listingAmount = 0,
    sellingAmount = 0,
    taxRate = DEFAULT_TAX_RATE,
    candidateInclMaps = [],
  } = {},
) {
  const resolved = resolveOfficeExpenseAmountsForSheet(
    agent,
    taxRate,
    candidateInclMaps,
  );
  const officeRate =
    agent?.officeExpenseTaxRate != null && agent.officeExpenseTaxRate !== ""
      ? agent.officeExpenseTaxRate
      : taxRate;
  const rate = normalizeRate(officeRate);
  const listingSide = (parseFloat(listingAmount) || 0) > 0;
  const sellingSide = (parseFloat(sellingAmount) || 0) > 0 && !listingSide;

  const sideCols = (base) => {
    const listing = listingSide ? base : sellingSide ? 0 : base;
    const selling = sellingSide ? base : 0;
    return { listing, selling };
  };

  const rows = [];
  for (const field of EXPENSE_FIELDS) {
    const base = roundMoney(resolved[field.key] || 0);
    if (base <= 0) continue;
    const noTax = NO_TAX_EXPENSE_KEYS.has(field.key) || !field.taxable;
    const hst = noTax ? 0 : roundMoney(base * rate);
    const total = roundMoney(base + hst);
    const { listing, selling } = sideCols(base);
    rows.push({
      key: field.key,
      name: field.label,
      listing: listing.toFixed(2),
      selling: selling.toFixed(2),
      subTotal: base.toFixed(2),
      tax: hst.toFixed(2),
      total: total.toFixed(2),
    });
  }

  return rows;
}

export function buildFeeTaxCreditEntries({
  agent,
  taxRate,
  description,
  date,
}) {
  const { planHst, officeTo12100 } = getAgentFeeLedgerCredits(agent, taxRate);
  const entries = [];

  if (planHst > 0) {
    entries.push({
      accountNumber: "23001",
      accountName: "HST Input Tax Credit",
      debit: 0,
      credit: planHst,
      description,
      date,
    });
  }

  if (officeTo12100 > 0) {
    entries.push({
      accountNumber: "12100",
      accountName: "A/R - Agt's Recoverable- Gen Exp",
      debit: 0,
      credit: officeTo12100,
      description,
      date,
    });
  }

  return entries;
}
