import { DEFAULT_TAX_RATE, getTradeTaxRate } from "../constants/tax";
import { roundTo2, roundTo2Str } from "./numberUtils";

export { roundTo2, roundTo2Str };

function isReferralAgentRow(a) {
  return (a.classification || "").toUpperCase() === "REFERRAL";
}

/** Accepts "yes", "Yes", true (some saves/API paths differ). */
export function isBuyerRebateIncludedYes(a) {
  const v = a?.buyerRebateIncluded;
  if (v === true || v === "yes") return true;
  if (typeof v === "string" && v.toLowerCase() === "yes") return true;
  return false;
}

/**
 * Row belongs to agent double ender commission (listing/selling pair), even if
 * `classification` was not persisted on the subdocument.
 */
function isAgentDoubleEnderCommissionRow(a) {
  if ((a.classification || "").toUpperCase() === "AGENT DOUBLE ENDER")
    return true;
  const tt = (a.transactionType || "").toUpperCase();
  return tt === "LISTING" || tt === "SELLING";
}

/**
 * Total buyer rebate for ledger/UI. For AGENT DOUBLE ENDER, counts each agent once
 * (rebate is stored on the SELLING row; avoids doubling if both rows had values).
 */
export function getTotalBuyerRebateAmount(trade) {
  if (!trade?.agentCommissionList?.length) return 0;
  const classification = trade.keyInfo?.classification || "";
  if (classification !== "AGENT DOUBLE ENDER") {
    return roundTo2(
      trade.agentCommissionList.reduce((t, a) => {
        if (isReferralAgentRow(a)) return t;
        if (isBuyerRebateIncludedYes(a) && a.buyerRebateAmount) {
          return t + parseFloat(a.buyerRebateAmount || 0);
        }
        return t;
      }, 0),
    );
  }
  const byAgent = new Map();
  for (const a of trade.agentCommissionList) {
    if (isReferralAgentRow(a)) continue;
    if (!isAgentDoubleEnderCommissionRow(a)) continue;
    if (!isBuyerRebateIncludedYes(a) || !a.buyerRebateAmount) continue;
    const key = String(a.agentId ?? a.agentName ?? "");
    const amt = parseFloat(a.buyerRebateAmount || 0) || 0;
    const isSelling = (a.transactionType || "").toUpperCase() === "SELLING";
    if (!byAgent.has(key)) {
      byAgent.set(key, { amt, isSelling });
    } else if (isSelling) {
      byAgent.set(key, { amt, isSelling: true });
    }
  }
  let total = 0;
  byAgent.forEach(({ amt }) => {
    total += amt;
  });
  for (const a of trade.agentCommissionList) {
    if (isReferralAgentRow(a)) continue;
    if (isAgentDoubleEnderCommissionRow(a)) continue;
    if (isBuyerRebateIncludedYes(a) && a.buyerRebateAmount) {
      total += parseFloat(a.buyerRebateAmount || 0);
    }
  }
  return roundTo2(total);
}

const BUYER_REBATE_LEDGER_ACCOUNT = {
  accountNumber: "52100",
  accountName: "Referral Fees",
};

/**
 * One entry per agent with a buyer rebate, for separate ledger credits (52100).
 * Mirrors {@link getTotalBuyerRebateAmount} so totals stay consistent.
 * @param {Object} trade
 * @returns {{ agentName: string, amount: number }[]}
 */
export function getPerAgentBuyerRebatesForLedger(trade) {
  if (!trade?.agentCommissionList?.length) return [];
  const classification = trade.keyInfo?.classification || "";
  const list = trade.agentCommissionList;

  if (classification === "AGENT DOUBLE ENDER") {
    const byAgent = new Map();
    for (const a of list) {
      if (isReferralAgentRow(a)) continue;
      if (!isAgentDoubleEnderCommissionRow(a)) continue;
      if (!isBuyerRebateIncludedYes(a) || !a.buyerRebateAmount) continue;
      const key = String(a.agentId ?? a.agentName ?? "");
      const amt = parseFloat(a.buyerRebateAmount || 0) || 0;
      if (amt <= 0) continue;
      const isSelling = (a.transactionType || "").toUpperCase() === "SELLING";
      const name = (a.agentName || "").trim() || key;
      if (!byAgent.has(key)) {
        byAgent.set(key, { amt, isSelling, name });
      } else if (isSelling) {
        const prev = byAgent.get(key);
        byAgent.set(key, { amt, isSelling: true, name: prev.name || name });
      }
    }
    const out = [];
    byAgent.forEach(({ amt, name }) => {
      out.push({ agentName: name, amount: roundTo2(amt) });
    });
    for (const a of list) {
      if (isReferralAgentRow(a)) continue;
      if (isAgentDoubleEnderCommissionRow(a)) continue;
      if (!isBuyerRebateIncludedYes(a) || !a.buyerRebateAmount) continue;
      const amt = parseFloat(a.buyerRebateAmount || 0) || 0;
      if (amt <= 0) continue;
      out.push({
        agentName: (a.agentName || "").trim() || String(a.agentId ?? ""),
        amount: roundTo2(amt),
      });
    }
    return out;
  }

  const out = [];
  for (const a of list) {
    if (isReferralAgentRow(a)) continue;
    if (!isBuyerRebateIncludedYes(a) || !a.buyerRebateAmount) continue;
    const amt = parseFloat(a.buyerRebateAmount || 0) || 0;
    if (amt <= 0) continue;
    out.push({
      agentName: (a.agentName || "").trim() || String(a.agentId ?? ""),
      amount: roundTo2(amt),
    });
  }
  return out;
}

