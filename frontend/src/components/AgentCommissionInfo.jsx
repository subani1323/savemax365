import React, { useState, useEffect, useRef } from "react";
import { toast } from "react-toastify";
import { getPaymentPlanDisplayName } from "../utils/eftUtils";
import axiosInstance from "../config/axios";
import { DEFAULT_TAX_RATE } from "../constants/tax";
import { roundTo2, roundTo2Str } from "../utils/numberUtils";
import {
  EXPENSE_FIELDS,
  NO_TAX_EXPENSE_KEYS,
  formatMoney,
  roundMoney,
} from "../utils/agentExpenseUtils";
import {
  computeOfficeExpenseRecovery,
  resolveOfficeExpenseAmounts,
} from "../utils/agentFeeTaxSplit";

function emptyExpenseMap() {
  return EXPENSE_FIELDS.reduce((acc, f) => {
    acc[f.key] = "";
    return acc;
  }, {});
}

function emptySelectedMap() {
  return EXPENSE_FIELDS.reduce((acc, f) => {
    acc[f.key] = false;
    return acc;
  }, {});
}

/** Convert inclusive remaining balance to form base amount (taxable lines). */
function remainingInclToBase(key, remainingIncl, taxRatePercent = 13) {
  const incl = roundMoney(remainingIncl || 0);
  if (incl <= 0) return 0;
  if (NO_TAX_EXPENSE_KEYS.has(key)) return incl;
  let rate = Number(taxRatePercent);
  if (!Number.isFinite(rate) || rate < 0) rate = 13;
  if (rate > 1) rate = rate / 100;
  return roundMoney(incl / (1 + rate));
}

function balancesFromApiRemaining(remaining = {}, taxRatePercent = 13) {
  const officeExpenseBalances = {};
  const officeExpenseAmounts = {};
  const officeExpenseSelected = emptySelectedMap();
  let any = false;
  for (const f of EXPENSE_FIELDS) {
    const incl = roundMoney(remaining[f.key] || 0);
    if (incl <= 0) continue;
    any = true;
    const base = remainingInclToBase(f.key, incl, taxRatePercent);
    officeExpenseBalances[f.key] = incl;
    officeExpenseAmounts[f.key] = String(base);
    officeExpenseSelected[f.key] = true;
  }
  return {
    any,
    officeExpenseBalances,
    officeExpenseAmounts,
    officeExpenseSelected,
  };
}

function activeOfficeExpenseAmounts(agentObj) {
  return resolveOfficeExpenseAmounts(agentObj);
}
const feePlans = [
  { label: "Referral Broker", value: "referralBroker" },
  { label: "Plan 250", value: "plan250" },
  { label: "Plan 500", value: "plan500" },
  { label: "Plan 90/10", value: "plan9010" },
  { label: "Plan 95/5", value: "plan955" },
  { label: "Plan 85/15", value: "plan8515" },
  { label: "Plan 50/50", value: "plan5050" },
  { label: "Plan 80/20", value: "plan8020" },
  { label: "Plan 150", value: "plan150" },
  { label: "Flexible Plan", value: "flexible" },
];

const initialAgent = {
  agentId: "",
  agentName: "",
  classification: "",
  ytdCommission: "Yes",
  awardAmount: "",
  percentage: 100,
  amount: "",
  feeInfo: "plan500",
  feesDeducted: "",
  tax: "",
  taxOverridden: false,
  taxOnFees: "",
  total: "",
  totalFees: "",
  netCommission: "",
  lead: "No",
  alreadyAdded: false,
  transactionType: "", // "LISTING" or "SELLING" for AGENT DOUBLE ENDER
  officeExpensesEnabled: false,
  officeExpenseTaxRate: 13,
  officeExpenseSelected: {},
  officeExpenseAmounts: {},
  officeExpenseBalances: {},
};

const initialSaleClosing = {
  sellPrice: "",
  closingDate: "",
  tradeNumber: "",
  status: "Active",
  ar: "",
};

