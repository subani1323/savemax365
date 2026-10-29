import axiosInstance from "../config/axios";
import { resolveOfficeExpenseAmounts } from "./agentFeeTaxSplit";

/**
 * After saving a trade, sync Applied / Trades on Agent Expenses from office fees on the trade.
 */
export async function syncAgentExpensesFromTrade(
  tradeNumber,
  agentCommissionList = [],
) {
  const tn = String(tradeNumber ?? "").trim();
  if (!tn) return null;

  const agents = [];
  for (const a of agentCommissionList || []) {
    const bases = resolveOfficeExpenseAmounts(a);
    if (!Object.keys(bases).length) continue;
    agents.push({
      employeeNo: a.agentId,
      amounts: bases,
      taxRate: a.officeExpenseTaxRate != null ? a.officeExpenseTaxRate : 13,
    });
  }

  // Always call sync so prior applications for this trade are cleared when fees removed
  const res = await axiosInstance.post("/agent-expenses/sync-trade", {
    tradeNumber: tn,
    agents,
  });
  return res.data;
}