/** Account used for buyer rebate credits (per chart of accounts 52100). */
export function getBuyerRebateLedgerAccount() {
  return { ...BUYER_REBATE_LEDGER_ACCOUNT };
}

/**
 * Buyer rebate for the Financial sheet Liabilities row (Listing vs Selling columns).
 * For AGENT DOUBLE ENDER, each agent's rebate is counted once and placed in the column
 * for the transaction row that holds it (SELLING row wins when both exist), matching
 * {@link getTotalBuyerRebateAmount}.
 * When `agentKeys` is a Set, only those agents (String(agentId ?? agentName)) are included
 * — used when printing a single agent's sheet so the rebate is not the trade total.
 * @param {Object} trade
 * @param {{ agentKeys?: Set<string> | null }} [options]
 * @returns {{ listing: number, selling: number }}
 */
export function getBuyerRebateListingSellingForSheet(trade, options = {}) {
  const { agentKeys } = options;
  const classification = trade.keyInfo?.classification || "";
  const list = trade.agentCommissionList || [];

  const matchesFilter = (a) => {
    if (isReferralAgentRow(a)) return false;
    if (agentKeys == null || agentKeys === undefined) return true;
    if (agentKeys.size === 0) return false;
    const k = String(a.agentId ?? a.agentName ?? "");
    return agentKeys.has(k);
  };

  if (classification === "CO-OPERATING SIDE") {
    let selling = 0;
    for (const a of list) {
      if (!matchesFilter(a)) continue;
      if (isBuyerRebateIncludedYes(a) && a.buyerRebateAmount) {
        selling += parseFloat(a.buyerRebateAmount || 0);
      }
    }
    return { listing: 0, selling: roundTo2(selling) };
  }

  if (classification === "AGENT DOUBLE ENDER") {
    const byAgent = new Map();
    for (const a of list) {
      if (!matchesFilter(a)) continue;
      if (!isAgentDoubleEnderCommissionRow(a)) continue;
      if (!isBuyerRebateIncludedYes(a) || !a.buyerRebateAmount) continue;
      const key = String(a.agentId ?? a.agentName ?? "");
      const amt = parseFloat(a.buyerRebateAmount || 0) || 0;
      const isSelling = (a.transactionType || "").toUpperCase() === "SELLING";
      if (!byAgent.has(key)) {
        byAgent.set(key, { amt, isSelling });
      } else if (isSelling) {
        byAgent.set(key, { amt, isSelling: true });
      }
    }
    let listing = 0;
    let selling = 0;
    byAgent.forEach(({ amt, isSelling }) => {
      if (isSelling) selling += amt;
      else listing += amt;
    });
    for (const a of list) {
      if (!matchesFilter(a)) continue;
      if (isReferralAgentRow(a)) continue;
      if (isAgentDoubleEnderCommissionRow(a)) continue;
      if (isBuyerRebateIncludedYes(a) && a.buyerRebateAmount) {
        listing += parseFloat(a.buyerRebateAmount || 0);
      }
    }
    return { listing: roundTo2(listing), selling: roundTo2(selling) };
  }

  let listing = 0;
  for (const a of list) {
    if (!matchesFilter(a)) continue;
    if (isReferralAgentRow(a)) continue;
    if (isBuyerRebateIncludedYes(a) && a.buyerRebateAmount) {
      listing += parseFloat(a.buyerRebateAmount || 0);
    }
  }
  return { listing: roundTo2(listing), selling: 0 };
}

/**
 * Compute Net to Office total for a trade (same logic as Trade Details Sheet).
 * Invariant: Net to Office = Base Office Commission - Agents Total (minus Liabilities when applicable).
 * Used for Our Brokerage Commission EFT amount so it matches the trade details sheet.
 * @param {Object} trade - Full trade object with commission, keyInfo, agentCommissionList, outsideBrokers
 * @returns {{ netToOfficeTotal: string, netToOfficeSubTotal?: string, netToOfficeHST?: string }}
 */
