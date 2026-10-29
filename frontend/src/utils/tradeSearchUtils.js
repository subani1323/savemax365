/** Split search input into tokens (comma, space, semicolon). */
export function parseTradeSearchTokens(query) {
  return String(query || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getTradeAgentHaystack(trade) {
  return (trade?.agentCommissionList || [])
    .map((a) => a?.agentName || "")
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getTradeAddressHaystack(trade) {
  const k = trade?.keyInfo || {};
  return [
    k.streetNumber,
    k.streetName,
    k.unit,
    k.city,
    k.province,
    k.postalCode,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * True when query is empty, or any token matches trade #, agent name, or address.
 */
export function tradeMatchesSearchQuery(trade, query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return true;

  const tokens = parseTradeSearchTokens(trimmed);
  const tradeNum = String(trade?.tradeNumber ?? "").toLowerCase();
  const agentHaystack = getTradeAgentHaystack(trade);
  const addressHaystack = getTradeAddressHaystack(trade);

  return tokens.some((token) => {
    const t = token.toLowerCase();
    return (
      tradeNum === t ||
      tradeNum.includes(t) ||
      agentHaystack.includes(t) ||
      addressHaystack.includes(t)
    );
  });
}
