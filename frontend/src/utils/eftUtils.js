import { toast } from "react-toastify";
import axiosInstance from "../config/axios";

export const isTradeVoided = (trade) => Boolean(trade?.keyInfo?.voided);

// Check if Commission Trust EFT already exists for a trade and type (optionally filtered by agentId)
export const checkCommissionTrustEFT = async (tradeId, type, agentId = null) => {
  try {
    let url = `/commission-trust-eft/check-existing/${tradeId}/${type}`;
    // Add agentId as query parameter if provided (for AgentCommissionTransfer type)
    if (agentId) {
      url += `?agentId=${agentId}`;
    }
    const response = await axiosInstance.get(url);
    return response.data;
  } catch (error) {
    toast.error("Error checking Commission Trust EFT");
    return { exists: false };
  }
};

// Check if Real Estate Trust EFT already exists for a trade and type
export const checkRealEstateTrustEFT = async (tradeId, type) => {
  try {
    const response = await axiosInstance.get(
      `/real-estate-trust-eft/check-existing/${tradeId}/${type}`
    );
    return response.data;
  } catch (error) {
    toast.error("Error checking Real Estate Trust EFT");
    return { exists: false };
  }
};

// Get EFT type display name
export const getEFTTypeDisplayName = (type) => {
  const typeMap = {
    AgentCommissionTransfer: "Agent Commission Transfer",
    RefundOfDeposit: "Refund of Deposit",
    OutsideBrokerCommission: "Outside Broker Commission",
    OurBrokerageCommission: "Our Brokerage Commission",
    BuilderRepayment: "Builder Repayment",
    GeneralToCommissionTransfer: "General to Commission Transfer",
    CommissionTransfer: "Commission Transfer",
    CommissionReceived: "Commission Transfer",
    BalanceCommissionPayment: "Commission Transfer",
    BalanceOfDeposit: "Balance of Deposit",
  };
  return typeMap[type] || type;
};

// Get payment plan display name
export const getPaymentPlanDisplayName = (plan) => {
  const planMap = {
    plan250: "Plan 250",
    plan500: "Plan 500",
    plan9010: "Plan 90/10",
    plan955: "Plan 95/5",
    plan8515: "Plan 85/15",
    flexible: "Flexible Plan",
    flatFee: "Flat Fee",
    garnishment: "Garnishment",
    buyerRebate: "Buyer Rebate",
    noFee: "No Fee",
  };
  return planMap[plan] || plan;
};

/**
 * Label for the Agent Details "Percentage" column.
 * Order: named split plans (90/10, …) → stored commission % from agent info
 * (`agent.percentage`) when set → optional net ÷ agent base fallback.
 */
export const getAgentPlanSplitPercentLabel = (
  feeInfo,
  agentPercentage,
  shareCtx,
) => {
  const splitPlans = {
    plan9010: 90,
    plan955: 95,
    plan8515: 85,
    plan5050: 50,
    plan8020: 80,
  };
  if (feeInfo && splitPlans[feeInfo] != null) return `${splitPlans[feeInfo]}%`;

  const formatStoredPct = (val) => {
    if (val === undefined || val === null) return null;
    const raw = String(val).replace(/,/g, "").trim();
    if (raw === "") return null;
    const n = parseFloat(raw);
    if (Number.isNaN(n) || n < 0) return null;
    return `${Math.round(n * 100) / 100}%`;
  };

  const storedLabel = formatStoredPct(agentPercentage);
  if (storedLabel) return storedLabel;

  if (shareCtx && shareCtx.agentBase != null && shareCtx.netTotal != null) {
    const base = Number(shareCtx.agentBase);
    const net = Number(shareCtx.netTotal);
    if (Number.isFinite(base) && base > 0 && Number.isFinite(net) && net >= 0) {
      const pct = Math.min(100, Math.round((net / base) * 10000) / 100);
      return `${pct}%`;
    }
  }
  return "-";
};

// Format date for display
export const formatDate = (dateString) => {
  if (!dateString) return "N/A";

  // Handle both Date objects and date strings
  let date;
  if (dateString instanceof Date) {
    date = dateString;
  } else {
    // Parse the date string and create a date in local timezone
    const [year, month, day] = dateString.split("-");
    if (year && month && day) {
      // Create date in local timezone to avoid UTC conversion issues
      date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    } else {
      // Fallback to original method for other date formats
      date = new Date(dateString);
    }
  }

  return date.toLocaleDateString("en-CA");
};