export function getNetToOfficeTotal(trade) {
  if (!trade) return { netToOfficeTotal: "0.00" };

  const commissionIncome = trade.commission?.commissionIncomeRows?.[0] || {};
  const tradeClassification = trade.keyInfo?.classification || "";
  const isCoOperatingSide = tradeClassification === "CO-OPERATING SIDE";
  const taxRate = getTradeTaxRate(trade);

  const listingAmount =
    commissionIncome.listingAmount && commissionIncome.listingAmount !== ""
      ? parseFloat(commissionIncome.listingAmount)
      : 0;
  const sellingAmount =
    commissionIncome.sellingAmount && commissionIncome.sellingAmount !== ""
      ? parseFloat(commissionIncome.sellingAmount)
      : 0;
  const subTotal = roundTo2Str(listingAmount + sellingAmount);
  const listingTax = roundTo2Str(roundTo2(listingAmount * taxRate));
  const sellingTax = roundTo2Str(roundTo2(sellingAmount * taxRate));
  const hst = roundTo2Str(
    roundTo2(parseFloat(listingTax) + parseFloat(sellingTax)),
  );
  const total = roundTo2Str(roundTo2(parseFloat(subTotal) + parseFloat(hst)));

  let outsideBrokerInfo = null;
  if (trade.commission?.outsideBrokersRows?.length > 0) {
    outsideBrokerInfo = trade.commission.outsideBrokersRows[0];
  } else if (trade.outsideBrokers?.length > 0) {
    outsideBrokerInfo = trade.outsideBrokers[0];
  }

  let obListing = "0.00",
    obSelling = "0.00",
    obSubTotal = "0.00",
    obTax = "0.00",
    obTotal = "0.00";
  if (outsideBrokerInfo) {
    const brokerSellingAmount = outsideBrokerInfo.sellingAmount || "0.00";
    const matchingBrokerInOB = trade.outsideBrokers?.find((ob) => {
      const outsideBrokerName = `${ob.firstName} ${ob.lastName}`.trim();
      return (
        outsideBrokerName ===
          (outsideBrokerInfo.agentName || outsideBrokerInfo.firstName) ||
        ob.company === outsideBrokerInfo.company
      );
    });
    let endType = "";
    if (matchingBrokerInOB) {
      endType =
        matchingBrokerInOB.end?.toLowerCase().includes("listing") ||
        matchingBrokerInOB.type?.toLowerCase().includes("listing")
          ? "listing"
          : "selling";
    } else {
      const end = (
        outsideBrokerInfo.end ||
        outsideBrokerInfo.type ||
        ""
      ).toLowerCase();
      endType = end.includes("listing") ? "listing" : "selling";
    }
    if (endType === "listing") {
      obListing = brokerSellingAmount;
      obSelling = "0.00";
    } else {
      obListing = "0.00";
      obSelling = brokerSellingAmount;
    }
    obSubTotal = brokerSellingAmount;
    obTax = outsideBrokerInfo.tax || "0.00";
    obTotal = outsideBrokerInfo.total || "0.00";
  }

  // Agent double ender: both sides are in-house; do not treat cooperating broker row as an expense on the sheet
  if (tradeClassification === "AGENT DOUBLE ENDER") {
    obListing = "0.00";
    obSelling = "0.00";
    obSubTotal = "0.00";
    obTax = "0.00";
    obTotal = "0.00";
  }

  const referralForExpenses = (trade.agentCommissionList || []).filter(
    (a) => (a.classification || "").toUpperCase() === "REFERRAL",
  );
  const referralAmountSum = referralForExpenses.reduce(
    (s, a) => s + parseFloat(a.amount || 0),
    0,
  );
  const referralTaxSum = referralForExpenses.reduce(
    (s, a) => s + parseFloat(a.tax || 0),
    0,
  );
  const referralTotalSum = referralForExpenses.reduce(
    (s, a) => s + parseFloat(a.total || 0),
    0,
  );

  let baseOfficeCommissionListing,
    baseOfficeCommissionSelling,
    baseOfficeCommissionSubTotal,
    baseOfficeCommissionHST,
    baseOfficeCommissionTotal;

  if (isCoOperatingSide) {
    if (referralForExpenses.length === 0) {
      baseOfficeCommissionListing = roundTo2Str(listingAmount);
      baseOfficeCommissionSelling = roundTo2Str(sellingAmount);
      baseOfficeCommissionSubTotal = subTotal;
      baseOfficeCommissionHST = hst;
      baseOfficeCommissionTotal = total;
    } else {
      baseOfficeCommissionListing = roundTo2Str(listingAmount);
      baseOfficeCommissionSelling = roundTo2Str(
        roundTo2(parseFloat(sellingAmount) - referralAmountSum),
      );
      baseOfficeCommissionSubTotal = roundTo2Str(
        roundTo2(parseFloat(subTotal) - referralAmountSum),
      );
      baseOfficeCommissionHST = roundTo2Str(
        roundTo2(parseFloat(hst) - referralTaxSum),
      );
      baseOfficeCommissionTotal = roundTo2Str(
        roundTo2(parseFloat(total) - referralTotalSum),
      );
    }
  } else {
    baseOfficeCommissionListing = roundTo2Str(
      roundTo2(parseFloat(listingAmount) - parseFloat(obListing)),
    );
    baseOfficeCommissionSelling = roundTo2Str(
      roundTo2(
        parseFloat(sellingAmount) - parseFloat(obSelling) - referralAmountSum,
      ),
    );
    baseOfficeCommissionSubTotal = roundTo2Str(
      roundTo2(
        parseFloat(subTotal) - parseFloat(obSubTotal) - referralAmountSum,
      ),
    );
    baseOfficeCommissionHST = roundTo2Str(
      roundTo2(parseFloat(hst) - parseFloat(obTax) - referralTaxSum),
    );
    baseOfficeCommissionTotal = roundTo2Str(
      roundTo2(parseFloat(total) - parseFloat(obTotal) - referralTotalSum),
    );
  }

  const agentDoubleEnderOrder = new Map();
  if (tradeClassification === "AGENT DOUBLE ENDER") {
    (trade.agentCommissionList || []).forEach((a, index) => {
      if (a.classification === "AGENT DOUBLE ENDER" && a.agentId) {
        const key = a.agentId;
        if (!agentDoubleEnderOrder.has(key)) {
          agentDoubleEnderOrder.set(key, []);
        }
        agentDoubleEnderOrder.get(key).push(index);
      }
    });
  }

  const agentCalculations = (trade.agentCommissionList || []).map(
    (agent, agentIndex) => {
      const agentAmount =
        agent.amount && agent.amount !== "" ? parseFloat(agent.amount) : 0;
      const agentFeesDeducted =
        agent.feesDeducted && agent.feesDeducted !== ""
          ? parseFloat(agent.feesDeducted)
          : 0;
      const buyerRebateAmount =
        isBuyerRebateIncludedYes(agent) && agent.buyerRebateAmount
          ? parseFloat(agent.buyerRebateAmount) || 0
          : 0;
      const shareAfterPlan = agentAmount - agentFeesDeducted;
      const displaySubForSheet = Math.max(
        0,
        shareAfterPlan - buyerRebateAmount,
      );
      const hstBaseForAgent = shareAfterPlan;

      let agentListing = "0.00";
      let agentSelling = "0.00";

      if (
        tradeClassification === "AGENT DOUBLE ENDER" &&
        agent.classification === "AGENT DOUBLE ENDER"
      ) {
        let transactionType = agent.transactionType;
        if (!transactionType && agent.agentId) {
          const agentIndices = agentDoubleEnderOrder.get(agent.agentId) || [];
          const positionInList = agentIndices.indexOf(agentIndex);
          transactionType = positionInList === 0 ? "LISTING" : "SELLING";
        }
        if (transactionType === "LISTING") {
          agentListing = roundTo2Str(displaySubForSheet);
          agentSelling = "0.00";
        } else if (transactionType === "SELLING") {
          agentListing = "0.00";
          agentSelling = roundTo2Str(displaySubForSheet);
        }
      } else if (isCoOperatingSide) {
        agentListing = "0.00";
        agentSelling = roundTo2Str(displaySubForSheet);
      } else {
        agentListing = roundTo2Str(displaySubForSheet);
        agentSelling = "0.00";
      }

      const agentSubTotal = roundTo2Str(
        roundTo2(parseFloat(agentListing) + parseFloat(agentSelling)),
      );
      const isTaxOverridden =
        agent.taxOverridden === true || agent.taxOverridden === "true";
      const defaultAgentHST = roundTo2(hstBaseForAgent * taxRate);
      const overriddenAgentHST = roundTo2(parseFloat(agent.tax || 0));
      const hasPersistedNet =
        agent.netCommission !== undefined &&
        agent.netCommission !== null &&
        agent.netCommission !== "";
      const persistedNet = hasPersistedNet
        ? roundTo2(parseFloat(agent.netCommission || 0))
        : null;
      const agentHSTNumeric = hasPersistedNet
        ? roundTo2(persistedNet - parseFloat(agentSubTotal || 0))
        : isTaxOverridden
          ? overriddenAgentHST
          : defaultAgentHST;
      const agentHST = roundTo2Str(agentHSTNumeric);
      const agentTotal = hasPersistedNet
        ? roundTo2Str(persistedNet)
        : roundTo2Str(
            roundTo2(parseFloat(agentSubTotal) + parseFloat(agentHST)),
          );

      return {
        ...agent,
        agentListing,
        agentSelling,
        agentSubTotal,
        agentHST,
        agentTotal,
      };
    },
  );

  const brCols = getBuyerRebateListingSellingForSheet(trade, {
    agentKeys: null,
  });
  let buyerRebateListing = roundTo2Str(brCols.listing);
  let buyerRebateSelling = roundTo2Str(brCols.selling);
  const totalBuyerRebate = roundTo2(brCols.listing + brCols.selling);

  // For Net to Office we only subtract non-referral agents (referral is already in Base Office Commission)
  const nonReferralAgents = agentCalculations.filter(
    (a) => (a.classification || "").toUpperCase() !== "REFERRAL",
  );

  let totalAgentListing,
    totalAgentSelling,
    totalAgentSubTotal,
    totalAgentHST,
    totalAgentTotal;

  if (!isCoOperatingSide && nonReferralAgents.length === 2) {
    const agent1 = nonReferralAgents[0] || {};
    const agent2 = nonReferralAgents[1] || {};
    totalAgentListing =
      parseFloat(agent1.agentListing || 0) -
      parseFloat(agent2.agentListing || 0);
    totalAgentSelling =
      parseFloat(agent1.agentSelling || 0) -
      parseFloat(agent2.agentSelling || 0);
    totalAgentSubTotal =
      parseFloat(agent1.agentSubTotal || 0) -
      parseFloat(agent2.agentSubTotal || 0);
    totalAgentHST =
      parseFloat(agent1.agentHST || 0) - parseFloat(agent2.agentHST || 0);
    totalAgentTotal =
      parseFloat(agent1.agentTotal || 0) - parseFloat(agent2.agentTotal || 0);
  } else {
    totalAgentListing = nonReferralAgents.reduce(
      (sum, agent) => sum + parseFloat(agent.agentListing || 0),
      0,
    );
    totalAgentSelling = nonReferralAgents.reduce(
      (sum, agent) => sum + parseFloat(agent.agentSelling || 0),
      0,
    );
    totalAgentSubTotal = nonReferralAgents.reduce(
      (sum, agent) => sum + parseFloat(agent.agentSubTotal || 0),
      0,
    );
    totalAgentHST = nonReferralAgents.reduce(
      (sum, agent) => sum + parseFloat(agent.agentHST || 0),
      0,
    );
    totalAgentTotal = nonReferralAgents.reduce(
      (sum, agent) => sum + parseFloat(agent.agentTotal || 0),
      0,
    );
  }

  let netToOfficeTotal;
  let netToOfficeSubTotal;
  let netToOfficeHST;
  let netToOfficeListing;
  let netToOfficeSelling;

  if (tradeClassification === "AGENT DOUBLE ENDER") {
    // Net to Office = Income − agents; buyer rebate is not deducted here (Liabilities row is informational on sheet).
    const sumAgentListing = nonReferralAgents.reduce(
      (s, a) => s + parseFloat(a.agentListing || 0),
      0,
    );
    const sumAgentSelling = nonReferralAgents.reduce(
      (s, a) => s + parseFloat(a.agentSelling || 0),
      0,
    );
    const sumAgentSubTotal = nonReferralAgents.reduce(
      (s, a) => s + parseFloat(a.agentSubTotal || 0),
      0,
    );
    const sumAgentHST = nonReferralAgents.reduce(
      (s, a) => s + parseFloat(a.agentHST || 0),
      0,
    );
    const sumAgentTotal = nonReferralAgents.reduce(
      (s, a) => s + parseFloat(a.agentTotal || 0),
      0,
    );
    const incomeSub = parseFloat(subTotal);
    const incomeHst = parseFloat(hst);
    const incomeTtl = parseFloat(total);

    netToOfficeListing = roundTo2Str(roundTo2(listingAmount - sumAgentListing));
    netToOfficeSelling = roundTo2Str(roundTo2(sellingAmount - sumAgentSelling));
    netToOfficeSubTotal = roundTo2Str(roundTo2(incomeSub - sumAgentSubTotal));
    netToOfficeHST = roundTo2Str(roundTo2(incomeHst - sumAgentHST));
    netToOfficeTotal = roundTo2Str(roundTo2(incomeTtl - sumAgentTotal));
  } else if (!isCoOperatingSide && nonReferralAgents.length === 2) {
    // Listing-side two-agent plan: sub-total is plan fees; standard commission HST (Amount × rate) for override rows goes to office HST column.
    const totalPlanFees = nonReferralAgents.reduce(
      (tot, agent) => tot + parseFloat(agent.feesDeducted || 0),
      0,
    );
    const overriddenHSTToOffice = nonReferralAgents.reduce((tot, agent) => {
      const rowOverride =
        agent.taxOverridden === true || agent.taxOverridden === "true";
      return (
        tot +
        (rowOverride ? roundTo2(parseFloat(agent.amount || 0) * taxRate) : 0)
      );
    }, 0);
    netToOfficeSubTotal = roundTo2Str(totalPlanFees);
    netToOfficeHST = roundTo2Str(roundTo2(overriddenHSTToOffice));
    netToOfficeTotal = roundTo2Str(
      roundTo2(totalPlanFees + overriddenHSTToOffice),
    );
  } else if (isCoOperatingSide) {
    // Co-operating side net to office is Base Office Commission minus Agents
    // (and minus buyer rebate liabilities where applicable) by each column.
    const rebateSubTotal =
      (parseFloat(buyerRebateListing) || 0) +
      (parseFloat(buyerRebateSelling) || 0);
    netToOfficeSubTotal = roundTo2Str(
      roundTo2(
        parseFloat(baseOfficeCommissionSubTotal) -
          totalAgentSubTotal -
          rebateSubTotal,
      ),
    );
    netToOfficeHST = roundTo2Str(
      roundTo2(parseFloat(baseOfficeCommissionHST) - totalAgentHST),
    );
    netToOfficeTotal = roundTo2Str(
      roundTo2(
        parseFloat(baseOfficeCommissionTotal) -
          totalAgentTotal -
          rebateSubTotal,
      ),
    );
  } else {
    // Net to Office = Base Office Commission - Agents Total (minus Liabilities when applicable)
    netToOfficeSubTotal = roundTo2Str(
      roundTo2(
        parseFloat(baseOfficeCommissionSubTotal) -
          totalAgentSubTotal -
          (parseFloat(buyerRebateListing) + parseFloat(buyerRebateSelling)),
      ),
    );
    netToOfficeHST = roundTo2Str(
      roundTo2(parseFloat(baseOfficeCommissionHST) - totalAgentHST),
    );
    netToOfficeTotal = roundTo2Str(
      roundTo2(
        parseFloat(baseOfficeCommissionTotal) -
          totalAgentTotal -
          (parseFloat(buyerRebateListing) + parseFloat(buyerRebateSelling)),
      ),
    );
  }

  return {
    netToOfficeTotal: netToOfficeTotal || "0.00",
    netToOfficeSubTotal,
    netToOfficeHST,
  };
}