const AgentCommissionInfo = ({
  goToPreviousSection,
  agent,
  setAgent,
  agents,
  setAgents,
  editingIndex,
  setEditingIndex,
  showDeleteModal,
  setShowDeleteModal,
  deletingIndex,
  setDeletingIndex,
  showBuyerRebateModal,
  setShowBuyerRebateModal,
  buyerRebateIncluded,
  setBuyerRebateIncluded,
  buyerRebateAmount,
  setBuyerRebateAmount,
  pendingAgent,
  setPendingAgent,
  validationErrors,
  setValidationErrors,
  onSaveTrade,
  classification,
  commissionData,
  selectedListing,
  isEditingExistingTrade = false,
  isEditMode = false,
  taxRate = DEFAULT_TAX_RATE,
}) => {
  const [agentList, setAgentList] = useState([]);
  const [isReferral, setIsReferral] = useState(false);
  /** Fee plan to restore when user unchecks Referral (new entry flow). */
  const feeInfoBeforeReferralRef = useRef(null);
  const [saleClosingRows, setSaleClosingRows] = useState([]);
  const [saleClosing, setSaleClosing] = useState(initialSaleClosing);
  const [isSaving, setIsSaving] = useState(false);
  const [isTradeSaved, setIsTradeSaved] = useState(false);
  const [selectedListingAgentIndex, setSelectedListingAgentIndex] = useState(0);
  // For AGENT DOUBLE ENDER: when adding an agent who has neither LISTING nor SELLING, we add both at once
  const [pendingAgentsToAdd, setPendingAgentsToAdd] = useState([]);
  /** While true, ADE Amount field keeps raw typed text (don't reformat to 2.00 mid-keystroke). */
  const adeAmountTypingRef = useRef(false);

  // Fetch agent list for dropdown
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const response = await axiosInstance.get("/agents");
        setAgentList(response.data);
      } catch (error) {
        setAgentList([]);
      }
    };
    fetchAgents();
  }, []);

  // Attach remaining Agent Expenses onto commission agents once master list is loaded
  useEffect(() => {
    if (!agentList?.length || !agents?.length) return;
    let cancelled = false;
    (async () => {
      const updated = [];
      for (const a of agents) {
        if (
          a.officeExpensesEnabled &&
          a.officeExpenseAmounts &&
          Object.values(a.officeExpenseAmounts).some((v) => Number(v) > 0)
        ) {
          updated.push(calculateFees(a));
          continue;
        }
        const dbAgent = agentList.find(
          (x) => String(x.employeeNo) === String(a.agentId),
        );
        if (!dbAgent?._id) {
          updated.push(a);
          continue;
        }
        try {
          const res = await axiosInstance.get(
            `/agent-expenses/balances/${dbAgent._id}`,
          );
          const taxPct = a.officeExpenseTaxRate ?? Math.round(taxRate * 100);
          const loaded = balancesFromApiRemaining(res.data?.remaining || {}, taxPct);
          if (!loaded.any) {
            updated.push(calculateFees(a));
            continue;
          }
          updated.push(
            calculateFees({
              ...a,
              officeExpensesEnabled: true,
              officeExpenseTaxRate: taxPct,
              officeExpenseBalances: loaded.officeExpenseBalances,
              officeExpenseAmounts: loaded.officeExpenseAmounts,
              officeExpenseSelected: loaded.officeExpenseSelected,
            }),
          );
        } catch {
          updated.push(a);
        }
      }
      if (!cancelled) setAgents(updated);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentList]);

  // Reset selected agent index when listing changes
  useEffect(() => {
    setSelectedListingAgentIndex(0);
  }, [selectedListing]);

  // Auto-calculate amount when awardAmount or percentage changes
  useEffect(() => {
    const award = parseFloat(agent.awardAmount) || 0;
    const perc = parseFloat(agent.percentage) || 0;
    const amount = roundTo2Str(roundTo2((award * perc) / 100));
    setAgent((prev) => {
      // Don't clobber ADE amount while the user is typing in the Amount field
      if (
        adeAmountTypingRef.current &&
        prev.classification === "AGENT DOUBLE ENDER"
      ) {
        const typed = String(prev.amount ?? "");
        const numeric = roundTo2(parseFloat(typed.replace(/,/g, "")) || 0);
        const fees = calculateFees({ ...prev, amount: roundTo2Str(numeric) });
        return { ...fees, amount: typed, percentage: prev.percentage };
      }
      return calculateFees({ ...prev, amount });
    });
    // eslint-disable-next-line
  }, [agent.awardAmount, agent.percentage, agent.feeInfo, agent.feesDeducted]);

  // Recalculate current agent and all added agents when tax rate changes (e.g. Set Tax Rate applied in Commission Income)
  useEffect(() => {
    setAgent((prev) => calculateFees(prev));
    setAgents((prevList) => prevList.map((a) => calculateFees(a)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxRate]);

  // ADE: default Side when empty; refresh Award from Commission Income when Side changes
  useEffect(() => {
    if (classification !== "AGENT DOUBLE ENDER" || !commissionData) return;

    setAgent((prev) => {
      let transactionType = prev.transactionType;
      if (!transactionType) {
        if (prev.agentId) {
          const hasListing = agents.some(
            (a) =>
              a.agentId === prev.agentId &&
              a.classification === "AGENT DOUBLE ENDER" &&
              a.transactionType === "LISTING",
          );
          const hasSelling = agents.some(
            (a) =>
              a.agentId === prev.agentId &&
              a.classification === "AGENT DOUBLE ENDER" &&
              a.transactionType === "SELLING",
          );
          if (!hasListing) transactionType = "LISTING";
          else if (!hasSelling) transactionType = "SELLING";
          else transactionType = "LISTING";
        } else {
          transactionType = "LISTING";
        }
      }

      const sideAward =
        transactionType === "SELLING"
          ? parseFloat(commissionData.sellingAmount) || 0
          : parseFloat(commissionData.listingAmount) || 0;
      const calculatedAwardAmount = sideAward.toFixed(2);
      const typeJustSet = !prev.transactionType && !!transactionType;
      const typeChanged =
        prev.transactionType && prev.transactionType !== transactionType;

      // Only auto-fill award when side is first set or changed — do not clobber amount overrides
      if (!typeJustSet && !typeChanged) {
        if (prev.transactionType === transactionType) return prev;
        return calculateFees({ ...prev, transactionType });
      }

      const perc = parseFloat(prev.percentage) || 0;
      const amount = roundTo2Str(
        roundTo2((sideAward * perc) / 100),
      );
      return calculateFees({
        ...prev,
        transactionType,
        awardAmount: calculatedAwardAmount,
        amount,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agent.transactionType,
    agent.agentId,
    classification,
    commissionData?.listingAmount,
    commissionData?.sellingAmount,
    agents,
  ]);

  // Auto-calculate next agent percentage: 100 − sum(all already-added agents)
  useEffect(() => {
    if (editingIndex !== null) return;
    if (
      (agent.classification === "LISTING SIDE" ||
        agent.classification === "CO-OPERATING SIDE") &&
      agents.length >= 1
    ) {
      const totalExisting = agents.reduce(
        (sum, a) => sum + (parseFloat(a.percentage) || 0),
        0,
      );
      const remainingPercentage = Math.max(0, 100 - totalExisting);
      // Only override when form still shows default 100% (user has not typed a custom split)
      if (parseFloat(String(agent.percentage)) === 100) {
        setAgent((prev) => ({
          ...prev,
          percentage: remainingPercentage.toString(),
        }));
      }
    }
  }, [agents, agent.classification, agent.percentage, editingIndex]);

  // Calculate award amount based on classification and commission data
  useEffect(() => {
    if (classification && commissionData) {
      // Skip AGENT DOUBLE ENDER here - handled by the transactionType-specific effect
      if (classification === "AGENT DOUBLE ENDER") {
        return;
      }

      let calculatedAwardAmount = "0.00";

      if (classification === "LISTING SIDE") {
        const listingAmount = parseFloat(commissionData.listingAmount) || 0;
        calculatedAwardAmount = listingAmount.toFixed(2);
      } else if (classification === "SELLING SIDE") {
        const sellingAmount = parseFloat(commissionData.sellingAmount) || 0;
        calculatedAwardAmount = sellingAmount.toFixed(2);
      } else if (classification === "CO-OPERATING SIDE") {
        const sellingAmount = parseFloat(commissionData.sellingAmount) || 0;
        calculatedAwardAmount = sellingAmount.toFixed(2);
      } else {
        calculatedAwardAmount = "0.00";
      }

      // Only update if award amount is empty or different
      if (
        !agent.awardAmount ||
        agent.awardAmount === "0.00" ||
        agent.awardAmount !== calculatedAwardAmount
      ) {
        const updatedAgent = {
          ...agent,
          awardAmount: calculatedAwardAmount,
        };
        setAgent(calculateFees(updatedAgent));
      }
    }
  }, [classification, commissionData, agent.awardAmount]);

  // Set classification from KeyInfoForm when available
  useEffect(() => {
    if (classification) {
      setAgent((prev) => ({
        ...prev,
        classification: classification,
        // Don't auto-set transactionType here - let the useEffect handle it based on existing agents
        transactionType:
          classification !== "AGENT DOUBLE ENDER" ? "" : prev.transactionType,
      }));

      // Clear agent information when switching to CO-OPERATING SIDE
      if (classification === "CO-OPERATING SIDE") {
        setAgent((prev) => ({
          ...prev,
          agentId: "",
          agentName: "",
        }));
        // Clear validation errors when switching classification
        setValidationErrors((prev) => ({
          ...prev,
          agentId: "",
          agentName: "",
        }));
      }
    }
  }, [classification]);

  // Referral agents: no desk fees — plan must be Referral Broker and fees deducted 0
  useEffect(() => {
    if (agent.classification !== "Referral") return;
    setIsReferral(true);
    setAgent((prev) => {
      if (prev.classification !== "Referral") return prev;
      const fd = parseFloat(String(prev.feesDeducted).replace(/,/g, "")) || 0;
      if (prev.feeInfo === "referralBroker" && fd === 0) return prev;
      return calculateFees({
        ...prev,
        feeInfo: "referralBroker",
        feesDeducted: "0.00",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.classification]);

  // Auto-populate agent information from selected listing (for LISTING SIDE and AGENT DOUBLE ENDER)
  useEffect(() => {
    console.log("selectedListing in AgentCommissionInfo:", selectedListing);
    console.log("selectedListing type:", typeof selectedListing);
    console.log(
      "selectedListing keys:",
      selectedListing ? Object.keys(selectedListing) : "null",
    );
    console.log("isEditingExistingTrade:", isEditingExistingTrade);
    console.log("classification:", classification);

    // When editing a specific row (editingIndex set), don't overwrite - user is modifying that row
    if (editingIndex !== null) {
      return;
    }

    // Auto-populate if classification is LISTING SIDE or AGENT DOUBLE ENDER
    if (
      classification !== "LISTING SIDE" &&
      classification !== "AGENT DOUBLE ENDER"
    ) {
      console.log(
        "Classification is not LISTING SIDE or AGENT DOUBLE ENDER - not auto-populating agent information",
      );
      return;
    }

    if (selectedListing) {
      console.log("selectedListing.agent:", selectedListing.agent);
      console.log("selectedListing.agents:", selectedListing.agents);

      let listingAgent = null;

      // Check if agent is in the agents array first (this is the primary location)
      if (selectedListing.agents && selectedListing.agents.length > 0) {
        console.log(
          "Found agent in selectedListing.agents:",
          selectedListing.agents,
        );
        // Get available agents (not already added)
        const availableAgents = getAvailableListingAgents();
        if (availableAgents.length > 0) {
          // Use the selected agent index from available agents, defaulting to 0
          const agentIndex =
            selectedListingAgentIndex < availableAgents.length
              ? selectedListingAgentIndex
              : 0;
          listingAgent = availableAgents[agentIndex];
          console.log(
            "Using available agent at index:",
            agentIndex,
            listingAgent,
          );
        } else {
          // No available agents - show the last available agent but mark as already added
          console.log(
            "No available agents, showing last agent as already added",
          );
          if (selectedListing.agents && selectedListing.agents.length > 0) {
            const lastAgent =
              selectedListing.agents[selectedListing.agents.length - 1];
            const agentId = lastAgent.agentNo?.toString() || "";
            const agentName = `${lastAgent.firstName || ""} ${
              lastAgent.lastName || ""
            }`.trim();

            if (agentId && agentName) {
              setAgent((prev) => ({
                ...prev,
                agentId: agentId,
                agentName: agentName,
                // Mark this agent as already added by setting a flag
                alreadyAdded: true,
              }));
            }
          }
          return; // Exit early to prevent further processing
        }
      }
      // Check if agent is in the agent property (fallback)
      else if (selectedListing.agent) {
        console.log(
          "Found agent in selectedListing.agent:",
          selectedListing.agent,
        );
        listingAgent = selectedListing.agent;
      }

      if (listingAgent) {
        console.log("listingAgent to use:", listingAgent);
        console.log("listingAgent keys:", Object.keys(listingAgent));

        // Handle both data structures
        let agentId = "";
        let agentName = "";

        if (selectedListing.agents && selectedListing.agents.length > 0) {
          // Using agents array structure
          agentId = listingAgent.agentNo?.toString() || "";
          agentName = `${listingAgent.firstName || ""} ${
            listingAgent.lastName || ""
          }`.trim();
        } else if (selectedListing.agent) {
          // Using singular agent structure
          agentId = listingAgent.employeeNo?.toString() || "";
          // For singular agent, we need to get the name from the agents array if available
          if (selectedListing.agents && selectedListing.agents.length > 0) {
            const agentFromArray = selectedListing.agents[0];
            agentName = `${agentFromArray.firstName || ""} ${
              agentFromArray.lastName || ""
            }`.trim();
          } else {
            agentName = ""; // No name available in singular agent structure
          }
        }

        console.log("Calculated agentId:", agentId);
        console.log("Calculated agentName:", agentName);

        if (agentId && agentName) {
          setAgent((prev) => ({
            ...prev,
            agentId: agentId,
            agentName: agentName,
          }));
          // Clear validation errors when agent is auto-populated
          setValidationErrors((prev) => ({
            ...prev,
            agentId: "",
            agentName: "",
          }));
        } else {
          console.log("Agent ID or name is missing, not setting agent data");
        }
      } else {
        console.log("No agent found in selectedListing");
      }
    }
  }, [
    selectedListing,
    editingIndex,
    classification,
    selectedListingAgentIndex,
    agents, // Add agents to dependency array so auto-population re-runs when agents are added
  ]);

  const validateForm = () => {
    const errors = {};
    if (!String(agent.agentId || "").trim()) {
      errors.agentId = "Agent ID is required";
    }
    if (!String(agent.agentName || "").trim()) {
      errors.agentName = "Agent Name is required";
    }

    // ADE only: listing/selling posted amounts cannot exceed Commission Income for that side
    if (agent.classification === "AGENT DOUBLE ENDER") {
      const side = agent.transactionType || "LISTING";
      const sideCap =
        side === "SELLING"
          ? parseFloat(commissionData?.sellingAmount) || 0
          : parseFloat(commissionData?.listingAmount) || 0;
      const postedOnSide = agents.reduce((sum, a, idx) => {
        if (editingIndex !== null && idx === editingIndex) return sum;
        if (
          a.classification !== "AGENT DOUBLE ENDER" ||
          a.transactionType !== side
        ) {
          return sum;
        }
        return roundTo2(sum + (parseFloat(a.amount) || 0));
      }, 0);
      const thisAmount = roundTo2(parseFloat(agent.amount) || 0);
      const remaining = roundTo2(Math.max(0, sideCap - postedOnSide));
      if (thisAmount > remaining + 0.001) {
        const sideLabel = side === "SELLING" ? "selling" : "listing";
        errors.amount = `Amount cannot exceed remaining ${sideLabel} commission ($${remaining.toFixed(2)} of $${sideCap.toFixed(2)}).`;
      }
    }

    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error(
        errors.amount || "Please fix the validation errors.",
      );
    }
    return Object.keys(errors).length === 0;
  };

  const handleAgentInputChange = (e) => {
    const { name, value } = e.target;
    let updated = { ...agent, [name]: value };
    const isAde = agent.classification === "AGENT DOUBLE ENDER";

    // ADE only: Amount ↔ Percentage sync, and amount capped to side commission
    if (isAde && name === "amount") {
      adeAmountTypingRef.current = true;
      // Keep raw typed value so multi-digit entry works (don't force "2.00" each keystroke)
      const raw = String(value).replace(/,/g, "");
      if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) {
        return;
      }

      const award = parseFloat(agent.awardAmount) || 0;
      let amt = roundTo2(parseFloat(raw) || 0);

      const side = agent.transactionType || "LISTING";
      const sideCap =
        side === "SELLING"
          ? parseFloat(commissionData?.sellingAmount) || 0
          : parseFloat(commissionData?.listingAmount) || 0;
      const postedOnSide = agents.reduce((sum, a, idx) => {
        if (editingIndex !== null && idx === editingIndex) return sum;
        if (
          a.classification !== "AGENT DOUBLE ENDER" ||
          a.transactionType !== side
        ) {
          return sum;
        }
        return roundTo2(sum + (parseFloat(a.amount) || 0));
      }, 0);
      const remaining = roundTo2(Math.max(0, sideCap - postedOnSide));
      let displayAmount = raw;
      if (amt > remaining) {
        amt = remaining;
        displayAmount = roundTo2Str(remaining);
        toast.error(
          `${side === "SELLING" ? "Selling" : "Listing"} amount cannot exceed remaining ${side === "SELLING" ? "selling" : "listing"} commission ($${remaining.toFixed(2)}).`,
        );
      }

      updated.amount = displayAmount;
      if (award > 0) {
        updated.percentage = roundTo2Str((amt / award) * 100);
      } else if (amt > 0) {
        updated.awardAmount = roundTo2Str(amt);
        updated.percentage = "100.00";
      }

      const fees = calculateFees({
        ...updated,
        amount: roundTo2Str(amt),
      });
      setAgent({
        ...fees,
        amount: displayAmount,
        percentage: updated.percentage,
      });

      if (validationErrors.amount) {
        setValidationErrors((prev) => {
          const next = { ...prev };
          delete next.amount;
          return next;
        });
      }
      return;
    } else if (isAde && name === "percentage") {
      adeAmountTypingRef.current = false;
      const award = parseFloat(agent.awardAmount) || 0;
      // Allow typing percentage freely; format lightly
      const rawPerc = String(value).replace(/,/g, "");
      if (rawPerc !== "" && !/^\d*\.?\d*$/.test(rawPerc)) {
        return;
      }
      const perc = roundTo2(parseFloat(rawPerc) || 0);
      updated.percentage = rawPerc;
      let amt = roundTo2((award * perc) / 100);

      const side = agent.transactionType || "LISTING";
      const sideCap =
        side === "SELLING"
          ? parseFloat(commissionData?.sellingAmount) || 0
          : parseFloat(commissionData?.listingAmount) || 0;
      const postedOnSide = agents.reduce((sum, a, idx) => {
        if (editingIndex !== null && idx === editingIndex) return sum;
        if (
          a.classification !== "AGENT DOUBLE ENDER" ||
          a.transactionType !== side
        ) {
          return sum;
        }
        return roundTo2(sum + (parseFloat(a.amount) || 0));
      }, 0);
      const remaining = roundTo2(Math.max(0, sideCap - postedOnSide));
      if (amt > remaining) {
        amt = remaining;
        if (award > 0) {
          updated.percentage = roundTo2Str((amt / award) * 100);
        }
        toast.error(
          `${side === "SELLING" ? "Selling" : "Listing"} amount cannot exceed remaining ${side === "SELLING" ? "selling" : "listing"} commission ($${remaining.toFixed(2)}).`,
        );
      }
      updated.amount = roundTo2Str(amt);
    } else if (isAde && name === "awardAmount") {
      adeAmountTypingRef.current = false;
      const award = roundTo2(parseFloat(String(value).replace(/,/g, "")) || 0);
      const perc = parseFloat(agent.percentage) || 0;
      updated.awardAmount = roundTo2Str(award);
      updated.amount = roundTo2Str(roundTo2((award * perc) / 100));
    } else if (isAde && name === "transactionType") {
      adeAmountTypingRef.current = false;
      if (commissionData) {
        if (value === "LISTING") {
          updated.awardAmount = (
            parseFloat(commissionData.listingAmount) || 0
          ).toFixed(2);
        } else if (value === "SELLING") {
          updated.awardAmount = (
            parseFloat(commissionData.sellingAmount) || 0
          ).toFixed(2);
        }
        const award = parseFloat(updated.awardAmount) || 0;
        const perc = parseFloat(updated.percentage) || 0;
        updated.amount = roundTo2Str(roundTo2((award * perc) / 100));
      }
    }

    setAgent(calculateFees(updated));

    if (validationErrors[name] || (isAde && name === "amount")) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        if (name === "amount" || name === "percentage") delete next.amount;
        return next;
      });
    }
  };

  const handleAdeAmountBlur = () => {
    if (agent.classification !== "AGENT DOUBLE ENDER") return;
    adeAmountTypingRef.current = false;

    const award = parseFloat(agent.awardAmount) || 0;
    let amt = roundTo2(parseFloat(String(agent.amount || "").replace(/,/g, "")) || 0);

    const side = agent.transactionType || "LISTING";
    const sideCap =
      side === "SELLING"
        ? parseFloat(commissionData?.sellingAmount) || 0
        : parseFloat(commissionData?.listingAmount) || 0;
    const postedOnSide = agents.reduce((sum, a, idx) => {
      if (editingIndex !== null && idx === editingIndex) return sum;
      if (
        a.classification !== "AGENT DOUBLE ENDER" ||
        a.transactionType !== side
      ) {
        return sum;
      }
      return roundTo2(sum + (parseFloat(a.amount) || 0));
    }, 0);
    const remaining = roundTo2(Math.max(0, sideCap - postedOnSide));
    if (amt > remaining) {
      amt = remaining;
      toast.error(
        `${side === "SELLING" ? "Selling" : "Listing"} amount cannot exceed remaining ${side === "SELLING" ? "selling" : "listing"} commission ($${remaining.toFixed(2)}).`,
      );
    }

    const percentage =
      award > 0 ? roundTo2Str((amt / award) * 100) : agent.percentage;
    setAgent(
      calculateFees({
        ...agent,
        amount: roundTo2Str(amt),
        percentage,
      }),
    );
  };

  const loadOfficeExpensePatchForEmployeeNo = async (employeeNo) => {
    const taxPct = Math.round(taxRate * 100);
    const emptyPatch = {
      officeExpensesEnabled: false,
      officeExpenseTaxRate: taxPct,
      officeExpenseBalances: {},
      officeExpenseAmounts: emptyExpenseMap(),
      officeExpenseSelected: emptySelectedMap(),
    };
    if (!employeeNo) return emptyPatch;
    const dbAgent = agentList.find(
      (a) => String(a.employeeNo) === String(employeeNo),
    );
    if (!dbAgent?._id) return emptyPatch;
    try {
      const res = await axiosInstance.get(
        `/agent-expenses/balances/${dbAgent._id}`,
      );
      const loaded = balancesFromApiRemaining(
        res.data?.remaining || {},
        taxPct,
      );
      if (!loaded.any) return emptyPatch;
      return {
        officeExpensesEnabled: true,
        officeExpenseTaxRate: taxPct,
        officeExpenseBalances: loaded.officeExpenseBalances,
        officeExpenseAmounts: {
          ...emptyExpenseMap(),
          ...loaded.officeExpenseAmounts,
        },
        officeExpenseSelected: loaded.officeExpenseSelected,
      };
    } catch (err) {
      console.warn("Could not load agent expense balances", err);
      return emptyPatch;
    }
  };

  const handleAgentSelect = async (e) => {
    const selectedId = e.target.value;
    const selected = agentList.find((a) => a._id === selectedId);
    if (selected) {
      const officePatch = await loadOfficeExpensePatchForEmployeeNo(
        selected.employeeNo,
      );
      setAgent((prev) =>
        calculateFees({
          ...prev,
          agentId: selected.employeeNo,
          agentName: `${selected.firstName} ${selected.lastName}`,
          ...officePatch,
        }),
      );
      setValidationErrors((prev) => ({
        ...prev,
        agentId: "",
        agentName: "",
      }));
    } else {
      setAgent((prev) =>
        calculateFees({
          ...prev,
          agentId: "",
          agentName: "",
          officeExpensesEnabled: false,
          officeExpenseBalances: {},
          officeExpenseAmounts: emptyExpenseMap(),
          officeExpenseSelected: emptySelectedMap(),
        }),
      );
    }
  };

  const handleOfficeExpenseToggle = (enabled) => {
    setAgent((prev) =>
      calculateFees({
        ...prev,
        officeExpensesEnabled: enabled,
      }),
    );
  };

  const handleOfficeLineSelect = (key, checked) => {
    setAgent((prev) => {
      const officeExpenseSelected = {
        ...(prev.officeExpenseSelected || emptySelectedMap()),
        [key]: checked,
      };
      const officeExpenseAmounts = { ...(prev.officeExpenseAmounts || {}) };
      if (checked && !officeExpenseAmounts[key] && prev.officeExpenseBalances?.[key]) {
        officeExpenseAmounts[key] = String(
          remainingInclToBase(
            key,
            prev.officeExpenseBalances[key],
            prev.officeExpenseTaxRate ?? 13,
          ),
        );
      }
      return calculateFees({
        ...prev,
        officeExpenseSelected,
        officeExpenseAmounts,
      });
    });
  };

  const handleOfficeLineAmount = (key, value) => {
    setAgent((prev) =>
      calculateFees({
        ...prev,
        officeExpenseSelected: {
          ...(prev.officeExpenseSelected || emptySelectedMap()),
          [key]: true,
        },
        officeExpenseAmounts: {
          ...(prev.officeExpenseAmounts || {}),
          [key]: value,
        },
      }),
    );
  };

  const handleOfficeTaxRateChange = (value) => {
    setAgent((prev) =>
      calculateFees({
        ...prev,
        officeExpenseTaxRate: value,
      }),
    );
  };

  const handleListingAgentSelect = async (e) => {
    const selectedIndex = parseInt(e.target.value);
    setSelectedListingAgentIndex(selectedIndex);

    const availableAgents = getAvailableListingAgents();
    if (availableAgents[selectedIndex]) {
      const selectedAgent = availableAgents[selectedIndex];
      const agentId = selectedAgent.agentNo?.toString() || "";
      const agentName = `${selectedAgent.firstName || ""} ${
        selectedAgent.lastName || ""
      }`.trim();
      const officePatch = await loadOfficeExpensePatchForEmployeeNo(agentId);

      setAgent((prev) =>
        calculateFees({
          ...prev,
          agentId: agentId,
          agentName: agentName,
          ...officePatch,
        }),
      );

      // Clear validation errors
      setValidationErrors((prev) => ({
        ...prev,
        agentId: "",
        agentName: "",
      }));
    }
  };

  // Get available agents (not already added to the table)
  const getAvailableListingAgents = () => {
    if (
      !selectedListing ||
      !selectedListing.agents ||
      selectedListing.agents.length === 0
    ) {
      return [];
    }

    // For AGENT DOUBLE ENDER: only filter out agents who have BOTH listing and selling
    if (classification === "AGENT DOUBLE ENDER") {
      return selectedListing.agents.filter((listingAgent) => {
        const agentId = String(listingAgent.agentNo ?? "").trim();
        if (!agentId) return true;
        const hasListing = agents.some(
          (a) =>
            String(a.agentId || "").trim() === agentId &&
            a.classification === "AGENT DOUBLE ENDER" &&
            a.transactionType === "LISTING",
        );
        const hasSelling = agents.some(
          (a) =>
            String(a.agentId || "").trim() === agentId &&
            a.classification === "AGENT DOUBLE ENDER" &&
            a.transactionType === "SELLING",
        );
        return !(hasListing && hasSelling);
      });
    }

    // For other classifications: filter out any agent already in the table
    const existingAgentIds = agents.map((a) => a.agentId);
    return selectedListing.agents.filter((listingAgent) => {
      const agentId = listingAgent.agentNo?.toString() || "";
      return !existingAgentIds.includes(agentId);
    });
  };

  // Get available CO-OPERATING SIDE agents (not already added to the table)
  const getAvailableCoOperatingAgents = () => {
    // Get agent IDs that are already in the table for CO-OPERATING SIDE
    const existingCoOperatingAgentIds = agents
      .filter((a) => a.classification === "CO-OPERATING SIDE")
      .map((a) => a.agentId);

    // Filter out agents that are already added
    return agentList.filter((agentItem) => {
      const agentId = agentItem.employeeNo?.toString() || "";
      return !existingCoOperatingAgentIds.includes(agentId);
    });
  };

  // Check if agent is already added (with transaction type for AGENT DOUBLE ENDER).
  // When editing, exclude the row currently being edited so Update stays enabled.
  const isAgentAlreadyAdded = (
    agentId,
    agentClassification,
    transactionType,
    excludeIndex = editingIndex,
  ) => {
    if (!agentId) return false;

    const idStr = String(agentId).trim();
    if (!idStr) return false;

    if (agentClassification === "AGENT DOUBLE ENDER") {
      return agents.some(
        (a, idx) =>
          (excludeIndex === null || excludeIndex === undefined
            ? true
            : idx !== excludeIndex) &&
          String(a.agentId || "").trim() === idStr &&
          a.classification === "AGENT DOUBLE ENDER" &&
          a.transactionType === transactionType,
      );
    }

    return agents.some(
      (a, idx) =>
        (excludeIndex === null || excludeIndex === undefined
          ? true
          : idx !== excludeIndex) &&
        String(a.agentId || "").trim() === idStr,
    );
  };

  const calculateFees = (agentObj) => {
    const taxOverridden = !!(
      agentObj.taxOverridden === true || agentObj.taxOverridden === "true"
    );

    // Calculate amount based on award amount and percentage (rounded to 2 decimals)
    const awardAmount = parseFloat(agentObj.awardAmount) || 0;
    const percentage = parseFloat(agentObj.percentage) || 0;
    const calculatedAmount = roundTo2((awardAmount * percentage) / 100);

    // Standard HST on commission (Amount × rate); when override is on, this amount is also included in Total Fees (office share)
    const defaultCommissionTax = roundTo2(calculatedAmount * taxRate);

    const rawTaxInput = String(agentObj.tax ?? "")
      .replace(/,/g, "")
      .trim();
    const parsedOverrideTax =
      rawTaxInput === ""
        ? defaultCommissionTax
        : roundTo2(parseFloat(rawTaxInput) || 0);
    const tax = taxOverridden ? parsedOverrideTax : defaultCommissionTax;

    const total = roundTo2(calculatedAmount + tax);

    // Calculate fees deducted based on fee plan
    let feesDeducted = 0;
    switch (agentObj.feeInfo) {
      case "referralBroker":
        feesDeducted = 0;
        break;
      case "plan250":
        feesDeducted = 250;
        break;
      case "plan500":
        feesDeducted = 500;
        break;
      case "plan9010":
        feesDeducted = roundTo2(calculatedAmount * 0.1); // 10% of amount
        break;
      case "plan8515":
        feesDeducted = roundTo2(calculatedAmount * 0.15); // 15% of amount
        break;
      case "plan955":
        feesDeducted = roundTo2(calculatedAmount * 0.05); // 5% of amount
        break;
      case "plan5050":
        feesDeducted = roundTo2(calculatedAmount * 0.5); // 50% of amount
        break;
      case "plan8020":
        feesDeducted = roundTo2(calculatedAmount * 0.2); // 20% of amount
        break;
      case "plan150":
        feesDeducted = 150;
        break;
      case "flexible":
        feesDeducted = roundTo2(parseFloat(agentObj.feesDeducted) || 0); // Use user input
        break;
      default:
        feesDeducted = 0;
    }

    // Calculate tax on fees using tax rate
    const taxOnFees = roundTo2(feesDeducted * taxRate);
    const baseOfficeFees = roundTo2(feesDeducted + taxOnFees);
    const officeShareHstOnCommission = taxOverridden ? defaultCommissionTax : 0;
    const officeTaxRate =
      agentObj.officeExpenseTaxRate != null && agentObj.officeExpenseTaxRate !== ""
        ? agentObj.officeExpenseTaxRate
        : Math.round(taxRate * 100);
    const officeRecovery = computeOfficeExpenseRecovery(
      activeOfficeExpenseAmounts(agentObj),
      officeTaxRate,
    );
    const totalFees = roundTo2(
      baseOfficeFees + officeShareHstOnCommission + officeRecovery.to12100,
    );

    // Calculate net commission
    const netCommission = roundTo2(total - totalFees);

    return {
      ...agentObj,
      taxOverridden,
      amount: roundTo2Str(calculatedAmount),
      feesDeducted:
        agentObj.feeInfo === "flexible"
          ? agentObj.feesDeducted
          : roundTo2Str(feesDeducted),
      tax: roundTo2Str(tax),
      total: roundTo2Str(total),
      taxOnFees: roundTo2Str(taxOnFees),
      totalFees: roundTo2Str(totalFees),
      netCommission: roundTo2Str(netCommission),
      officeExpensesEnabled: !!agentObj.officeExpensesEnabled,
      officeExpenseTaxRate: officeTaxRate,
      officeExpenseSelected: agentObj.officeExpenseSelected || emptySelectedMap(),
      officeExpenseAmounts: agentObj.officeExpenseAmounts || {},
      officeExpenseBalances: agentObj.officeExpenseBalances || {},
      officeExpensesTotal: officeRecovery.to12100,
    };
  };

  const handleAddAgent = (e) => {
    e.preventDefault();

    // Validate mandatory fields
    if (!validateForm()) {
      return;
    }

    // When Referral is checked, add to Agent Info table with classification "Referral"
    if (isReferral) {
      const agentWithRef = {
        ...agent,
        classification: "Referral",
        transactionType: agent.transactionType || "",
      };
      setPendingAgent(agentWithRef);
      setPendingAgentsToAdd([]);
      setShowBuyerRebateModal(true);
      setIsReferral(false);
      return;
    }

    // For AGENT DOUBLE ENDER: post Listing and Selling separately (one side per Add)
    if (classification === "AGENT DOUBLE ENDER") {
      const transactionType = agent.transactionType || "LISTING";
      const hasThisSide = agents.some(
        (a) =>
          a.agentId === agent.agentId &&
          a.classification === "AGENT DOUBLE ENDER" &&
          a.transactionType === transactionType,
      );

      if (hasThisSide) {
        toast.error(
          `This agent already has a ${
            transactionType === "LISTING" ? "Listing" : "Selling"
          } side entry.`,
        );
        return;
      }

      const sideAward =
        transactionType === "LISTING"
          ? parseFloat(commissionData?.listingAmount) || 0
          : parseFloat(commissionData?.sellingAmount) || 0;

      const agentWithSide = calculateFees({
        ...agent,
        transactionType,
        // Prefer form award (may match side); fall back to commission income for the side
        awardAmount:
          agent.awardAmount && parseFloat(agent.awardAmount) > 0
            ? agent.awardAmount
            : sideAward.toFixed(2),
      });

      setPendingAgentsToAdd([]);
      setPendingAgent(agentWithSide);
      setShowBuyerRebateModal(true);
      return;
    }

    // Non-AGENT DOUBLE ENDER: single agent add
    const alreadyAdded = isAgentAlreadyAdded(
      agent.agentId,
      agent.classification,
      agent.transactionType,
    );
    if (alreadyAdded) {
      toast.error("This agent has already been added to the list.");
      return;
    }
    setPendingAgentsToAdd([]);
    setPendingAgent(agent);
    setShowBuyerRebateModal(true);
  };

  const handleCancelBuyerRebate = () => {
    setShowBuyerRebateModal(false);
    setBuyerRebateIncluded("no");
    setBuyerRebateAmount("");
    setPendingAgent(null);
    setPendingAgentsToAdd([]);
  };

  const handleEdit = (index = 0) => {
    if (agents.length === 0) return;
    const idx = Number.isInteger(index) ? index : 0;
    if (idx < 0 || idx >= agents.length) return;

    const agentToEdit = agents[idx];
    setAgent(calculateFees({ ...agentToEdit }));
    setEditingIndex(idx);
    adeAmountTypingRef.current = false;

    if (agentToEdit.buyerRebateIncluded) {
      setBuyerRebateIncluded(agentToEdit.buyerRebateIncluded);
      setBuyerRebateAmount(agentToEdit.buyerRebateAmount || "");
    } else {
      setBuyerRebateIncluded("no");
      setBuyerRebateAmount("");
    }

    // Scroll form into view for editing
    window.requestAnimationFrame(() => {
      const formEl = document.getElementById("agent-commission-form");
      if (formEl) formEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleDeleteRow = (index) => {
    if (index == null || index < 0 || index >= agents.length) return;
    setDeletingIndex(index);
    setShowDeleteModal(true);
  };

  const handleUpdateAgent = (e) => {
    e.preventDefault();

    // Validate mandatory fields
    if (!validateForm()) {
      return;
    }

    // Store the agent data and show buyer rebate popup for update
    setPendingAgent(agent);
    setShowBuyerRebateModal(true);
  };

  const handleBuyerRebateSubmit = () => {
    if (!pendingAgent && pendingAgentsToAdd.length === 0) return;

    // When adding both LISTING and SELLING for AGENT DOUBLE ENDER (pendingAgentsToAdd has 2)
    if (pendingAgentsToAdd.length > 0) {
      let agentsToAdd = [...pendingAgentsToAdd];
      // Apply buyer rebate only to the SELLING agent
      const sellingIdx = agentsToAdd.findIndex(
        (a) => a.transactionType === "SELLING",
      );
      if (
        sellingIdx >= 0 &&
        buyerRebateIncluded === "yes" &&
        buyerRebateAmount
      ) {
        const sellingAgent = agentsToAdd[sellingIdx];
        const rebateAmount = parseFloat(buyerRebateAmount) || 0;
        const totalFees = parseFloat(sellingAgent.totalFees) || 0;
        const finalTotal = parseFloat(sellingAgent.total) || 0;
        const finalNetCommission = roundTo2(
          finalTotal - totalFees - rebateAmount,
        );
        agentsToAdd[sellingIdx] = {
          ...sellingAgent,
          netCommission: roundTo2Str(finalNetCommission),
          buyerRebateIncluded: "yes",
          buyerRebateAmount: buyerRebateAmount,
        };
      } else if (sellingIdx >= 0 && buyerRebateIncluded === "yes") {
        agentsToAdd[sellingIdx] = {
          ...agentsToAdd[sellingIdx],
          buyerRebateIncluded: "yes",
          buyerRebateAmount: buyerRebateAmount || "",
        };
      }

      const newAgents = [...agents, ...agentsToAdd];
      setAgents(newAgents);
      setPendingAgentsToAdd([]);
      setPendingAgent(null);

      // Reset form for next agent (keep classification)
      setAgent({
        ...initialAgent,
        classification: agent.classification,
        transactionType: "LISTING",
        agentId: "",
        agentName: "",
      });
      setShowBuyerRebateModal(false);
      setBuyerRebateIncluded("no");
      setBuyerRebateAmount("");
      setSelectedListingAgentIndex(0);
      return;
    }

    if (!pendingAgent) return;

    // Calculate the new amounts based on buyer rebate logic (single agent)
    let finalAmount = parseFloat(pendingAgent.amount) || 0;
    let finalTax = parseFloat(pendingAgent.tax) || 0;
    let finalTotal = parseFloat(pendingAgent.total) || 0;
    let finalNetCommission = parseFloat(pendingAgent.netCommission) || 0;

    if (buyerRebateIncluded === "yes" && buyerRebateAmount) {
      const rebateAmount = parseFloat(buyerRebateAmount) || 0;
      const totalFees = parseFloat(pendingAgent.totalFees) || 0;
      // Keep award amount, tax, and total unchanged; rebate only reduces net payout
      finalNetCommission = roundTo2(finalTotal - totalFees - rebateAmount);
    }

    const agentWithRebate = {
      ...pendingAgent,
      amount: roundTo2Str(finalAmount),
      total: roundTo2Str(finalTotal),
      netCommission: roundTo2Str(finalNetCommission),
      buyerRebateIncluded: buyerRebateIncluded,
      buyerRebateAmount: buyerRebateIncluded === "yes" ? buyerRebateAmount : "",
    };

    if (editingIndex !== null) {
      // Update existing agent
      const updatedAgents = [...agents];
      updatedAgents[editingIndex] = agentWithRebate;
      setAgents(updatedAgents);
      setEditingIndex(null);
    } else {
      // Add new agent
      const newAgents = [...agents, agentWithRebate];
      setAgents(newAgents);

      // Next agent default % = 100 − sum(every added agent on this side)
      if (
        agentWithRebate.classification === "LISTING SIDE" ||
        agentWithRebate.classification === "CO-OPERATING SIDE"
      ) {
        const totalPct = newAgents.reduce(
          (sum, a) => sum + (parseFloat(a.percentage) || 0),
          0,
        );
        const remainingPercentage = Math.max(0, 100 - totalPct);
        setAgent((prev) => ({
          ...prev,
          percentage: remainingPercentage.toString(),
        }));
      }
    }

    // Determine next transaction type for AGENT DOUBLE ENDER
    let nextTransactionType = "";
    if (classification === "AGENT DOUBLE ENDER") {
      // Check existing agents including the one we just added
      const updatedAgentsList =
        editingIndex !== null ? agents : [...agents, agentWithRebate];

      const hasListing = updatedAgentsList.some(
        (a) =>
          a.classification === "AGENT DOUBLE ENDER" &&
          a.transactionType === "LISTING" &&
          a.agentId === agentWithRebate.agentId,
      );
      const hasSelling = updatedAgentsList.some(
        (a) =>
          a.classification === "AGENT DOUBLE ENDER" &&
          a.transactionType === "SELLING" &&
          a.agentId === agentWithRebate.agentId,
      );

      if (agentWithRebate.transactionType === "LISTING" && !hasSelling) {
        nextTransactionType = "SELLING";
      } else if (agentWithRebate.transactionType === "SELLING" && !hasListing) {
        nextTransactionType = "LISTING";
      } else {
        // Both transactions added, allow user to select or start fresh
        nextTransactionType = "LISTING";
      }
    }

    setAgent({
      ...initialAgent,
      classification: agent.classification, // Preserve classification
      transactionType: nextTransactionType, // Set next transaction type for AGENT DOUBLE ENDER
      agentId:
        classification === "AGENT DOUBLE ENDER" ? agentWithRebate.agentId : "", // Keep agent ID for AGENT DOUBLE ENDER to allow second transaction
      agentName:
        classification === "AGENT DOUBLE ENDER"
          ? agentWithRebate.agentName
          : "", // Keep agent name for AGENT DOUBLE ENDER
    });
    setSelectedListingAgentIndex(0); // Reset to first available agent

    // Recalculate award amount for the next agent
    if (classification && commissionData) {
      let calculatedAwardAmount = "0.00";
      if (classification === "LISTING SIDE") {
        const listingAmount = parseFloat(commissionData.listingAmount) || 0;
        calculatedAwardAmount = listingAmount.toFixed(2);
      } else if (classification === "SELLING SIDE") {
        const sellingAmount = parseFloat(commissionData.sellingAmount) || 0;
        calculatedAwardAmount = sellingAmount.toFixed(2);
      } else if (classification === "CO-OPERATING SIDE") {
        const sellingAmount = parseFloat(commissionData.sellingAmount) || 0;
        calculatedAwardAmount = sellingAmount.toFixed(2);
      } else if (classification === "AGENT DOUBLE ENDER") {
        // Set award amount based on next transaction type
        if (nextTransactionType === "LISTING") {
          const listingAmount = parseFloat(commissionData.listingAmount) || 0;
          calculatedAwardAmount = listingAmount.toFixed(2);
        } else if (nextTransactionType === "SELLING") {
          const sellingAmount = parseFloat(commissionData.sellingAmount) || 0;
          calculatedAwardAmount = sellingAmount.toFixed(2);
        }
      }

      setAgent((prev) => ({
        ...prev,
        awardAmount: calculatedAwardAmount,
        transactionType: nextTransactionType, // Also set transaction type
      }));
    }

    // Reset popup state
    setShowBuyerRebateModal(false);
    setBuyerRebateIncluded("no");
    setBuyerRebateAmount("");
    setPendingAgent(null);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setAgent({
      ...initialAgent,
      classification: agent.classification, // Preserve classification
    });

    // Reset selected listing agent index to show available agents
    setSelectedListingAgentIndex(0);

    // Recalculate award amount after canceling edit
    if (classification && commissionData) {
      let calculatedAwardAmount = "0.00";
      if (classification === "LISTING SIDE") {
        const listingAmount = parseFloat(commissionData.listingAmount) || 0;
        calculatedAwardAmount = listingAmount.toFixed(2);
      } else if (classification === "SELLING SIDE") {
        const sellingAmount = parseFloat(commissionData.sellingAmount) || 0;
        calculatedAwardAmount = sellingAmount.toFixed(2);
      } else if (classification === "CO-OPERATING SIDE") {
        const sellingAmount = parseFloat(commissionData.sellingAmount) || 0;
        calculatedAwardAmount = sellingAmount.toFixed(2);
      }

      setAgent((prev) => ({
        ...prev,
        awardAmount: calculatedAwardAmount,
      }));
    }

    // Auto-populate agent information from selected listing if available
    if (
      selectedListing &&
      (classification === "LISTING SIDE" ||
        classification === "AGENT DOUBLE ENDER")
    ) {
      const availableAgents = getAvailableListingAgents();
      if (availableAgents.length > 0) {
        const firstAvailableAgent = availableAgents[0];
        const agentId = firstAvailableAgent.agentNo?.toString() || "";
        const agentName = `${firstAvailableAgent.firstName || ""} ${
          firstAvailableAgent.lastName || ""
        }`.trim();

        if (agentId && agentName) {
          setAgent((prev) => ({
            ...prev,
            agentId: agentId,
            agentName: agentName,
          }));
        }
      }
    }

    setBuyerRebateIncluded("no");
    setBuyerRebateAmount("");
    setValidationErrors({});
  };

  const handleDelete = () => {
    if (agents.length === 0) return;
    setDeletingIndex(0);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = () => {
    if (deletingIndex !== null) {
      const updatedAgents = agents.filter(
        (_, index) => index !== deletingIndex,
      );
      setAgents(updatedAgents);

      // Reset the form and recalculate award amount after deletion
      setAgent({
        ...initialAgent,
        classification: agent.classification, // Preserve classification
        alreadyAdded: false, // Reset the alreadyAdded flag
      });

      // Reset selected listing agent index to show available agents
      setSelectedListingAgentIndex(0);

      // Trigger award amount recalculation
      if (classification && commissionData) {
        let calculatedAwardAmount = "0.00";
        if (classification === "LISTING SIDE") {
          const listingAmount = parseFloat(commissionData.listingAmount) || 0;
          calculatedAwardAmount = listingAmount.toFixed(2);
        } else if (classification === "SELLING SIDE") {
          const sellingAmount = parseFloat(commissionData.sellingAmount) || 0;
          calculatedAwardAmount = sellingAmount.toFixed(2);
        } else if (classification === "CO-OPERATING SIDE") {
          const sellingAmount = parseFloat(commissionData.sellingAmount) || 0;
          calculatedAwardAmount = sellingAmount.toFixed(2);
        }

        setAgent((prev) => ({
          ...prev,
          awardAmount: calculatedAwardAmount,
        }));
      }

      // Auto-populate agent information from selected listing if available
      if (
        selectedListing &&
        (classification === "LISTING SIDE" ||
          classification === "AGENT DOUBLE ENDER")
      ) {
        const availableAgents = getAvailableListingAgents();
        if (availableAgents.length > 0) {
          const firstAvailableAgent = availableAgents[0];
          const agentId = firstAvailableAgent.agentNo?.toString() || "";
          const agentName = `${firstAvailableAgent.firstName || ""} ${
            firstAvailableAgent.lastName || ""
          }`.trim();

          if (agentId && agentName) {
            // Calculate award amount for auto-population
            let calculatedAwardAmount = "0.00";
            if (classification === "LISTING SIDE") {
              const listingAmount =
                parseFloat(commissionData.listingAmount) || 0;
              calculatedAwardAmount = listingAmount.toFixed(2);
            } else if (classification === "SELLING SIDE") {
              const sellingAmount =
                parseFloat(commissionData.sellingAmount) || 0;
              calculatedAwardAmount = sellingAmount.toFixed(2);
            } else if (classification === "CO-OPERATING SIDE") {
              const sellingAmount =
                parseFloat(commissionData.sellingAmount) || 0;
              calculatedAwardAmount = sellingAmount.toFixed(2);
            } else if (classification === "AGENT DOUBLE ENDER") {
              // Default to listing amount for AGENT DOUBLE ENDER after deletion
              const listingAmount =
                parseFloat(commissionData.listingAmount) || 0;
              calculatedAwardAmount = listingAmount.toFixed(2);
            }

            setAgent((prev) => ({
              ...prev,
              agentId: agentId,
              agentName: agentName,
              awardAmount: calculatedAwardAmount,
            }));
          }
        }
      }
    }
    setShowDeleteModal(false);
    setDeletingIndex(null);
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setDeletingIndex(null);
  };

  // Sale Closing Info Handlers (for table only)
  const handleSaleClosingChange = (e) => {
    const { name, value } = e.target;
    setSaleClosing((prev) => ({ ...prev, [name]: value }));
  };
  const handleAddSaleClosing = (e) => {
    e.preventDefault();
    setSaleClosingRows([...saleClosingRows, saleClosing]);
    setSaleClosing(initialSaleClosing);
  };

  const handleSaveTradeClick = async () => {
    // Prevent multiple clicks if already saving or trade is already saved
    if (isSaving || isTradeSaved) {
      return;
    }

    console.log(
      "Attempting to save trade. Current list of added agents:",
      agents,
    );

    // Check if the form has data for a new agent that hasn't been added yet.
    const isDirty =
      agent.agentName !== "" &&
      agent.agentId !== "" &&
      editingIndex === null &&
      !agent.alreadyAdded;

    if (isDirty) {
      console.log("Unsaved agent form data detected:", agent);
      alert(
        "You have unsaved agent information in the form. Please click 'Add Agent' to add it to the list before saving the entire trade.",
      );
      return;
    }

    try {
      setIsSaving(true);
      await onSaveTrade();
      setIsTradeSaved(true);
      toast.success("Trade saved successfully!");
    } catch (error) {
      console.error("Error saving trade:", error);
      toast.error("Failed to save trade. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-2">Agent Commission Information</h2>
      <p className="text-sm text-gray-600 mb-4">
        Applied tax rate: <strong>{Math.round(taxRate * 100)}%</strong>
        {taxRate !== DEFAULT_TAX_RATE && (
          <span className="ml-2 text-blue-600">(custom)</span>
        )}
      </p>
      <form
        id="agent-commission-form"
        className="mb-6"
        onSubmit={editingIndex !== null ? handleUpdateAgent : handleAddAgent}
      >
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Agent <span className="text-red-500">*</span>
            </label>
            {agent.classification === "CO-OPERATING SIDE" &&
            getAvailableCoOperatingAgents().length > 0 ? (
              // Dropdown for CO-OPERATING SIDE with available agents
              <select
                name="agentSelect"
                value={
                  agentList.find((a) => a.employeeNo === agent.agentId)?._id ||
                  ""
                }
                onChange={handleAgentSelect}
                className={`block w-full rounded-md shadow-sm focus:border-blue-700 focus:ring-blue-700 mb-1 ${
                  validationErrors.agentId
                    ? "border-red-500"
                    : "border-gray-300"
                }`}
              >
                <option value="">Select an agent</option>
                {getAvailableCoOperatingAgents().map((agentItem) => (
                  <option key={agentItem._id} value={agentItem._id}>
                    {agentItem.employeeNo} - {agentItem.firstName}{" "}
                    {agentItem.lastName}
                  </option>
                ))}
              </select>
            ) : agent.classification === "CO-OPERATING SIDE" &&
              getAvailableCoOperatingAgents().length === 0 ? (
              // Empty text inputs when all CO-OPERATING SIDE agents have been added
              <>
                <input
                  name="agentId"
                  value=""
                  onChange={handleAgentInputChange}
                  placeholder="ID"
                  className="block w-full rounded-md shadow-sm focus:border-blue-700 focus:ring-blue-700 mb-1 border-gray-300"
                  readOnly
                />
                <input
                  name="agentName"
                  value=""
                  onChange={handleAgentInputChange}
                  placeholder="Agent Name"
                  className="block w-full rounded-md shadow-sm focus:border-blue-700 focus:ring-blue-700 border-gray-300"
                  readOnly
                />
              </>
            ) : agent.classification === "CO-OPERATING SIDE" ? (
              // Fallback dropdown for CO-OPERATING SIDE (should not reach here normally)
              <select
                name="agentSelect"
                value={
                  agentList.find((a) => a.employeeNo === agent.agentId)?._id ||
                  ""
                }
                onChange={handleAgentSelect}
                className={`block w-full rounded-md shadow-sm focus:border-blue-700 focus:ring-blue-700 mb-1 ${
                  validationErrors.agentId
                    ? "border-red-500"
                    : "border-gray-300"
                }`}
              >
                <option value="">Select an agent</option>
                {agentList.map((agentItem) => (
                  <option key={agentItem._id} value={agentItem._id}>
                    {agentItem.employeeNo} - {agentItem.firstName}{" "}
                    {agentItem.lastName}
                  </option>
                ))}
              </select>
            ) : (agent.classification === "LISTING SIDE" ||
                agent.classification === "AGENT DOUBLE ENDER") &&
              selectedListing &&
              selectedListing.agents &&
              selectedListing.agents.length > 1 &&
              getAvailableListingAgents().length > 0 ? (
              // Dropdown for LISTING SIDE or AGENT DOUBLE ENDER when there are available agents
              <select
                name="listingAgentSelect"
                value={selectedListingAgentIndex}
                onChange={handleListingAgentSelect}
                className={`block w-full rounded-md shadow-sm focus:border-blue-700 focus:ring-blue-700 mb-1 ${
                  validationErrors.agentId
                    ? "border-red-500"
                    : "border-gray-300"
                }`}
              >
                <option value="">Select an agent</option>
                {getAvailableListingAgents().map((agentItem, index) => (
                  <option key={index} value={index}>
                    {agentItem.agentNo} - {agentItem.firstName}{" "}
                    {agentItem.lastName}
                  </option>
                ))}
              </select>
            ) : (agent.classification === "LISTING SIDE" ||
                agent.classification === "AGENT DOUBLE ENDER") &&
              selectedListing &&
              selectedListing.agents &&
              selectedListing.agents.length > 1 &&
              getAvailableListingAgents().length === 0 ? (
              // Empty text inputs when all agents have been added
              <>
                <input
                  name="agentId"
                  value=""
                  onChange={handleAgentInputChange}
                  placeholder="ID"
                  className="block w-full rounded-md shadow-sm focus:border-blue-700 focus:ring-blue-700 mb-1 border-gray-300"
                  readOnly
                />
                <input
                  name="agentName"
                  value=""
                  onChange={handleAgentInputChange}
                  placeholder="Agent Name"
                  className="block w-full rounded-md shadow-sm focus:border-blue-700 focus:ring-blue-700 border-gray-300"
                  readOnly
                />
              </>
            ) : (
              // Text inputs for other classifications or single agent listings
              <>
                <input
                  name="agentId"
                  value={agent.agentId}
                  onChange={handleAgentInputChange}
                  placeholder="ID"
                  className={`block w-full rounded-md shadow-sm focus:border-blue-700 focus:ring-blue-700 mb-1 ${
                    validationErrors.agentId
                      ? "border-red-500"
                      : "border-gray-300"
                  }`}
                  readOnly={
                    agent.classification === "LISTING SIDE" ||
                    agent.classification === "AGENT DOUBLE ENDER"
                  }
                />
                <input
                  name="agentName"
                  value={agent.agentName}
                  onChange={handleAgentInputChange}
                  placeholder="Agent Name"
                  className={`block w-full rounded-md shadow-sm focus:border-blue-700 focus:ring-blue-700 ${
                    validationErrors.agentName
                      ? "border-red-500"
                      : "border-gray-300"
                  }`}
                  readOnly={
                    agent.classification === "LISTING SIDE" ||
                    agent.classification === "AGENT DOUBLE ENDER"
                  }
                />
              </>
            )}
            {(agent.classification === "LISTING SIDE" ||
              agent.classification === "AGENT DOUBLE ENDER") &&
              selectedListing &&
              selectedListing.agents &&
              selectedListing.agents.length > 1 &&
              getAvailableListingAgents().length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Select from remaining listing agents
                </p>
              )}
            {(agent.classification === "LISTING SIDE" ||
              agent.classification === "AGENT DOUBLE ENDER") &&
              selectedListing &&
              selectedListing.agents &&
              selectedListing.agents.length > 1 &&
              getAvailableListingAgents().length === 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  All listing agents have been added
                </p>
              )}
            {(agent.classification === "LISTING SIDE" ||
              agent.classification === "AGENT DOUBLE ENDER") &&
              (!selectedListing ||
                !selectedListing.agents ||
                selectedListing.agents.length <= 1) && (
                <p className="text-xs text-gray-500 mt-1">
                  Auto-populated from listing agent information
                </p>
              )}
            {agent.classification === "CO-OPERATING SIDE" &&
              getAvailableCoOperatingAgents().length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Select from remaining co-operating agents
                </p>
              )}
            {agent.classification === "CO-OPERATING SIDE" &&
              getAvailableCoOperatingAgents().length === 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  All co-operating agents have been added
                </p>
              )}
            {agent.classification === "AGENT DOUBLE ENDER" &&
              agent.agentId &&
              (() => {
                const idStr = String(agent.agentId || "").trim();
                const hasListing = agents.some(
                  (a, idx) =>
                    (editingIndex === null || idx !== editingIndex) &&
                    String(a.agentId || "").trim() === idStr &&
                    a.classification === "AGENT DOUBLE ENDER" &&
                    a.transactionType === "LISTING",
                );
                const hasSelling = agents.some(
                  (a, idx) =>
                    (editingIndex === null || idx !== editingIndex) &&
                    String(a.agentId || "").trim() === idStr &&
                    a.classification === "AGENT DOUBLE ENDER" &&
                    a.transactionType === "SELLING",
                );
                if (editingIndex !== null) {
                  return (
                    <p className="text-xs text-blue-600 mt-1 font-medium">
                      Editing this{" "}
                      {(agent.transactionType || "LISTING") === "SELLING"
                        ? "Selling"
                        : "Listing"}{" "}
                      side entry — click Update Agent to save changes.
                    </p>
                  );
                }
                if (agent.transactionType === "LISTING" && hasListing) {
                  return (
                    <p className="text-xs text-red-500 mt-1 font-medium">
                      This agent with Listing transaction type has already been
                      added
                    </p>
                  );
                }
                if (agent.transactionType === "SELLING" && hasSelling) {
                  return (
                    <p className="text-xs text-red-500 mt-1 font-medium">
                      This agent with Selling transaction type has already been
                      added
                    </p>
                  );
                }
                if (hasListing && hasSelling) {
                  return (
                    <p className="text-xs text-orange-500 mt-1 font-medium">
                      Both transactions for this agent have been added
                    </p>
                  );
                }
                if (
                  hasListing &&
                  !hasSelling &&
                  agent.transactionType !== "SELLING"
                ) {
                  return (
                    <p className="text-xs text-blue-500 mt-1">
                      Listing transaction added. You can add Selling transaction
                      for this agent.
                    </p>
                  );
                }
                if (
                  hasSelling &&
                  !hasListing &&
                  agent.transactionType !== "LISTING"
                ) {
                  return (
                    <p className="text-xs text-blue-500 mt-1">
                      Selling transaction added. You can add Listing transaction
                      for this agent.
                    </p>
                  );
                }
                return null;
              })()}
            {agent.classification !== "AGENT DOUBLE ENDER" &&
              agent.alreadyAdded && (
                <p className="text-xs text-red-500 mt-1 font-medium">
                  This agent has already been added to the list
                </p>
              )}
            {validationErrors.agentId && (
              <p className="text-red-500 text-xs mt-1">
                {validationErrors.agentId}
              </p>
            )}
            {validationErrors.agentName && (
              <p className="text-red-500 text-xs mt-1">
                {validationErrors.agentName}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Classification
            </label>
            <div className="flex items-center gap-2">
              <input
                name="classification"
                value={isReferral ? "Referral" : agent.classification}
                readOnly
                className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm focus:border-blue-700 focus:ring-blue-700"
              />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={isReferral}
                  disabled={agent.classification === "Referral"}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) {
                      feeInfoBeforeReferralRef.current =
                        agent.feeInfo && agent.feeInfo !== "referralBroker"
                          ? agent.feeInfo
                          : feeInfoBeforeReferralRef.current;
                      setIsReferral(true);
                      setAgent((prev) =>
                        calculateFees({
                          ...prev,
                          feeInfo: "referralBroker",
                          feesDeducted: "0.00",
                        }),
                      );
                    } else {
                      setIsReferral(false);
                      const restore =
                        feeInfoBeforeReferralRef.current &&
                        feeInfoBeforeReferralRef.current !== "referralBroker"
                          ? feeInfoBeforeReferralRef.current
                          : "plan500";
                      feeInfoBeforeReferralRef.current = null;
                      setAgent((prev) =>
                        calculateFees({ ...prev, feeInfo: restore }),
                      );
                    }
                  }}
                  className="rounded border-gray-300"
                />
                Referral
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {isReferral
                ? "Referral shows in Agent Info table; on Trade Details Sheet appears under Outside Brokers (GL 51100)"
                : "Automatically populated from Key Info Form"}
            </p>
          </div>
          {agent.classification === "AGENT DOUBLE ENDER" && !isReferral && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Side <span className="text-red-500">*</span>
              </label>
              <select
                name="transactionType"
                value={agent.transactionType || "LISTING"}
                onChange={handleAgentInputChange}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700"
              >
                <option value="LISTING">Listing</option>
                <option value="SELLING">Selling</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Post listing and selling separately. Pick a side, set or
                override Amount, then Add Agent.
              </p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lead
            </label>
            <select
              name="lead"
              value={agent.lead}
              onChange={handleAgentInputChange}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700"
            >
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              YTD Commission
            </label>
            <select
              name="ytdCommission"
              value={agent.ytdCommission}
              onChange={handleAgentInputChange}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700"
            >
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fee Info
            </label>
            <select
              name="feeInfo"
              value={isReferral ? "referralBroker" : agent.feeInfo}
              onChange={handleAgentInputChange}
              disabled={isReferral}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {feePlans.map((plan) => (
                <option key={plan.value} value={plan.value}>
                  {plan.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Award Amount
            </label>
            <input
              name="awardAmount"
              value={agent.awardAmount}
              onChange={handleAgentInputChange}
              className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 ${
                agent.classification === "AGENT DOUBLE ENDER" ? "" : "bg-gray-100"
              }`}
              readOnly={agent.classification !== "AGENT DOUBLE ENDER"}
            />
            <p className="text-xs text-gray-500 mt-1">
              {agent.classification === "AGENT DOUBLE ENDER"
                ? agent.transactionType === "SELLING"
                  ? "Defaults to Commission Income selling amount — editable for this side"
                  : "Defaults to Commission Income listing amount — editable for this side"
                : "Auto-calculated from Commission Income selling amount"}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Percentage
            </label>
            <input
              name="percentage"
              value={agent.percentage}
              onChange={handleAgentInputChange}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700"
            />
            <p className="text-xs text-gray-500 mt-1">
              {agent.classification === "AGENT DOUBLE ENDER"
                ? "Auto-updates to 2 decimals when you enter Amount (Amount ÷ Award × 100)."
                : "Share of award amount"}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount
            </label>
            <input
              name="amount"
              value={agent.amount}
              onChange={handleAgentInputChange}
              onBlur={handleAdeAmountBlur}
              readOnly={agent.classification !== "AGENT DOUBLE ENDER"}
              className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 ${
                agent.classification !== "AGENT DOUBLE ENDER" ? "bg-gray-100" : ""
              } ${validationErrors.amount ? "border-red-500" : ""}`}
            />
            <p className="text-xs text-gray-500 mt-1">
              {agent.classification === "AGENT DOUBLE ENDER"
                ? `Cannot exceed ${
                    (agent.transactionType || "LISTING") === "SELLING"
                      ? "selling"
                      : "listing"
                  } commission ($${(
                    ((agent.transactionType || "LISTING") === "SELLING"
                      ? parseFloat(commissionData?.sellingAmount)
                      : parseFloat(commissionData?.listingAmount)) || 0
                  ).toFixed(2)}). Enter amount to set percentage (2 decimals).`
                : "Award × Percentage"}
            </p>
            {validationErrors.amount && (
              <p className="text-red-500 text-xs mt-1">
                {validationErrors.amount}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tax
            </label>
            <label className="flex items-center gap-2 mb-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={!!agent.taxOverridden}
                onChange={(e) => {
                  const on = e.target.checked;
                  setAgent((prev) =>
                    calculateFees({ ...prev, taxOverridden: on }),
                  );
                }}
                className="rounded border-gray-300"
              />
              Override commission HST
            </label>
            <input
              name="tax"
              value={agent.tax}
              onChange={handleAgentInputChange}
              readOnly={!agent.taxOverridden}
              className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 ${
                agent.taxOverridden ? "" : "bg-gray-100"
              }`}
            />
            {agent.taxOverridden ? (
              <p className="text-xs text-gray-500 mt-1">
                Standard HST on commission (Amount × {Math.round(taxRate * 100)}
                %) is included in <strong>Total Fees</strong> (office share).
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-1">
                HST on commission (Amount × {Math.round(taxRate * 100)}%).
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Total
            </label>
            <input
              name="total"
              value={agent.total}
              readOnly
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 bg-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fees Deducted
            </label>
            <input
              name="feesDeducted"
              value={agent.feesDeducted}
              onChange={handleAgentInputChange}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700"
              readOnly={agent.feeInfo !== "flexible" || isReferral}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Total Fees
            </label>
            <input
              name="totalFees"
              value={agent.totalFees}
              readOnly
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 bg-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Net Commission
            </label>
            <input
              name="netCommission"
              value={agent.netCommission}
              readOnly
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 bg-gray-100"
            />
          </div>
        </div>

        <div className="mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3">
            <input
              type="checkbox"
              checked={!!agent.officeExpensesEnabled}
              onChange={(e) => handleOfficeExpenseToggle(e.target.checked)}
              className="rounded border-gray-300"
            />
            Office Expenses
          </label>

          {agent.officeExpensesEnabled && (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <label className="text-sm font-medium text-gray-700">
                  Tax rate (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={agent.officeExpenseTaxRate ?? 13}
                  onChange={(e) => handleOfficeTaxRateChange(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-1.5 w-24 text-sm"
                />
                <span className="text-sm text-gray-500">
                  Applied to each selected expense (default 13%). Not applied to
                  bank charge or garnishment.
                </span>
              </div>

              <div className="space-y-2">
                {EXPENSE_FIELDS.map((field) => {
                  const selected = !!agent.officeExpenseSelected?.[field.key];
                  const amountVal = agent.officeExpenseAmounts?.[field.key] ?? "";
                  const base = roundMoney(amountVal || 0);
                  const ratePct = Number(agent.officeExpenseTaxRate ?? 13);
                  const rate =
                    ratePct > 1 ? ratePct / 100 : Number.isFinite(ratePct) ? ratePct : 0.13;
                  const lineHst =
                    selected && base > 0 && field.taxable
                      ? roundMoney(base * rate)
                      : 0;
                  const lineTotal = roundMoney(base + lineHst);
                  const balanceIncl = roundMoney(
                    agent.officeExpenseBalances?.[field.key] || 0,
                  );
                  return (
                    <div
                      key={field.key}
                      className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center"
                    >
                      <label className="md:col-span-3 flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) =>
                            handleOfficeLineSelect(field.key, e.target.checked)
                          }
                          className="rounded border-gray-300"
                        />
                        {field.label}
                        {!field.taxable && (
                          <span className="text-xs text-gray-500">(no tax)</span>
                        )}
                      </label>
                      <div className="md:col-span-4 flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Amount"
                          disabled={!selected}
                          value={selected ? amountVal : ""}
                          onChange={(e) =>
                            handleOfficeLineAmount(field.key, e.target.value)
                          }
                          className={`border border-gray-300 rounded-md px-3 py-1.5 w-full text-sm ${
                            selected ? "bg-white" : "bg-gray-100"
                          }`}
                        />
                        {selected && base > 0 && field.taxable && (
                          <span className="text-xs text-gray-600 whitespace-nowrap">
                            + tax {formatMoney(lineHst)} ={" "}
                            {formatMoney(lineTotal)}
                          </span>
                        )}
                      </div>
                      <div className="md:col-span-5 text-xs text-gray-500">
                        {balanceIncl > 0
                          ? `Balance remaining ${formatMoney(balanceIncl)}`
                          : "No posted balance"}
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-sm font-medium text-gray-800 mt-3">
                Office expenses total (incl. tax, added to office share):{" "}
                {formatMoney(agent.officeExpensesTotal || 0)}
              </p>
            </>
          )}
        </div>

        <div className="flex justify-end space-x-3">
          {editingIndex !== null && (
            <button
              type="button"
              onClick={handleCancelEdit}
              className="px-6 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className={`px-6 py-2 rounded font-semibold ${
              classification === "AGENT DOUBLE ENDER" &&
              isAgentAlreadyAdded(
                agent.agentId,
                agent.classification,
                agent.transactionType,
              )
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : classification !== "AGENT DOUBLE ENDER" && agent.alreadyAdded
                  ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                  : "bg-blue-900 text-white"
            }`}
            disabled={
              classification === "AGENT DOUBLE ENDER"
                ? isAgentAlreadyAdded(
                    agent.agentId,
                    agent.classification,
                    agent.transactionType,
                  )
                : agent.alreadyAdded
            }
          >
            {editingIndex !== null
              ? "Update Agent"
              : classification === "AGENT DOUBLE ENDER" &&
                  isAgentAlreadyAdded(
                    agent.agentId,
                    agent.classification,
                    agent.transactionType,
                  )
                ? "Agent Side Already Added"
                : classification !== "AGENT DOUBLE ENDER" && agent.alreadyAdded
                  ? "Agent Already Added"
                  : classification === "AGENT DOUBLE ENDER"
                    ? `Add ${
                        (agent.transactionType || "LISTING") === "SELLING"
                          ? "Selling"
                          : "Listing"
                      } Side`
                    : "Add Agent"}
          </button>
        </div>
      </form>

      {/* Buyer Rebate Modal */}
      {showBuyerRebateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              Buyer Rebate Confirmation
            </h3>
            <p className="mb-4">Is buyer rebate included in this commission?</p>

            <div className="mb-4">
              <label className="flex items-center mb-2">
                <input
                  type="radio"
                  name="buyerRebateIncluded"
                  value="yes"
                  checked={buyerRebateIncluded === "yes"}
                  onChange={(e) => setBuyerRebateIncluded(e.target.value)}
                  className="mr-2"
                />
                Yes
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="buyerRebateIncluded"
                  value="no"
                  checked={buyerRebateIncluded === "no"}
                  onChange={(e) => setBuyerRebateIncluded(e.target.value)}
                  className="mr-2"
                />
                No
              </label>
            </div>

            {buyerRebateIncluded === "yes" && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Buyer Rebate Amount
                </label>
                <input
                  type="number"
                  value={buyerRebateAmount}
                  onChange={(e) => setBuyerRebateAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700"
                />
              </div>
            )}

            {buyerRebateIncluded === "yes" && buyerRebateAmount && (
              <div className="mb-4 p-3 bg-gray-100 rounded">
                <p className="text-sm">
                  <strong>Original Net Commission:</strong> $
                  {pendingAgent?.netCommission}
                  <br />
                  <strong>Buyer Rebate:</strong> ${buyerRebateAmount}
                  <br />
                  <strong>Final Net Commission:</strong> $
                  {(
                    parseFloat(pendingAgent?.netCommission || 0) -
                    parseFloat(buyerRebateAmount || 0)
                  ).toFixed(2)}
                </p>
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={handleCancelBuyerRebate}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBuyerRebateSubmit}
                className="px-4 py-2 bg-blue-900 text-white rounded hover:bg-blue-800"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Delete Confirmation</h3>
            <p className="mb-4">
              Are you sure you want to delete this agent commission record?
            </p>
            <p className="mb-6 text-sm text-gray-600">
              Agent: {agents[deletingIndex]?.agentName}
              {agents[deletingIndex]?.transactionType
                ? ` (${agents[deletingIndex].transactionType})`
                : ""}
              <br />
              This action cannot be undone.
            </p>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={handleCancelDelete}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <h3 className="font-semibold text-lg mb-2">Agents List</h3>
      <div className="overflow-x-auto mb-8">
        <table className="min-w-full border border-gray-300">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-4 py-2 border-b border-r text-left">Agent</th>
              <th className="px-4 py-2 border-b border-r text-left">
                Classification
              </th>
              {classification === "AGENT DOUBLE ENDER" && (
                <th className="px-4 py-2 border-b border-r text-left">
                  Transaction Type
                </th>
              )}
              <th className="px-4 py-2 border-b border-r text-left">Lead</th>
              <th className="px-4 py-2 border-b border-r text-left">Amount</th>
              <th className="px-4 py-2 border-b border-r text-left">Tax</th>
              <th className="px-4 py-2 border-b border-r text-left">Total</th>
              <th className="px-4 py-2 border-b border-r text-left">Fees</th>
              <th className="px-4 py-2 border-b border-r text-left">Net</th>
              <th className="px-4 py-2 border-b border-r text-left">
                Buyer Rebate
              </th>
              <th className="px-4 py-2 border-b text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr>
                <td
                  colSpan={classification === "AGENT DOUBLE ENDER" ? 11 : 10}
                  className="text-center py-4 text-gray-500"
                >
                  No agents added yet.
                </td>
              </tr>
            ) : (
              agents.map((a, idx) => (
                <tr
                  key={idx}
                  className={
                    editingIndex === idx ? "bg-blue-50" : undefined
                  }
                >
                  <td className="px-4 py-2 border-b border-r">{a.agentName}</td>
                  <td className="px-4 py-2 border-b border-r">
                    {a.classification}
                  </td>
                  {classification === "AGENT DOUBLE ENDER" && (
                    <td className="px-4 py-2 border-b border-r">
                      {a.transactionType || "-"}
                    </td>
                  )}
                  <td className="px-4 py-2 border-b border-r">{a.lead}</td>
                  <td className="px-4 py-2 border-b border-r">{a.amount}</td>
                  <td className="px-4 py-2 border-b border-r">{a.tax}</td>
                  <td className="px-4 py-2 border-b border-r">{a.total}</td>
                  <td className="px-4 py-2 border-b border-r">
                    {a.feesDeducted}
                  </td>
                  <td className="px-4 py-2 border-b border-r">
                    {a.netCommission}
                  </td>
                  <td className="px-4 py-2 border-b border-r">
                    {a.buyerRebateIncluded === "yes"
                      ? `$${a.buyerRebateAmount}`
                      : "-"}
                  </td>
                  <td className="px-4 py-2 border-b whitespace-nowrap">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(idx)}
                        className="px-3 py-1 text-sm text-white bg-blue-600 rounded hover:bg-blue-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(idx)}
                        className="px-3 py-1 text-sm text-white bg-red-600 rounded hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Fees Deduction Table */}
      <h3 className="font-semibold text-lg mb-2">Fees Deduction</h3>
      <div className="overflow-x-auto mb-8">
        <table className="min-w-full border border-gray-300">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-4 py-2 border-b border-r text-left">
                Fee Type
              </th>
              <th className="px-4 py-2 border-b border-r text-left">
                Deducted Fee
              </th>
              <th className="px-4 py-2 border-b text-left">Taxed</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center py-4 text-gray-500">
                  No fees deduction entries yet.
                </td>
              </tr>
            ) : (
              agents.map((a, idx) => (
                <React.Fragment key={`fees-${a.agentId || "a"}-${a.transactionType || ""}-${idx}`}>
                  {/* Fee Info Row */}
                  <tr key={`${idx}-fee`}>
                    <td className="px-4 py-2 border-b border-r">
                      {getPaymentPlanDisplayName(a.feeInfo)}
                    </td>
                    <td className="px-4 py-2 border-b border-r">
                      ${a.feesDeducted}
                    </td>
                    <td className="px-4 py-2 border-b">Yes</td>
                  </tr>
                  {EXPENSE_FIELDS.map((field) => {
                    const resolved = resolveOfficeExpenseAmounts(a);
                    const amt = roundTo2(resolved[field.key] || 0);
                    if (amt <= 0) return null;
                    return (
                      <tr key={`${idx}-${field.key}`}>
                        <td className="px-4 py-2 border-b border-r">
                          {field.label}
                        </td>
                        <td className="px-4 py-2 border-b border-r">
                          {formatMoney(amt)}
                        </td>
                        <td className="px-4 py-2 border-b">
                          {field.taxable ? "Yes" : "No"}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Buyer Rebate Row (if exists) */}
                  {a.buyerRebateIncluded === "yes" && (
                    <tr key={`${idx}-rebate`}>
                      <td className="px-4 py-2 border-b border-r">
                        Buyer Rebate
                      </td>
                      <td className="px-4 py-2 border-b border-r">
                        ${a.buyerRebateAmount}
                      </td>
                      <td className="px-4 py-2 border-b">No</td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Save Button - Only show when not in edit mode */}
      {!isEditMode && (
        <div className="flex justify-end mt-8">
          <button
            type="button"
            className={`px-6 py-2 rounded font-semibold ${
              isSaving || isTradeSaved
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : "bg-blue-900 text-white hover:bg-blue-800"
            }`}
            onClick={handleSaveTradeClick}
            disabled={isSaving || isTradeSaved}
          >
            {isSaving
              ? "Saving..."
              : isTradeSaved
                ? "Trade Saved"
                : "Save Trade"}
          </button>
        </div>
      )}
    </div>
  );
};

export default AgentCommissionInfo;