// Check if General Account EFT invoice number already exists
export const checkGeneralAccountInvoice = async (invoiceNumber) => {
  try {
    const response = await axiosInstance.get(
      `/general-account-eft/check-invoice/${invoiceNumber}`
    );
    return response.data;
  } catch (error) {
    toast.error("Error checking invoice number");
    return { exists: false };
  }
};

// Format a number as currency with dollar sign and comma (e.g., $23,000.00)
export const formatCurrency = (amount) => {
  if (amount === null || amount === undefined || amount === "") return "$0.00";
  const num =
    typeof amount === "string" ? parseFloat(amount.replace(/,/g, "")) : amount;
  if (isNaN(num)) return "$0.00";
  return num.toLocaleString("en-US", { style: "currency", currency: "USD" });
};

/**
 * Dynamically extracts party names from trade based on deal type
 * @param {Object} trade - The trade object
 * @returns {Object} Object containing firstParty and secondParty names
 */
export const getPartyNamesByDealType = (trade) => {
  if (!trade || !trade.people || !Array.isArray(trade.people)) {
    return {
      firstParty: "N/A",
      secondParty: "N/A",
      firstPartyLabel: "",
      secondPartyLabel: "",
    };
  }

  const dealTypeRaw = trade.keyInfo?.dealType || "";
  const dealType = String(dealTypeRaw).trim().toLowerCase();

  const normalizePersonType = (t) => String(t || "").trim().toLowerCase();

  const getPersonDisplayName = (person) => {
    if (person.companyName && person.companyName.trim() !== "") {
      return person.companyName.trim();
    }
    const fullName = `${person.firstName || ""} ${
      person.lastName || ""
    }`.trim();
    return fullName;
  };

  const formatPartyLine = (peopleList) =>
    peopleList
      .map(getPersonDisplayName)
      .filter((n) => n && n.length > 0)
      .join(", ");

  /** If deal-type rules yield no payee name, try listing-side roles in order, then any named person */
  const firstPartyWithUniversalFallback = (primaryLine) => {
    if (primaryLine && primaryLine !== "N/A") return primaryLine;
    const roleOrder = ["landlord", "seller", "buyer", "tenant"];
    for (const role of roleOrder) {
      const line = formatPartyLine(
        trade.people.filter((p) => normalizePersonType(p.type) === role)
      );
      if (line) return line;
    }
    const anyNamed = formatPartyLine(trade.people);
    return anyNamed || "N/A";
  };

  const isLeaseDeal =
    dealType === "lease" ||
    dealType === "rental" ||
    dealType === "rent" ||
    dealType === "leasing";

  if (isLeaseDeal) {
    const landlordPeople = trade.people.filter(
      (p) => normalizePersonType(p.type) === "landlord"
    );
    const tenantPeople = trade.people.filter(
      (p) => normalizePersonType(p.type) === "tenant"
    );
    // Some lease trades list the listing side as "Seller" instead of "Landlord"
    const sellerAsListingSide = trade.people.filter(
      (p) => normalizePersonType(p.type) === "seller"
    );

    const landlords = formatPartyLine(landlordPeople);
    const tenants = formatPartyLine(tenantPeople);
    const sellersFallback = formatPartyLine(sellerAsListingSide);

    const primary = landlords || sellersFallback || "N/A";

    return {
      firstParty: firstPartyWithUniversalFallback(primary),
      secondParty: tenants || "N/A",
      firstPartyLabel: "Landlord",
      secondPartyLabel: "Tenant",
    };
  }

  const sellerPeople = trade.people.filter(
    (p) => normalizePersonType(p.type) === "seller"
  );
  const buyerPeople = trade.people.filter(
    (p) => normalizePersonType(p.type) === "buyer"
  );

  const sellers = formatPartyLine(sellerPeople);
  const buyers = formatPartyLine(buyerPeople);

  const primarySale = sellers || "N/A";

  return {
    firstParty: firstPartyWithUniversalFallback(primarySale),
    secondParty: buyers || "N/A",
    firstPartyLabel: "Seller",
    secondPartyLabel: "Buyer",
  };
};