/**
 * EFT amount for Our Brokerage commission: Net to Office total (same as Trade Details sheet)
 * plus buyer rebates. Rebates stay on the sheet as Liabilities but must still move with the
 * office transfer from commission trust (stub: "includes buyer rebates").
 */
export function getOurBrokerageEftAmount(trade) {
  const { netToOfficeTotal } = getNetToOfficeTotal(trade);
  const net = parseFloat(netToOfficeTotal) || 0;
  const rebate = getTotalBuyerRebateAmount(trade);
  return roundTo2Str(roundTo2(net + rebate));
}

/** Open deals (Trade Info filter): AVAILABLE, SOLD, or LEASED. */
export function isOpenTrade(trade) {
  const status = String(trade?.keyInfo?.status || "AVAILABLE").toUpperCase();
  return (
    status === "AVAILABLE" || status === "SOLD" || status === "LEASED"
  );
}

export function parseTradeCalendarDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getTradeOpenedDate(trade) {
  return (
    parseTradeCalendarDate(trade?.keyInfo?.entryDate) ||
    parseTradeCalendarDate(trade?.keyInfo?.offerDate) ||
    parseTradeCalendarDate(trade?.createdAt) ||
    null
  );
}

export function tradeOpenedInDateRange(trade, fromDate, toDate) {
  const opened = getTradeOpenedDate(trade);
  if (!opened) return false;
  const start = parseTradeCalendarDate(fromDate);
  const end = parseTradeCalendarDate(toDate);
  if (!start || !end) return false;
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return opened >= start && opened <= end;
}

