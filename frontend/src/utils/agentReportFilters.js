/**
 * Agent numbers excluded from agent payment detail and summary reports.
 */
const BLOCKED_AGENT_NUMBERS = new Set(["120"]);

/**
 * @param {string|number|null|undefined} agentId Resolved display agent number (employee no or EFT agentId)
 * @returns {boolean} true if this agent should not appear in payment / summary reports
 */
export function isBlockedAgentDisplayNumber(agentId) {
  if (agentId == null || agentId === "") return false;
  return BLOCKED_AGENT_NUMBERS.has(String(agentId).trim());
}
