/** Round money to 2 decimal places (consistent with frontend). */
function roundTo2(num) {
    const n = Number(num);
    if (Number.isNaN(n)) return 0;
    return Math.round(n * 100) / 100;
  }
  
  /** String suitable for DB storage of currency fields. */
  function roundTo2Str(val) {
    if (val === undefined || val === null || val === "") return val;
    const n = parseFloat(String(val).replace(/,/g, ""));
    if (Number.isNaN(n)) return val;
    return roundTo2(n).toFixed(2);
  }
  
  /** Agent commission list fields that are tax or money amounts (stored as strings). */
  const AGENT_MONEY_KEYS = [
    "amount",
    "tax",
    "total",
    "taxOnFees",
    "totalFees",
    "netCommission",
    "feesDeducted",
    "awardAmount",
    "buyerRebateAmount",
    "sellingAmount",
  ];
  
  function sanitizeAgentCommissionList(list) {
    if (!Array.isArray(list)) return list;
    return list.map((agent) => {
      if (!agent || typeof agent !== "object") return agent;
      const o = { ...agent };
      for (const k of AGENT_MONEY_KEYS) {
        if (o[k] !== undefined && o[k] !== null && o[k] !== "") {
          o[k] = roundTo2Str(o[k]);
        }
      }
      return o;
    });
  }
  
  module.exports = { roundTo2, roundTo2Str, sanitizeAgentCommissionList };
  