export function getTradeFinalizedDate(trade) {
  return (
    parseTradeCalendarDate(trade?.keyInfo?.finalizedDate) ||
    parseTradeCalendarDate(trade?.finalizedDate) ||
    null
  );
}

/**
 * Currently open deals (AVAILABLE / SOLD / LEASED) active during [fromDate, toDate]:
 * excludes CLOSED, finalized, fallen thru, and duplicate. Includes trades opened
 * before the period that are still open.
 */
export function filterOpenTradesForCommissionReport(trades, fromDate, toDate) {
  const start = parseTradeCalendarDate(fromDate);
  const end = parseTradeCalendarDate(toDate);
  if (!start || !end) return [];

  end.setHours(23, 59, 59, 999);

  return (trades || []).filter((trade) => {
    const status = String(trade?.keyInfo?.status || "AVAILABLE").toUpperCase();
    if (
      status === "CLOSED" ||
      status === "FALLEN THRU" ||
      status === "FALLENTHRU" ||
      status === "DUPLICATE"
    ) {
      return false;
    }

    const finalized = getTradeFinalizedDate(trade);
    if (trade?.isFinalized || finalized) {
      return false;
    }

    const opened = getTradeOpenedDate(trade);
    if (opened) {
      const openedDay = new Date(opened);
      openedDay.setHours(0, 0, 0, 0);
      if (openedDay > end) return false;
    }

    return isOpenTrade(trade);
  });
}

