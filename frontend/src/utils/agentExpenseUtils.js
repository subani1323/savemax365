export const EXPENSE_FIELDS = [
  { key: "deskFee", label: "Desk fee", taxable: true },
  { key: "courierFee", label: "Courier fee", taxable: true },
  { key: "bankCharge", label: "Bank charge", taxable: false },
  { key: "otherFee", label: "Other fee", taxable: true },
  { key: "commissionDeduction", label: "Commission deduction", taxable: true },
  { key: "garnishment", label: "Garnishment", taxable: false },
];

export const NO_TAX_EXPENSE_KEYS = new Set(["bankCharge", "garnishment"]);

export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function formatMoney(n) {
  return roundMoney(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** taxRatePercent e.g. 13 */
export function computeAgentExpenseTotals(lines, taxRatePercent = 13) {
  let rate = Number(taxRatePercent);
  if (!Number.isFinite(rate) || rate < 0) rate = 13;
  if (rate > 0 && rate <= 1) rate = rate * 100;
  const taxDecimal = rate / 100;

  let amount = 0;
  let hst = 0;
  const perLine = {};

  for (const field of EXPENSE_FIELDS) {
    const base = roundMoney(lines?.[field.key] || 0);
    const lineHst =
      base > 0 && field.taxable ? roundMoney(base * taxDecimal) : 0;
    const total = roundMoney(base + lineHst);
    perLine[field.key] = { base, hst: lineHst, total, taxable: field.taxable };
    amount = roundMoney(amount + base);
    hst = roundMoney(hst + lineHst);
  }

  return {
    amount,
    hst,
    total: roundMoney(amount + hst),
    perLine,
    taxRatePercent: rate,
  };
}

export function todayIsoLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDisplayDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString();
}
