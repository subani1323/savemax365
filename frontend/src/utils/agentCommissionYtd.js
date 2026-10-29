/**
 * Normalize cheque/through date for GET /commission-trust-eft/agent-ytd
 * (backend accepts MM/DD/YYYY or YYYY-MM-DD).
 */
export function normalizeThroughDateForApi(s) {
    if (s == null || typeof s !== "string") return s;
    return s.trim();
  }
  