/**
 * Agent rows for Financial sheet (Agents + referral in Expenses) — same math as trade record sheet.
 */
export function getAgentSheetCalculations(trade) {
  if (!trade?.agentCommissionList?.length) return [];

  const tradeClassification = trade.keyInfo?.classification || "";
  const isCoOperatingSide = tradeClassification === "CO-OPERATING SIDE";
  const taxRate =
    trade.customTaxRate != null && trade.customTaxRate !== ""
      ? Number(trade.customTaxRate)
      : DEFAULT_TAX_RATE;

  const agentDoubleEnderOrder = new Map();
  if (tradeClassification === "AGENT DOUBLE ENDER") {
    trade.agentCommissionList.forEach((a, index) => {
      if (a.classification === "AGENT DOUBLE ENDER" && a.agentId) {
        const key = a.agentId;
        if (!agentDoubleEnderOrder.has(key)) {
          agentDoubleEnderOrder.set(key, []);
        }
        agentDoubleEnderOrder.get(key).push(index);
      }
    });
  }

  return trade.agentCommissionList.map((agent, agentIndex) => {
    const agentAmount =
      agent.amount && agent.amount !== "" ? parseFloat(agent.amount) : 0;
    const agentFeesDeducted =
      agent.feesDeducted && agent.feesDeducted !== ""
        ? parseFloat(agent.feesDeducted)
        : 0;
    const buyerRebateAmount =
      isBuyerRebateIncludedYes(agent) && agent.buyerRebateAmount
        ? parseFloat(agent.buyerRebateAmount) || 0
        : 0;
    const shareAfterPlan = agentAmount - agentFeesDeducted;
    const displaySubForSheet = Math.max(0, shareAfterPlan - buyerRebateAmount);

    let agentListing = "0.00";
    let agentSelling = "0.00";

    if (
      tradeClassification === "AGENT DOUBLE ENDER" &&
      agent.classification === "AGENT DOUBLE ENDER"
    ) {
      let transactionType = agent.transactionType;
      if (!transactionType && agent.agentId) {
        const agentIndices = agentDoubleEnderOrder.get(agent.agentId) || [];
        const positionInList = agentIndices.indexOf(agentIndex);
        transactionType = positionInList === 0 ? "LISTING" : "SELLING";
      }
      if (transactionType === "LISTING") {
        agentListing = roundTo2Str(displaySubForSheet);
        agentSelling = "0.00";
      } else if (transactionType === "SELLING") {
        agentListing = "0.00";
        agentSelling = roundTo2Str(displaySubForSheet);
      }
    } else if (isCoOperatingSide) {
      agentListing = "0.00";
      agentSelling = roundTo2Str(displaySubForSheet);
    } else {
      agentListing = roundTo2Str(displaySubForSheet);
      agentSelling = "0.00";
    }

    const agentSubTotal = roundTo2Str(
      roundTo2(parseFloat(agentListing) + parseFloat(agentSelling)),
    );
    const grossAgentTotal = roundTo2(
      parseFloat(agent.amount || 0) + parseFloat(agent.tax || 0),
    );
    const totalFeesNum = parseFloat(agent.totalFees || 0) || 0;
    const netCommissionNum =
      agent.netCommission !== undefined && agent.netCommission !== ""
        ? roundTo2(parseFloat(agent.netCommission))
        : roundTo2(grossAgentTotal - totalFeesNum);
    const agentTotal = roundTo2Str(netCommissionNum);
    const agentHST = roundTo2Str(
      roundTo2(netCommissionNum - parseFloat(agentSubTotal)),
    );

    return {
      ...agent,
      agentSubTotal,
      agentHST,
      agentTotal,
    };
  });
}

