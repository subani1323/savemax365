/**
 * Default HST/tax rate (13% in Ontario). Use this constant everywhere
 * so the default can be changed in one place.
 */
export const DEFAULT_TAX_RATE = 0.13;

/**
 * When an amount is tax-inclusive at DEFAULT_TAX_RATE, this is the portion that is tax:
 * rate / (1 + rate). E.g. 13% HST → 0.13/1.13 ≈ 11.5% of the inclusive total.
 */
export const INCLUSIVE_HST_FRACTION =
  DEFAULT_TAX_RATE / (1 + DEFAULT_TAX_RATE);

/**
 * Effective tax rate for a trade (decimal, e.g. 0.13). Handles custom rate as fraction or whole percent.
 * @param {Object} [trade]
 * @param {Object} [tradeFallback] - e.g. stale prop while refreshed trade loads
 */
export function getTradeTaxRate(trade, tradeFallback) {
  const t = trade ?? tradeFallback;
  if (t?.customTaxRate != null && t.customTaxRate !== "") {
    const n = Number(t.customTaxRate);
    if (!Number.isFinite(n)) return DEFAULT_TAX_RATE;
    if (n > 1 && n <= 100) return n / 100;
    return n;
  }
  return DEFAULT_TAX_RATE;
}

/**
 * HST (tax) embedded in a tax-inclusive amount: inclusive × rate / (1 + rate).
 * @param {number|string} inclusiveAmount
 * @param {number} [taxRate=DEFAULT_TAX_RATE] - decimal (e.g. 0.13) or whole percent (e.g. 13)
 */
export function hstFromInclusive(inclusiveAmount, taxRate = DEFAULT_TAX_RATE) {
  const inclusive = Number(inclusiveAmount);
  if (!Number.isFinite(inclusive) || inclusive === 0) return 0;
  let r = Number(taxRate);
  if (!Number.isFinite(r)) r = DEFAULT_TAX_RATE;
  if (r > 1 && r <= 100) r = r / 100;
  if (r < 0 || r > 1) r = DEFAULT_TAX_RATE;
  return inclusive * (r / (1 + r));
}