/** Single agent label for reports: "(id) Name" or "Ref. Name". */
export function getAgentCommissionDisplayLabel(agent) {
  if (!agent) return "";
  const name =
    agent.agentName ||
    [agent.firstName, agent.lastName].filter(Boolean).join(" ").trim();
  if (!name) return "";
  if (isReferralAgentRow(agent)) {
    return `Ref. ${name}`;
  }
  const id =
    agent.agentId != null && String(agent.agentId).trim() !== ""
      ? String(agent.agentId).trim()
      : "";
  return id ? `(${id}) ${name}` : name;
}

/** Agent commission incl. HST (or referral total) for one commission row. */
export function getAgentCommissionWithHst(agent) {
  if (!agent) return 0;
  if (isReferralAgentRow(agent)) {
    return roundTo2(
      parseFloat(agent.total) ||
        roundTo2(
          (parseFloat(agent.amount) || 0) + (parseFloat(agent.tax) || 0),
        ),
    );
  }
  return roundTo2(parseFloat(agent.agentTotal) || 0);
}

/** Agent net commission excluding HST (sub-total / referral amount). */
export function getAgentCommissionNetExclHst(agent) {
  if (!agent) return 0;
  if (isReferralAgentRow(agent)) {
    return roundTo2(parseFloat(agent.amount) || 0);
  }
  return roundTo2(parseFloat(agent.agentSubTotal) || 0);
}

/** Agent HST on commission (or referral tax). */
export function getAgentCommissionHstAmount(agent) {
  if (!agent) return 0;
  if (isReferralAgentRow(agent)) {
    return roundTo2(parseFloat(agent.tax) || 0);
  }
  return roundTo2(parseFloat(agent.agentHST) || 0);
}

/** Display names for Financial sheet agents + referral rows. */
export function getTradeAgentDisplayNames(trade) {
  const names = [];
  for (const agent of trade?.agentCommissionList || []) {
    const label = getAgentCommissionDisplayLabel(agent);
    if (label) names.push(label);
  }
  return names;
}

export function formatTradeShortAddress(trade) {
  const k = trade?.keyInfo || {};
  const line1 = [k.streetNumber, k.streetName, k.unit]
    .filter(Boolean)
    .join(" ");
  const line2 = [k.city, k.province, k.postalCode].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ") || "—";
}

/**
 * Financial sheet totals for one trade (Commission / Agents+referral / HST / Net to Office).
 */
export function getTradeFinancialReportTotals(trade) {
  if (!trade) {
    return {
      grossCommission: 0,
      totalHst: 0,
      totalCommission: 0,
      totalAgentCommissionWithHst: 0,
      totalAgentNetExclHst: 0,
      totalAgentHst: 0,
      officeShareWithoutHst: 0,
      netToOffice: 0,
      agentNames: [],
    };
  }

  const commissionIncome = trade.commission?.commissionIncomeRows?.[0] || {};
  const taxRate =
    trade.customTaxRate != null && trade.customTaxRate !== ""
      ? Number(trade.customTaxRate)
      : DEFAULT_TAX_RATE;

  const listingAmount = parseFloat(commissionIncome.listingAmount) || 0;
  const sellingAmount = parseFloat(commissionIncome.sellingAmount) || 0;
  const grossCommission = roundTo2(listingAmount + sellingAmount);
  const listingTax = roundTo2(listingAmount * taxRate);
  const sellingTax = roundTo2(sellingAmount * taxRate);
  const totalHst = roundTo2(listingTax + sellingTax);
  const totalCommission = roundTo2(grossCommission + totalHst);

  const agentRows = getAgentSheetCalculations(trade);
  let totalAgentCommissionWithHst = 0;
  let totalAgentNetExclHst = 0;
  let totalAgentHst = 0;

  for (const agent of agentRows) {
    totalAgentCommissionWithHst += getAgentCommissionWithHst(agent);
    totalAgentNetExclHst += getAgentCommissionNetExclHst(agent);
    totalAgentHst += getAgentCommissionHstAmount(agent);
  }

  const { netToOfficeTotal, netToOfficeSubTotal } = getNetToOfficeTotal(trade);

  return {
    grossCommission,
    totalHst,
    totalCommission,
    totalAgentCommissionWithHst: roundTo2(totalAgentCommissionWithHst),
    totalAgentNetExclHst: roundTo2(totalAgentNetExclHst),
    totalAgentHst: roundTo2(totalAgentHst),
    officeShareWithoutHst: roundTo2(parseFloat(netToOfficeSubTotal) || 0),
    netToOffice: parseFloat(netToOfficeTotal) || 0,
    agentNames: getTradeAgentDisplayNames(trade),
  };
}

/** One report row per agent on the trade (commissions split per agent). */
export function buildOpenTradeCommissionReportRows(trade) {
  const totals = getTradeFinancialReportTotals(trade);
  const opened = getTradeOpenedDate(trade);
  const tradeId = trade._id;
  const tradeNumber = trade.tradeNumber ?? trade.keyInfo?.tradeNumber ?? "";
  const address = formatTradeShortAddress(trade);
  const openedDateLabel = opened
    ? opened.toLocaleDateString("en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

  const base = {
    tradeId,
    tradeNumber,
    address,
    openedDate: opened,
    openedDateLabel,
  };

  const agentCalcs = getAgentSheetCalculations(trade);
  if (!agentCalcs.length) {
    return [
      {
        ...base,
        rowKey: `${tradeId}-0`,
        agentIndex: 0,
        isFirstAgentRow: true,
        grossCommission: totals.grossCommission,
        totalHst: totals.totalHst,
        totalCommission: totals.totalCommission,
        agentNetExclHst: 0,
        agentHstAmount: 0,
        totalAgentCommissionWithHst: 0,
        officeShareWithoutHst: totals.officeShareWithoutHst,
        agentNames: "—",
      },
    ];
  }

  return agentCalcs.map((agent, agentIndex) => {
    const isFirstAgentRow = agentIndex === 0;
    return {
      ...base,
      rowKey: `${tradeId}-${agentIndex}`,
      agentIndex,
      isFirstAgentRow,
      grossCommission: totals.grossCommission,
      totalHst: totals.totalHst,
      totalCommission: totals.totalCommission,
      agentNetExclHst: getAgentCommissionNetExclHst(agent),
      agentHstAmount: getAgentCommissionHstAmount(agent),
      totalAgentCommissionWithHst: getAgentCommissionWithHst(agent),
      officeShareWithoutHst: totals.officeShareWithoutHst,
      agentNames: getAgentCommissionDisplayLabel(agent) || "—",
    };
  });
}

/** @deprecated Use buildOpenTradeCommissionReportRows — returns first agent row only. */
export function buildOpenTradeCommissionReportRow(trade) {
  return buildOpenTradeCommissionReportRows(trade)[0];
}
