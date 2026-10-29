import React, { useState, useEffect } from "react";
import Navbar from "./Navbar";
import FinanceSidebar from "./FinanceSidebar";
import EFTReceipt from "./EFTReceipt";
import toast from "react-hot-toast";
import {
  checkCommissionTrustEFT,
  getEFTTypeDisplayName,
  formatDate,
  getPartyNamesByDealType,
  isTradeVoided,
} from "../utils/eftUtils";
import axiosInstance from "../config/axios";
import { getTradeTaxRate, INCLUSIVE_HST_FRACTION } from "../constants/tax";
import {
  getNetToOfficeTotal,
  getOurBrokerageEftAmount,
  getTotalBuyerRebateAmount,
  isBuyerRebateIncludedYes,
} from "../utils/tradeFinancialUtils";
import { normalizeThroughDateForApi } from "../utils/agentCommissionYtd";
import { splitOfficeExpenseRecoveryForReceipt } from "../utils/agentFeeTaxSplit";

/** Filter trades by number / address; safe if trades or keyInfo is sparse. */
function filterTradesBySearchTerm(tradesList, rawSearch) {
  const q = String(rawSearch ?? "")
    .trim()
    .toLowerCase();
  if (!q) return [];
  return (tradesList || []).filter((trade) => {
    if (!trade) return false;
    const tn =
      trade.tradeNumber != null && trade.tradeNumber !== ""
        ? String(trade.tradeNumber)
        : "";
    const ki = trade.keyInfo || {};
    const parts = [
      ki.streetNumber != null && ki.streetNumber !== ""
        ? String(ki.streetNumber)
        : "",
      ki.streetName != null && ki.streetName !== ""
        ? String(ki.streetName)
        : "",
      ki.unit != null && ki.unit !== "" ? String(ki.unit) : "",
    ];
    const address = parts.join(" ").trim().toLowerCase();
    return tn.toLowerCase().includes(q) || address.includes(q);
  });
}

/** Stable key for an outside broker (must match recipient when creating EFT). Referral: "Name - Name". */
function getOutsideBrokerKey(broker) {
  if (!broker) return "";
  const name =
    broker.agentName ||
    `${broker.firstName || ""} ${broker.lastName || ""}`.trim();
  if (broker._isReferral || broker.company === "Referral") {
    return `${name} - ${name}`;
  }
  return broker.company ? `${name} - ${broker.company}` : name;
}

/** If trade has referral agents, show only referrals; else outsideBrokers + referrals. */
function getOutsideBrokersWithReferrals(trade) {
  const outsideBrokers = trade?.outsideBrokers || [];
  const referralAgents = (trade?.agentCommissionList || []).filter(
    (a) => (a.classification || "").toUpperCase() === "REFERRAL",
  );
  const referralAsBrokers = referralAgents.map((a) => {
    const parts = (a.agentName || "").trim().split(/\s+/);
    return {
      _isReferral: true,
      agentName: a.agentName || "",
      agentId: a.agentId,
      company: "Referral",
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" ") || "",
      amount: a.amount,
      netCommission: a.netCommission,
      streetNumber: a.streetNumber || "",
      streetName: a.streetName || "",
      unitNumber: a.unitNumber || "",
      province: a.province || "",
      postalCode: a.postalCode || "",
      address: a.address || "",
      email: a.email || "",
      primaryPhone: a.primaryPhone || "",
    };
  });
  if (referralAgents.length > 0) {
    return referralAsBrokers;
  }
  return [...outsideBrokers, ...referralAsBrokers];
}

function getAgentCommissionEftBreakdown(trade, agentId) {
  const empty = {
    netCommission: 0,
    netPayAmount: 0,
    agentAmountSum: 0,
    officePlanAmount: 0,
    officeExpensesAmount: 0,
    commissionDeductionAmount: 0,
    buyerRebateTotal: 0,
    preRebateGross: 0,
  };
  if (!trade || agentId == null || agentId === "") return empty;
  const aid = String(agentId).trim();
  if (!aid) return empty;

  const roundMoney = (n) => Math.round(Number(n) * 100) / 100;
  const sumOfficeSplits = (rows) =>
    rows.reduce(
      (acc, a) => {
        const split = splitOfficeExpenseRecoveryForReceipt(
          a,
          getTradeTaxRate(trade),
        );
        acc.officeExpensesAmount = roundMoney(
          acc.officeExpensesAmount + (split.officeExpensesAmount || 0),
        );
        acc.commissionDeductionAmount = roundMoney(
          acc.commissionDeductionAmount +
            (split.commissionDeductionAmount || 0),
        );
        return acc;
      },
      { officeExpensesAmount: 0, commissionDeductionAmount: 0 },
    );

  const isDouble = trade.keyInfo?.classification === "AGENT DOUBLE ENDER";
  if (isDouble) {
    const agentTransactions =
      trade.agentCommissionList?.filter(
        (a) =>
          String(a.agentId) === aid &&
          a.classification === "AGENT DOUBLE ENDER",
      ) || [];
    if (agentTransactions.length > 0) {
      const agentAmountSum = agentTransactions.reduce(
        (sum, a) => sum + parseFloat(a.amount || 0),
        0,
      );
      const officePlanAmount = agentTransactions.reduce(
        (sum, a) => sum + parseFloat(a.feesDeducted || 0),
        0,
      );
      const buyerRebateTotal = agentTransactions.reduce((sum, a) => {
        if (isBuyerRebateIncludedYes(a) && a.buyerRebateAmount) {
          return sum + (parseFloat(a.buyerRebateAmount) || 0);
        }
        return sum;
      }, 0);
      const grossNetAfterFees = roundMoney(
        agentTransactions.reduce(
          (sum, a) =>
            sum + (parseFloat(a.total || 0) - parseFloat(a.totalFees || 0)),
          0,
        ),
      );
      const preRebateGross = roundMoney(agentAmountSum);
      const netPayAmount = Math.max(
        0,
        roundMoney(grossNetAfterFees - buyerRebateTotal),
      );
      const officeSplits = sumOfficeSplits(agentTransactions);
      return {
        netCommission: netPayAmount,
        netPayAmount,
        agentAmountSum,
        officePlanAmount,
        ...officeSplits,
        buyerRebateTotal,
        preRebateGross,
      };
    }
  }
  const selectedAgent =
    trade.agentCommissionList?.find((a) => String(a.agentId) === aid) || {};
  const agentAmountSum = parseFloat(selectedAgent.amount || 0);
  const officePlanAmount = parseFloat(selectedAgent.feesDeducted || 0);
  let buyerRebateTotal = 0;
  if (
    isBuyerRebateIncludedYes(selectedAgent) &&
    selectedAgent.buyerRebateAmount
  ) {
    buyerRebateTotal = parseFloat(selectedAgent.buyerRebateAmount) || 0;
  }
  const preRebateGross = roundMoney(agentAmountSum);
  const rawTotal = selectedAgent.total;
  const rowTotal =
    rawTotal != null && rawTotal !== ""
      ? parseFloat(rawTotal) || 0
      : roundMoney(
          parseFloat(selectedAgent.amount || 0) +
            parseFloat(selectedAgent.tax || 0),
        );
  const rawTotalFees = selectedAgent.totalFees;
  const rowFees =
    rawTotalFees != null && rawTotalFees !== ""
      ? parseFloat(rawTotalFees) || 0
      : roundMoney(
          parseFloat(selectedAgent.feesDeducted || 0) *
            (1 + getTradeTaxRate(trade)),
        );
  const grossNetAfterFees = roundMoney(rowTotal - rowFees);
  const netPayAmount = Math.max(
    0,
    roundMoney(grossNetAfterFees - buyerRebateTotal),
  );
  const officeSplits = sumOfficeSplits([selectedAgent]);
  return {
    netCommission: netPayAmount,
    netPayAmount,
    agentAmountSum,
    officePlanAmount,
    ...officeSplits,
    buyerRebateTotal,
    preRebateGross,
  };
}

const CommissionTrustPayments = () => {
  const [activeSection, setActiveSection] = useState("outside-brokers");
  const [trades, setTrades] = useState([]);
  const [filteredTrades, setFilteredTrades] = useState([]);
  const [showTradeDropdown, setShowTradeDropdown] = useState(false);
  const [showDetailsForm, setShowDetailsForm] = useState(false);
  const [showEFTReceipt, setShowEFTReceipt] = useState(false);
  const [eftNumber, setEftNumber] = useState(null);
  const [eftReceiptData, setEftReceiptData] = useState(null);
  const [isOurBrokerageEFT, setIsOurBrokerageEFT] = useState(false);

  // Add state to track EFT creation status
  // For agentCommission, track per agent using agentId as key
  const [eftCreated, setEftCreated] = useState({
    agentCommission: {}, // Object with agentId as keys: { "100": true, "101": false }
    outsideBrokersCommission: {}, // Object with broker identifier as keys: { "broker1": true, "broker2": false }
    ourBrokerageCommission: false,
  });

  // Agent Commission form state
  const [agentCommissionForm, setAgentCommissionForm] = useState({
    name: "Agent Commission transfer form",
    chequeType: "lorem ipsum",
    tradeNumber: "",
    selectedTrade: null,
    selectedAgentId: "",
  });

  // Outside Brokers Commission form state
  const [outsideBrokersForm, setOutsideBrokersForm] = useState({
    name: "Outside Brokers Commission Transfer Form",
    type: "EFT",
    tradeNumber: "",
    selectedTrade: null,
    selectedOutsideBrokers: [], // Array to hold multiple selected brokers
  });
  const [currentBrokerIndex, setCurrentBrokerIndex] = useState(0); // Track which broker is being processed

  // Outside Brokers Commission details form state
  const [showOutsideBrokersDetailsForm, setShowOutsideBrokersDetailsForm] =
    useState(false);
  const [outsideBrokersDetailsForm, setOutsideBrokersDetailsForm] = useState({
    chequeDate: new Date().toISOString().split("T")[0],
    bankAccount: "Commission Trust",
    outsideBrokerName: "",
    outsideBrokerCompany: "",
    tradeNumber: "",
    address: "",
    netCommission: "",
    netCheque: "",
    noteOnStub: "Transfer commission to outside broker",
  });
  const [showOutsideBrokersReceipt, setShowOutsideBrokersReceipt] =
    useState(false);
  const [outsideBrokersReceiptData, setOutsideBrokersReceiptData] =
    useState(null);

  // Our Brokerage Commission form state
  const [ourBrokerageForm, setOurBrokerageForm] = useState({
    tradeNumber: "",
    selectedTrade: null,
  });
  const [showOurBrokerageDetailsForm, setShowOurBrokerageDetailsForm] =
    useState(false);

  const [builderRepaymentForm, setBuilderRepaymentForm] = useState({
    name: "Builder Repayment Transfer Form",
    type: "EFT",
    tradeNumber: "",
    selectedTrade: null,
    builderName: "",
    suggestedRepaymentAmount: null,
  });
  const [showBuilderRepaymentDetailsForm, setShowBuilderRepaymentDetailsForm] =
    useState(false);
  const [builderRepaymentEftCreated, setBuilderRepaymentEftCreated] =
    useState(false);

  const [generalToCommissionForm, setGeneralToCommissionForm] = useState({
    tradeNumber: "",
    selectedTrade: null,
  });
  const [
    showGeneralToCommissionDetailsForm,
    setShowGeneralToCommissionDetailsForm,
  ] = useState(false);
  const [generalToCommissionEftCreated, setGeneralToCommissionEftCreated] =
    useState(false);

  // Fetch trades on component mount
  useEffect(() => {
    fetchTrades();
  }, []);

  const fetchTrades = async () => {
    try {
      const response = await axiosInstance.get("/trades");
      setTrades(response.data);
    } catch (error) {
      console.error("Error fetching trades:", error);
    }
  };

  // Handle trade number search for outside brokers
  const handleOutsideBrokersTradeSearch = (searchTerm) => {
    const term = String(searchTerm ?? "");
    setOutsideBrokersForm((prev) => ({
      ...prev,
      tradeNumber: term,
      selectedTrade: null,
      selectedOutsideBrokers: [],
    }));

    if (term.trim() === "") {
      setFilteredTrades([]);
      setShowTradeDropdown(false);
      return;
    }

    const filtered = filterTradesBySearchTerm(trades, term);
    setFilteredTrades(filtered);
    setShowTradeDropdown(true);
  };

  // Select trade from dropdown for outside brokers
  const selectOutsideBrokersTrade = async (trade) => {
    const address = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
    try {
      const response = await axiosInstance.get(`/trades/${trade._id}`);
      const fullTrade = response.data;

      let brokerEftStatus = {};
      try {
        const checkUrl = `/commission-trust-eft/check-existing/${trade._id}/OutsideBrokerCommission`;
        const checkRes = await axiosInstance.get(checkUrl);
        const recipients = checkRes.data?.recipients || [];
        const allBrokers = getOutsideBrokersWithReferrals(fullTrade);
        allBrokers.forEach((broker) => {
          const key = getOutsideBrokerKey(broker);
          brokerEftStatus[key] = recipients.includes(key);
        });
      } catch (checkErr) {
        try {
          const eftResponse = await axiosInstance.get(
            `/commission-trust-eft/trade/${trade._id}`,
          );
          const allEFTs = eftResponse.data || [];
          const outsideBrokerEFTs = allEFTs.filter(
            (eft) => eft.type === "OutsideBrokerCommission",
          );
          const allBrokers = getOutsideBrokersWithReferrals(fullTrade);
          allBrokers.forEach((broker) => {
            const key = getOutsideBrokerKey(broker);
            brokerEftStatus[key] = outsideBrokerEFTs.some(
              (eft) => (eft.recipient || "").trim() === key,
            );
          });
        } catch (error) {
          console.error("Error checking EFT status for brokers:", error);
          getOutsideBrokersWithReferrals(fullTrade).forEach((broker) => {
            brokerEftStatus[getOutsideBrokerKey(broker)] = false;
          });
        }
      }

      setEftCreated((prev) => ({
        ...prev,
        outsideBrokersCommission: brokerEftStatus,
      }));

      setOutsideBrokersForm((prev) => ({
        ...prev,
        tradeNumber: `${trade.tradeNumber} - ${address}`,
        selectedTrade: fullTrade,
        selectedOutsideBrokers: [],
      }));
      setShowTradeDropdown(false);
    } catch (error) {
      console.error("Error fetching full trade details:", error);
      toast.error("Could not load trade details. Please try again.");
    }
  };

  // Handle outside brokers form submission
  const handleOutsideBrokersSubmit = (e) => {
    e.preventDefault();
    if (
      outsideBrokersForm.selectedTrade &&
      outsideBrokersForm.selectedOutsideBrokers.length > 0
    ) {
      setCurrentBrokerIndex(0); // Start with first selected broker
      setShowOutsideBrokersDetailsForm(true);
    } else if (!outsideBrokersForm.selectedTrade) {
      alert("Please select a trade to proceed.");
    } else {
      alert("Please select at least one outside broker to proceed.");
    }
  };

  // Handle trade number search for agent commission
  const handleAgentCommissionTradeSearch = (searchTerm) => {
    const term = String(searchTerm ?? "");
    setAgentCommissionForm((prev) => ({
      ...prev,
      tradeNumber: term,
      selectedTrade: null,
      selectedAgentId: "",
    }));

    if (term.trim() === "") {
      setFilteredTrades([]);
      setShowTradeDropdown(false);
      return;
    }

    const filtered = filterTradesBySearchTerm(trades, term);
    setFilteredTrades(filtered);
    setShowTradeDropdown(true);
  };

  // Select trade from dropdown for agent commission
  const selectAgentCommissionTrade = async (trade) => {
    const address = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
    try {
      const response = await axiosInstance.get(`/trades/${trade._id}`);
      const fullTrade = response.data;

      // Check EFT status for each agent in the trade
      const agentEftStatus = {};
      if (
        fullTrade.agentCommissionList &&
        fullTrade.agentCommissionList.length > 0
      ) {
        // Get unique agent IDs
        const uniqueAgentIds = [
          ...new Set(
            fullTrade.agentCommissionList.map((agent) => agent.agentId),
          ),
        ];

        // Check EFT status for each unique agent
        for (const agentId of uniqueAgentIds) {
          const existingEFT = await checkCommissionTrustEFT(
            trade._id,
            "AgentCommissionTransfer",
            agentId,
          );
          agentEftStatus[String(agentId)] = existingEFT.exists;
        }
      }

      setEftCreated((prev) => ({
        ...prev,
        agentCommission: agentEftStatus,
      }));

      setAgentCommissionForm((prev) => ({
        ...prev,
        tradeNumber: `${trade.tradeNumber} - ${address}`,
        selectedTrade: fullTrade,
        selectedAgentId: "", // Reset agent selection
      }));
      setShowTradeDropdown(false);
    } catch (error) {
      console.error("Error fetching full trade details:", error);
      toast.error("Could not load trade details. Please try again.");
    }
  };

  // Handle agent commission form submission
  const handleAgentCommissionSubmit = (e) => {
    e.preventDefault();
    if (
      agentCommissionForm.selectedTrade &&
      agentCommissionForm.selectedAgentId
    ) {
      setShowDetailsForm(true);
    } else if (!agentCommissionForm.selectedTrade) {
      alert("Please select a trade to proceed.");
    } else {
      alert("Please select an agent to proceed.");
    }
  };

  const handleAgentCommissionEFTClick = async (formState) => {
    if (
      !agentCommissionForm.selectedTrade ||
      !agentCommissionForm.selectedAgentId
    ) {
      alert("No trade or agent selected.");
      return;
    }
    const trade = agentCommissionForm.selectedTrade;

    const selectedAgent = trade.agentCommissionList?.find(
      (agent) =>
        String(agent.agentId) === String(agentCommissionForm.selectedAgentId),
    );

    if (!selectedAgent) {
      alert("Selected agent not found.");
      return;
    }

    // Check if EFT already exists for this specific agent
    const existingEFT = await checkCommissionTrustEFT(
      trade._id,
      "AgentCommissionTransfer",
      selectedAgent.agentId,
    );

    // Only block if EFT exists AND the agentId matches (to handle edge cases where old EFTs might not have agentId)
    if (existingEFT.exists) {
      // Verify that the found EFT is actually for this agent
      // If agentId doesn't match, it might be an old EFT without proper agentId, so allow creation
      if (
        existingEFT.agentId != null &&
        String(existingEFT.agentId) !== String(selectedAgent.agentId)
      ) {
        console.warn(
          `Found EFT #${existingEFT.eftNumber} but agentId mismatch. Expected: ${selectedAgent.agentId}, Found: ${existingEFT.agentId}. Allowing creation.`,
        );
        // Continue with EFT creation
      } else if (
        String(existingEFT.agentId) === String(selectedAgent.agentId)
      ) {
        // EFT exists for this exact agent, block creation
        toast.error(
          `Payment already completed for Agent ${selectedAgent.agentName} (${
            selectedAgent.agentId
          }) on Trade #${trade.tradeNumber}! 
          EFT #${existingEFT.eftNumber} was created on ${formatDate(
            existingEFT.date,
          )} 
          for ${getEFTTypeDisplayName(existingEFT.type)}.`,
          { duration: 6000 },
        );
        return;
      }
      // If agentId is null/undefined in existing EFT, allow creation (might be old record)
    }

    try {
      console.log("Selected agent:", selectedAgent);
      console.log("Agent ID:", selectedAgent.agentId);

      // 1. Fetch Company Profile (optional - use default if not available)
      console.log("Fetching company profile...");
      let companyInfo = null;
      try {
        const companyProfileRes = await axiosInstance.get("/company-profile");
        companyInfo = companyProfileRes.data;
        console.log("Company info:", companyInfo);
      } catch (companyError) {
        if (companyError.response?.status === 404) {
          console.log("Company profile not found, using default values");
          // Use default company info if profile doesn't exist
          companyInfo = {
            companyName: "365 Realty Brokerage",
            address: "66 Antibes Dr",
            city: "Brampton",
            province: "Ontario",
            postalCode: "L6X 5H5",
            phone: "416-365-0100",
            fax: "Fax",
            email: "email@company.com",
          };
        } else {
          throw companyError;
        }
      }

      // 2. Fetch Agent's full details for address
      console.log(
        "Fetching agent details for employee number:",
        selectedAgent.agentId,
      );
      const agentDetailsRes = await axiosInstance.get(
        `/agents/employee/${selectedAgent.agentId}`,
      );
      const agentDetails = agentDetailsRes.data;
      console.log("Agent details:", agentDetails);

      const {
        netPayAmount,
        officePlanAmount,
        officeExpensesAmount,
        commissionDeductionAmount,
        buyerRebateTotal,
        preRebateGross,
      } = getAgentCommissionEftBreakdown(trade, selectedAgent.agentId);
      console.log(
        "Creating EFT for amount (net of buyer rebate):",
        netPayAmount,
      );
      const eftResponse = await axiosInstance.post(
        "/commission-trust-eft/agent-commission",
        {
          tradeId: trade._id,
          amount: netPayAmount,
          recipient: selectedAgent.agentName,
          agentId: selectedAgent.agentId,
          agentName: selectedAgent.agentName,
          chequeDate: formState.chequeDate,
        },
      );
      const newEftNumber = eftResponse.data.eftNumber;
      console.log("EFT created with number:", newEftNumber);

      console.log("Posting transaction...");
      await axiosInstance.post("/transactions", {
        date: (() => {
          const [month, day, year] = formState.chequeDate.split("/");
          return new Date(
            `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`,
          );
        })(),
        reference: `EFT#${newEftNumber}`,
        description: "Agent Commission Payment",
        debitAccount: "A/P - GENERAL & COMMISSION EXPENSE",
        creditAccount: "CASH - COMMISSION TRUST ACCOUNT",
        amount: netPayAmount,
        tradeId: trade._id,
      });

      await axiosInstance.post("/finance-transactions", {
        type: "AgentCommissionPayment",
        chequeDate: (() => {
          const [month, day, year] = formState.chequeDate.split("/");
          return new Date(
            `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`,
          );
        })(),
        amount: netPayAmount,
        chequeWrittenTo: selectedAgent.agentName,
        tradeId: trade._id,
      });

      const partyNames = getPartyNamesByDealType(trade);
      const sellers = partyNames.firstParty;
      const buyers = partyNames.secondParty;
      const tradeAddress = `${trade.keyInfo?.streetNumber || ""} ${
        trade.keyInfo?.streetName || ""
      }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();

      const agentAddress = `${agentDetails.streetNumber || ""} ${
        agentDetails.streetName || ""
      }`.trim();
      const agentUnit = agentDetails.unit ? ` Unit ${agentDetails.unit}` : "";
      const agentCityProvincePostal = `${agentDetails.city || ""}, ${
        agentDetails.province || ""
      }, ${agentDetails.postalCode || ""}`.trim();

      const tradeCommissionExHST = preRebateGross;
      const commissionAfterPlanExHST = Math.max(
        0,
        Math.round((preRebateGross - officePlanAmount) * 100) / 100,
      );
      const hstOnAgentShare =
        commissionAfterPlanExHST > 0
          ? Math.round(
              commissionAfterPlanExHST * getTradeTaxRate(trade) * 100,
            ) / 100
          : Math.round(netPayAmount * INCLUSIVE_HST_FRACTION * 100) / 100;
      const grossEarningsExHST = preRebateGross;

      let ytdForSummary = {
        ytdGrossEarningsExHST: null,
        ytdOfficeShareLess: null,
        ytdOfficeExpenses: null,
        ytdCommissionDeduction: null,
        ytdBuyerRebate: null,
        ytdHstOnAgentShare: null,
        ytdNetPay: null,
      };
      try {
        const ytdAgentKey =
          agentDetails?.employeeNo != null && agentDetails.employeeNo !== ""
            ? String(agentDetails.employeeNo)
            : String(selectedAgent.agentId ?? "");
        const ytdRes = await axiosInstance.get(
          `/commission-trust-eft/agent-ytd/${encodeURIComponent(ytdAgentKey)}`,
          {
            params: {
              throughDate: normalizeThroughDateForApi(formState.chequeDate),
            },
          },
        );
        ytdForSummary = {
          ytdGrossEarningsExHST: ytdRes.data?.ytdGrossEarningsExHST ?? null,
          ytdOfficeShareLess: ytdRes.data?.ytdOfficeShareLess ?? null,
          ytdOfficeExpenses: ytdRes.data?.ytdOfficeExpenses ?? null,
          ytdCommissionDeduction: ytdRes.data?.ytdCommissionDeduction ?? null,
          ytdBuyerRebate: ytdRes.data?.ytdBuyerRebate ?? null,
          ytdHstOnAgentShare: ytdRes.data?.ytdHstOnAgentShare ?? null,
          ytdNetPay: ytdRes.data?.ytdNetPay ?? null,
        };
      } catch (ytdErr) {
        console.warn("Could not load YTD totals for EFT receipt:", ytdErr);
      }

      const dataForReceipt = {
        companyInfo: companyInfo,
        eftNumber: newEftNumber,
        paidTo: {
          name: selectedAgent.agentName,
          address: agentAddress,
        },
        trade: tradeAddress,
        notes:
          buyerRebateTotal > 0
            ? "Transfer commission to agent (net of buyer rebate)"
            : "Transfer commission to agent",
        amount: netPayAmount,
        seller: sellers,
        buyer: buyers,
        firstPartyLabel: partyNames.firstPartyLabel,
        secondPartyLabel: partyNames.secondPartyLabel,
        payTo: selectedAgent.agentName,
        orderOf: {
          streetNumber: agentDetails.streetNumber || "",
          streetName: agentDetails.streetName || "",
          unitNumber: agentDetails.unit || "",
          province: agentDetails.province || "",
          postalCode: agentDetails.postalCode || "",
          address: `${agentAddress}${agentUnit}`,
          cityProvincePostal: agentCityProvincePostal,
        },
        note: `${trade.tradeNumber} ${tradeAddress}`,
        chequeDate: formState.chequeDate,
        eftAgentSummary: {
          agentNumber: String(selectedAgent.agentId ?? ""),
          agentName: selectedAgent.agentName ?? "",
          tradeNumber: trade.tradeNumber ?? "",
          propertyAddress: tradeAddress,
          tradeCommissionExHST,
          grossEarningsExHST,
          officeShareLess: officePlanAmount,
          officeExpenses: officeExpensesAmount,
          commissionDeduction: commissionDeductionAmount,
          buyerRebateAmount: buyerRebateTotal,
          hstOnAgentShare,
          netPay: netPayAmount,
          ...ytdForSummary,
        },
      };

      setEftReceiptData(dataForReceipt);
      setIsOurBrokerageEFT(false);
      setShowEFTReceipt(true);
      setEftCreated((prev) => ({
        ...prev,
        agentCommission: {
          ...prev.agentCommission,
          [String(selectedAgent.agentId)]: isTradeVoided(trade) ? false : true,
        },
      }));
      toast.success(
        "Transaction posted to Chart of Accounts and Ledger successfully!",
      );
    } catch (error) {
      console.error("Error during EFT process:", error);
      console.error("Error response:", error.response?.data);
      console.error("Error status:", error.response?.status);

      // Provide more specific error messages based on the error
      if (error.response?.status === 404) {
        toast.error(
          "Required data not found. Please ensure all required information is set up.",
        );
      } else {
        toast.error("Failed to complete EFT process. Please try again.");
      }
    }
  };

  // Helper for mm/dd/yyyy format
  const getCurrentMDYDate = () => {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    return `${pad(now.getMonth() + 1)}/${pad(
      now.getDate(),
    )}/${now.getFullYear()}`;
  };

  // Agent Commission Details Form Component
  const AgentCommissionDetailsForm = ({
    trade,
    selectedAgentId,
    onBack,
    eftCreatedForAgent,
  }) => {
    const eftBlocked = Boolean(eftCreatedForAgent) && !isTradeVoided(trade);
    const [formState, setFormState] = useState({
      chequeDate: getCurrentMDYDate(),
      bankAccount: "Commission Trust",
      agentNumber: "",
      agentName: "",
      tradeNumber: "",
      address: "",
      netCommission: "",
      netCheque: "",
      noteOnStub: "Transfer commission to agent",
    });

    const [useCustomDate, setUseCustomDate] = useState(false);

    useEffect(() => {
      if (trade && selectedAgentId) {
        const selectedAgent =
          trade.agentCommissionList?.find(
            (agent) => String(agent.agentId) === String(selectedAgentId),
          ) || {};
        const b = getAgentCommissionEftBreakdown(trade, selectedAgentId);

        const address = `${trade.keyInfo?.streetNumber || ""} ${
          trade.keyInfo?.streetName || ""
        }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();

        setFormState({
          chequeDate: getCurrentMDYDate(),
          bankAccount: "Commission Trust",
          agentNumber: selectedAgent.agentId || "",
          agentName: selectedAgent.agentName || "",
          tradeNumber: trade.tradeNumber,
          address: address,
          netCommission: b.netCommission.toFixed(2),
          netCheque: b.netPayAmount.toFixed(2),
          noteOnStub:
            b.buyerRebateTotal > 0
              ? "Transfer commission to agent (net of buyer rebate)"
              : "Transfer commission to agent",
        });
      }
    }, [trade, selectedAgentId]);

    const handleInputChange = (e) => {
      const { name, value } = e.target;
      setFormState((prev) => ({
        ...prev,
        [name]: value,
      }));
    };

    return (
      <div className="p-6 border border-gray-200 rounded-lg">
        <h3 className="font-semibold mb-4 text-lg">
          Agent Commission Cheque Details
        </h3>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cheque Date
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="useCustomDate"
                checked={useCustomDate}
                onChange={(e) => setUseCustomDate(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label htmlFor="useCustomDate" className="text-sm text-gray-600">
                Override Date
              </label>
            </div>
            {useCustomDate ? (
              <input
                type="date"
                name="chequeDate"
                value={
                  formState.chequeDate.includes("/")
                    ? (() => {
                        const [month, day, year] =
                          formState.chequeDate.split("/");
                        return `${year}-${month.padStart(
                          2,
                          "0",
                        )}-${day.padStart(2, "0")}`;
                      })()
                    : formState.chequeDate
                }
                onChange={(e) => {
                  const selectedDate = new Date(e.target.value + "T00:00:00");
                  const formattedDate = `${(selectedDate.getMonth() + 1)
                    .toString()
                    .padStart(2, "0")}/${selectedDate
                    .getDate()
                    .toString()
                    .padStart(2, "0")}/${selectedDate.getFullYear()}`;
                  setFormState((prev) => ({
                    ...prev,
                    chequeDate: formattedDate,
                  }));
                }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
              />
            ) : (
              <input
                type="text"
                name="chequeDate"
                value={formState.chequeDate}
                readOnly
                className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Bank Account
            </label>
            <input
              type="text"
              name="bankAccount"
              value={formState.bankAccount}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Agent Number
            </label>
            <input
              type="text"
              name="agentNumber"
              value={formState.agentNumber}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Agent Name
            </label>
            <input
              type="text"
              name="agentName"
              value={formState.agentName}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Trade #
            </label>
            <input
              type="text"
              name="tradeNumber"
              value={formState.tradeNumber}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Address
            </label>
            <input
              type="text"
              name="address"
              value={formState.address}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Net Commission
            </label>
            <input
              type="text"
              name="netCommission"
              value={formState.netCommission}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Net Cheque
            </label>
            <input
              type="text"
              name="netCheque"
              value={formState.netCheque}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">
            Note on Stub
          </label>
          <input
            type="text"
            name="noteOnStub"
            value={formState.noteOnStub}
            readOnly
            className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
          />
        </div>

        <div className="flex justify-start space-x-4 mt-6">
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Print
          </button>
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Batch
          </button>
          <button
            onClick={() => handleAgentCommissionEFTClick(formState)}
            disabled={eftBlocked}
            className={`py-2 px-6 rounded-md transition-colors ${
              eftBlocked
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : "bg-gray-200 text-black hover:bg-gray-300"
            }`}
          >
            {eftBlocked ? "EFT Created" : "E.F.T."}
          </button>
          <button
            onClick={onBack}
            className="bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600 transition-colors"
          >
            Exit
          </button>
        </div>
      </div>
    );
  };

  const OutsideBrokersCommissionDetailsForm = ({
    trade,
    selectedOutsideBrokers,
    currentBrokerIndex,
    onNextBroker,
    onBack,
    eftCreated,
  }) => {
    const selectedOutsideBroker = selectedOutsideBrokers[currentBrokerIndex];
    const eftBlockedForBroker = (brokerKey) =>
      Boolean(eftCreated?.[brokerKey]) && !isTradeVoided(trade);
    const [formState, setFormState] = useState({
      chequeDate: getCurrentMDYDate(),
      bankAccount: "Commission Trust",
      outsideBrokerName: "",
      outsideBrokerCompany: "",
      outsideBrokerStreetNumber: "",
      outsideBrokerStreetName: "",
      outsideBrokerUnitNumber: "",
      outsideBrokerProvince: "",
      outsideBrokerPostalCode: "",
      tradeNumber: "",
      address: "",
      netCommission: "",
      netCheque: "",
      noteOnStub: "Transfer commission to outside broker",
      seller: "",
      buyer: "",
    });

    const [useCustomDate, setUseCustomDate] = useState(false);

    useEffect(() => {
      if (trade && selectedOutsideBroker) {
        const referralAgent = (trade.agentCommissionList || []).find(
          (a) =>
            (a.classification || "").toUpperCase() === "REFERRAL" &&
            (String(a.agentId) === String(selectedOutsideBroker.agentId) ||
              a.agentName === selectedOutsideBroker.agentName),
        );

        let netCommission = 0;
        if (selectedOutsideBroker._isReferral && referralAgent) {
          if (referralAgent.agentId != null && referralAgent.agentId !== "") {
            netCommission = getAgentCommissionEftBreakdown(
              trade,
              referralAgent.agentId,
            ).netPayAmount;
          }
          if (!netCommission) {
            netCommission = parseFloat(
              referralAgent.netCommission ||
                referralAgent.total ||
                referralAgent.amount ||
                0,
            );
          }
        } else if (selectedOutsideBroker._isReferral) {
          netCommission = 0;
        } else {
          const outsideBrokerCommission =
            trade.commission?.outsideBrokersRows?.find(
              (broker) =>
                broker.agentName === selectedOutsideBroker.agentName ||
                `${selectedOutsideBroker.firstName} ${selectedOutsideBroker.lastName}` ===
                  broker.agentName,
            ) || {};
          netCommission = parseFloat(outsideBrokerCommission.total || 0);
        }

        const address = `${trade.keyInfo?.streetNumber || ""} ${
          trade.keyInfo?.streetName || ""
        }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();

        const partyNames = getPartyNamesByDealType(trade);
        const sellers = partyNames.firstParty;
        const buyers = partyNames.secondParty;

        let brokerForAddress = selectedOutsideBroker;
        if (selectedOutsideBroker._isReferral && referralAgent) {
          brokerForAddress = {
            ...selectedOutsideBroker,
            streetNumber:
              referralAgent.streetNumber ?? selectedOutsideBroker.streetNumber,
            streetName:
              referralAgent.streetName ?? selectedOutsideBroker.streetName,
            unitNumber:
              referralAgent.unitNumber ?? selectedOutsideBroker.unitNumber,
            province: referralAgent.province ?? selectedOutsideBroker.province,
            postalCode:
              referralAgent.postalCode ?? selectedOutsideBroker.postalCode,
            address: referralAgent.address ?? selectedOutsideBroker.address,
          };
        }

        const brokerName =
          selectedOutsideBroker.agentName ||
          `${selectedOutsideBroker.firstName || ""} ${selectedOutsideBroker.lastName || ""}`.trim();
        const companyForForm =
          selectedOutsideBroker._isReferral ||
          selectedOutsideBroker.company === "Referral"
            ? brokerName
            : selectedOutsideBroker.company || "";

        setFormState({
          chequeDate: getCurrentMDYDate(),
          bankAccount: "Commission Trust",
          outsideBrokerName: brokerName,
          outsideBrokerCompany: companyForForm,
          outsideBrokerStreetNumber: brokerForAddress.streetNumber ?? "",
          outsideBrokerStreetName: brokerForAddress.streetName ?? "",
          outsideBrokerUnitNumber: brokerForAddress.unitNumber ?? "",
          outsideBrokerProvince: brokerForAddress.province ?? "",
          outsideBrokerPostalCode: brokerForAddress.postalCode ?? "",
          tradeNumber: trade.tradeNumber,
          address: address,
          netCommission: netCommission.toFixed(2),
          netCheque: netCommission.toFixed(2),
          noteOnStub: "Transfer commission to outside broker",
          seller: sellers,
          buyer: buyers,
        });
      }
    }, [trade, selectedOutsideBroker]);

    const handleEFTClick = async () => {
      const tradeAddress = `${trade.keyInfo?.streetNumber || ""} ${
        trade.keyInfo?.streetName || ""
      }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();

      const partyNames = getPartyNamesByDealType(trade);
      const sellers = partyNames.firstParty;
      const buyers = partyNames.secondParty;

      try {
        let companyInfo = null;
        try {
          const companyProfileRes = await axiosInstance.get("/company-profile");
          companyInfo = companyProfileRes.data;
        } catch (companyError) {
          if (companyError.response?.status === 404) {
            companyInfo = {
              companyName: "365 Realty Brokerage",
              address: "66 Antibes Dr",
              city: "Brampton",
              province: "Ontario",
              postalCode: "L6X 5H5",
              phone: "416-365-0100",
              fax: "Fax",
              email: "email@company.com",
            };
          } else {
            throw companyError;
          }
        }

        const isReferralAgent =
          selectedOutsideBroker?._isReferral ||
          formState.outsideBrokerCompany === "Referral";
        const eftCompanyName = isReferralAgent
          ? formState.outsideBrokerName
          : formState.outsideBrokerCompany;
        const eftRecipient = eftCompanyName
          ? `${formState.outsideBrokerName} - ${eftCompanyName}`
          : formState.outsideBrokerName;

        const eftResponse = await axiosInstance.post(
          "/commission-trust-eft/outside-broker",
          {
            tradeId: trade._id,
            amount: Number(formState.netCommission),
            recipient: eftRecipient,
            description: "Transfer commission to outside broker",
            chequeDate: formState.chequeDate,
          },
        );

        const eftNumber = eftResponse.data.eftNumber;
        const payeeForReceipt = eftCompanyName || formState.outsideBrokerName;

        setOutsideBrokersReceiptData({
          companyInfo: companyInfo,
          eftNumber: eftNumber,
          chequeDate: formState.chequeDate,
          paidTo: payeeForReceipt,
          trade: `${trade.tradeNumber} ${tradeAddress}`,
          notes: "Transfer commission to outside broker",
          amount: formState.netCommission,
          seller: sellers,
          buyer: buyers,
          firstPartyLabel: partyNames.firstPartyLabel,
          secondPartyLabel: partyNames.secondPartyLabel,
          payTo: payeeForReceipt,
          orderOf: {
            streetNumber: formState.outsideBrokerStreetNumber,
            streetName: formState.outsideBrokerStreetName,
            unitNumber: formState.outsideBrokerUnitNumber,
            province: formState.outsideBrokerProvince,
            postalCode: formState.outsideBrokerPostalCode,
            address: [
              String(formState.outsideBrokerStreetNumber || "").trim(),
              String(formState.outsideBrokerStreetName || "").trim(),
              String(formState.outsideBrokerUnitNumber || "").trim(),
            ]
              .filter(Boolean)
              .join(", "),
            cityProvincePostal: [
              formState.outsideBrokerProvince,
              formState.outsideBrokerPostalCode,
            ]
              .filter(Boolean)
              .join(", "),
          },
          note: `${trade.tradeNumber} ${tradeAddress}`,
        });
        setShowOutsideBrokersReceipt(true);
        const brokerKey =
          getOutsideBrokerKey(selectedOutsideBroker) ||
          formState.outsideBrokerName;
        setEftCreated((prev) => ({
          ...prev,
          outsideBrokersCommission: {
            ...prev.outsideBrokersCommission,
            [brokerKey]: true,
          },
        }));
        toast.success(
          "Transaction posted to Chart of Accounts and Ledger successfully!",
        );
      } catch (error) {
        console.error("Error creating EFT record:", error);
        alert("Error creating EFT record. Please try again.");
      }
    };

    const brokerKeyForUi = selectedOutsideBroker
      ? getOutsideBrokerKey(selectedOutsideBroker)
      : "";

    if (!selectedOutsideBroker) {
      return (
        <div className="p-6 border border-gray-200 rounded-lg">
          <p className="text-red-500">No broker selected.</p>
          <button
            onClick={onBack}
            className="mt-4 bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600 transition-colors"
          >
            Back
          </button>
        </div>
      );
    }

    return (
      <div className="p-6 border border-gray-200 rounded-lg">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-lg">
            Outside Brokers Commission Cheque Details
          </h3>
          {selectedOutsideBrokers.length > 1 && (
            <div className="text-sm text-gray-600">
              Broker {currentBrokerIndex + 1} of {selectedOutsideBrokers.length}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cheque Date
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="useCustomDateOutside"
                checked={useCustomDate}
                onChange={(e) => setUseCustomDate(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label
                htmlFor="useCustomDateOutside"
                className="text-sm text-gray-600"
              >
                Override Date
              </label>
            </div>
            {useCustomDate ? (
              <input
                type="date"
                name="chequeDate"
                value={
                  formState.chequeDate.includes("/")
                    ? (() => {
                        const [month, day, year] =
                          formState.chequeDate.split("/");
                        return `${year}-${month.padStart(
                          2,
                          "0",
                        )}-${day.padStart(2, "0")}`;
                      })()
                    : formState.chequeDate
                }
                onChange={(e) => {
                  const selectedDate = new Date(e.target.value + "T00:00:00");
                  const formattedDate = `${(selectedDate.getMonth() + 1)
                    .toString()
                    .padStart(2, "0")}/${selectedDate
                    .getDate()
                    .toString()
                    .padStart(2, "0")}/${selectedDate.getFullYear()}`;
                  setFormState((prev) => ({
                    ...prev,
                    chequeDate: formattedDate,
                  }));
                }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
              />
            ) : (
              <input
                type="text"
                name="chequeDate"
                value={formState.chequeDate}
                readOnly
                className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Bank Account
            </label>
            <input
              type="text"
              name="bankAccount"
              value={formState.bankAccount}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Outside Broker Name
            </label>
            <input
              type="text"
              name="outsideBrokerName"
              value={formState.outsideBrokerName}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Outside Broker Company
            </label>
            <input
              type="text"
              name="outsideBrokerCompany"
              value={formState.outsideBrokerCompany}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Outside Broker Address
            </label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div>
                <label className="block text-xs text-gray-500">Street #</label>
                <input
                  type="text"
                  name="outsideBrokerStreetNumber"
                  value={formState.outsideBrokerStreetNumber}
                  readOnly
                  className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500">
                  Street Name
                </label>
                <input
                  type="text"
                  name="outsideBrokerStreetName"
                  value={formState.outsideBrokerStreetName}
                  readOnly
                  className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500">Unit #</label>
                <input
                  type="text"
                  name="outsideBrokerUnitNumber"
                  value={formState.outsideBrokerUnitNumber}
                  readOnly
                  className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500">Province</label>
                <input
                  type="text"
                  name="outsideBrokerProvince"
                  value={formState.outsideBrokerProvince}
                  readOnly
                  className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500">
                  Postal Code
                </label>
                <input
                  type="text"
                  name="outsideBrokerPostalCode"
                  value={formState.outsideBrokerPostalCode}
                  readOnly
                  className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm text-sm"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Trade Number
            </label>
            <input
              type="text"
              name="tradeNumber"
              value={formState.tradeNumber}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Address
            </label>
            <input
              type="text"
              name="address"
              value={formState.address}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Net Commission
            </label>
            <input
              type="text"
              name="netCommission"
              value={formState.netCommission}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Net Cheque
            </label>
            <input
              type="text"
              name="netCheque"
              value={formState.netCheque}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Seller
            </label>
            <input
              type="text"
              name="seller"
              value={formState.seller}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Buyer
            </label>
            <input
              type="text"
              name="buyer"
              value={formState.buyer}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700">
            Note on Stub
          </label>
          <input
            type="text"
            name="noteOnStub"
            value={formState.noteOnStub}
            readOnly
            className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
          />
        </div>

        <div className="flex justify-start space-x-4 mt-6">
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Print
          </button>
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Batch
          </button>
          <button
            onClick={handleEFTClick}
            disabled={eftBlockedForBroker(brokerKeyForUi)}
            className={`py-2 px-6 rounded-md transition-colors ${
              eftBlockedForBroker(brokerKeyForUi)
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : "bg-gray-200 text-black hover:bg-gray-300"
            }`}
          >
            {eftBlockedForBroker(brokerKeyForUi) ? "EFT Created" : "E.F.T."}
          </button>
          {currentBrokerIndex < selectedOutsideBrokers.length - 1 ? (
            <button
              onClick={onNextBroker}
              className="bg-blue-500 text-white py-2 px-6 rounded-md hover:bg-blue-600 transition-colors"
            >
              Next Broker ({currentBrokerIndex + 1}/
              {selectedOutsideBrokers.length})
            </button>
          ) : null}
          <button
            onClick={onBack}
            className="bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600 transition-colors"
          >
            Exit
          </button>
        </div>
      </div>
    );
  };

  // Our Brokerage Commission Details Form
  const OurBrokerageCommissionDetailsForm = ({
    trade: tradeProp,
    onBack,
    eftCreated,
  }) => {
    const [trade, setTrade] = useState(tradeProp);
    const [tradeLoading, setTradeLoading] = useState(!!tradeProp?._id);
    const eftBlocked = Boolean(eftCreated) && !isTradeVoided(tradeProp);

    useEffect(() => {
      if (!tradeProp?._id) return;
      let cancelled = false;
      setTradeLoading(true);
      axiosInstance
        .get(`/trades/${tradeProp._id}`)
        .then((res) => {
          if (!cancelled) setTrade(res.data);
        })
        .catch(() => {
          if (!cancelled) setTrade(tradeProp);
        })
        .finally(() => {
          if (!cancelled) setTradeLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [tradeProp?._id]);

    const [formState, setFormState] = useState({
      chequeDate: getCurrentMDYDate(),
      bankAccount: "Commission Trust",
      tradeNumber: tradeProp?.tradeNumber || "",
      amount: "",
      noteOnStub: "Transfer Office Share",
    });

    const [useCustomDate, setUseCustomDate] = useState(false);
    useEffect(() => {
      if (trade) {
        const totalBuyerRebates = getTotalBuyerRebateAmount(trade);
        const eftAmount = getOurBrokerageEftAmount(trade);

        setFormState((prev) => ({
          ...prev,
          tradeNumber: trade.tradeNumber,
          amount: eftAmount,
          noteOnStub:
            totalBuyerRebates > 0
              ? "Transfer Office Share (includes buyer rebates)"
              : "Transfer Office Share",
        }));
      }
    }, [trade]);

    const handleEFTClick = async () => {
      if (!trade) return;
      const tradeAddress = `${trade.keyInfo?.streetNumber || ""} ${
        trade.keyInfo?.streetName || ""
      }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
      const amount = formState.amount;
      try {
        const eftResponse = await axiosInstance.post(
          "/commission-trust-eft/our-brokerage",
          {
            tradeId: trade._id,
            amount: Number(amount),
            recipient: "365 Realty Brokerage",
            description: "Transfer Office Share",
            chequeDate: formState.chequeDate,
          },
        );
        const eftNumber = eftResponse.data.eftNumber;
        await axiosInstance.post("/transactions", {
          date: (() => {
            const [month, day, year] = formState.chequeDate.split("/");
            return new Date(
              `${year}-${month.padStart(2, "0")}-${day.padStart(
                2,
                "0",
              )}T00:00:00`,
            );
          })(),
          reference: `EFT#${eftNumber}`,
          description: "Our Brokerage Commission Transfer",
          debitAccount: "CASH - CURRENT ACCOUNT",
          creditAccount: "CASH - COMMISSION TRUST ACCOUNT",
          amount: Number(amount),
          tradeId: trade._id,
        });
        const totalBuyerRebates = getTotalBuyerRebateAmount(trade);

        const dataForReceipt = {
          eftNumber: eftNumber,
          paidTo: "365 Realty Brokerage",
          trade: `${trade.tradeNumber} ${tradeAddress}`,
          notes:
            totalBuyerRebates > 0
              ? "Transfer Office Share (includes buyer rebates)"
              : "Transfer Office Share",
          amount: amount,
          payTo: "365 Realty Brokerage",
          orderOf: {
            address: "66 Antibes Dr",
            cityProvincePostal: "Brampton Ontario L6X 5H5",
          },
          note: `${trade.tradeNumber} ${tradeAddress}`,
          chequeDate: formState.chequeDate,
        };
        setEftReceiptData(dataForReceipt);
        setIsOurBrokerageEFT(true);
        setShowEFTReceipt(true);
        setEftCreated((prev) => ({ ...prev, ourBrokerageCommission: true }));
        toast.success(
          "Transaction posted to Chart of Accounts and Ledger successfully!",
        );
      } catch (error) {
        console.error("Error during EFT process:", error);
        toast.error(
          "Failed to complete EFT process. Please try again. (Check if backend endpoint exists)",
        );
      }
    };

    return (
      <div className="p-6 border border-gray-200 rounded-lg">
        <h3 className="font-semibold mb-4 text-lg">
          Our Brokerage Commission Cheque Details
        </h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cheque Date
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="useCustomDateOurBrokerage"
                checked={useCustomDate}
                onChange={(e) => setUseCustomDate(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label
                htmlFor="useCustomDateOurBrokerage"
                className="text-sm text-gray-600"
              >
                Override Date
              </label>
            </div>
            {useCustomDate ? (
              <input
                type="date"
                name="chequeDate"
                value={
                  formState.chequeDate.includes("/")
                    ? (() => {
                        const [month, day, year] =
                          formState.chequeDate.split("/");
                        return `${year}-${month.padStart(
                          2,
                          "0",
                        )}-${day.padStart(2, "0")}`;
                      })()
                    : formState.chequeDate
                }
                onChange={(e) => {
                  const selectedDate = new Date(e.target.value + "T00:00:00");
                  const formattedDate = `${(selectedDate.getMonth() + 1)
                    .toString()
                    .padStart(2, "0")}/${selectedDate
                    .getDate()
                    .toString()
                    .padStart(2, "0")}/${selectedDate.getFullYear()}`;
                  setFormState((prev) => ({
                    ...prev,
                    chequeDate: formattedDate,
                  }));
                }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
              />
            ) : (
              <input
                type="text"
                name="chequeDate"
                value={formState.chequeDate}
                readOnly
                className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Bank Account
            </label>
            <input
              type="text"
              name="bankAccount"
              value={formState.bankAccount}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Trade #
            </label>
            <input
              type="text"
              name="tradeNumber"
              value={formState.tradeNumber}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Amount
            </label>
            {trade && (
              <p className="text-xs text-gray-600 mb-1">
                Tax rate applied:{" "}
                <strong>
                  {tradeLoading
                    ? "…"
                    : `${Math.round(getTradeTaxRate(trade, tradeProp) * 100)}%`}
                </strong>
              </p>
            )}
            <input
              type="text"
              name="amount"
              value={formState.amount}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          {(() => {
            if (!trade) return null;
            const totalBuyerRebates = getTotalBuyerRebateAmount(trade);
            if (totalBuyerRebates <= 0) return null;

            const { netToOfficeSubTotal, netToOfficeHST } =
              getNetToOfficeTotal(trade);
            const eftTotal = getOurBrokerageEftAmount(trade);

            return (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Net to Office (same as Trade Details sheet)
                </label>
                <div className="bg-gray-50 p-3 rounded-md text-sm">
                  <div className="flex justify-between mb-1">
                    <span>Subtotal:</span>
                    <span>${netToOfficeSubTotal}</span>
                  </div>
                  <div className="flex justify-between mb-1">
                    <span>HST:</span>
                    <span>${netToOfficeHST}</span>
                  </div>
                  <div className="flex justify-between mb-1 text-gray-600">
                    <span>
                      Buyer rebates (included in Total EFT; also on trade sheet
                      as Liabilities):
                    </span>
                    <span>${totalBuyerRebates.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Total (EFT amount):</span>
                    <span>${eftTotal}</span>
                  </div>
                </div>
              </div>
            );
          })()}
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">
              Note on Stub
            </label>
            <input
              type="text"
              name="noteOnStub"
              value={formState.noteOnStub}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
        </div>
        <div className="flex justify-start space-x-4 mt-6">
          <button className="bg-gray-200 text-black py-2 px-6 rounded-md hover:bg-gray-300 transition-colors">
            Print
          </button>
          <button
            onClick={handleEFTClick}
            disabled={eftBlocked}
            className={`py-2 px-6 rounded-md transition-colors ${
              eftBlocked
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : "bg-gray-200 text-black hover:bg-gray-300"
            }`}
          >
            {eftBlocked ? "EFT Created" : "E.F.T."}
          </button>
          <button
            onClick={onBack}
            className="bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600 transition-colors"
          >
            Exit
          </button>
        </div>
      </div>
    );
  };

  // Add state and handlers for Our Brokerage Commission
  const handleOurBrokerageTradeSearch = (searchTerm) => {
    const term = String(searchTerm ?? "");
    setOurBrokerageForm((prev) => ({
      ...prev,
      tradeNumber: term,
      selectedTrade: null,
    }));
    if (term.trim() === "") {
      setFilteredTrades([]);
      setShowTradeDropdown(false);
      return;
    }
    const filtered = filterTradesBySearchTerm(trades, term);
    setFilteredTrades(filtered);
    setShowTradeDropdown(true);
  };
  const selectOurBrokerageTrade = async (trade) => {
    const address = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
    try {
      // Check if Our Brokerage Commission EFT already exists for this trade
      const existingEFT = await checkCommissionTrustEFT(
        trade._id,
        "OurBrokerageCommission",
      );
      if (existingEFT.exists) {
        toast.error(
          `Payment already completed for Trade #${trade.tradeNumber}!\nEFT #${
            existingEFT.eftNumber
          } was created on ${formatDate(
            existingEFT.date,
          )} for ${getEFTTypeDisplayName(existingEFT.type)}.`,
          { duration: 6000 },
        );
        // Set EFT as created to disable the button
        setEftCreated((prev) => ({ ...prev, ourBrokerageCommission: true }));
        return;
      }
      const response = await axiosInstance.get(`/trades/${trade._id}`);
      const fullTrade = response.data;
      setOurBrokerageForm((prev) => ({
        ...prev,
        tradeNumber: `${trade.tradeNumber} - ${address}`,
        selectedTrade: fullTrade,
      }));
      setShowTradeDropdown(false);
    } catch (error) {
      console.error("Error fetching full trade details:", error);
      toast.error("Could not load trade details. Please try again.");
    }
  };

  const handleBuilderRepaymentTradeSearch = (searchTerm) => {
    const term = String(searchTerm ?? "");
    setBuilderRepaymentForm((prev) => ({
      ...prev,
      tradeNumber: term,
      selectedTrade: null,
      builderName: "",
      suggestedRepaymentAmount: null,
    }));
    if (term.trim() === "") {
      setFilteredTrades([]);
      setShowTradeDropdown(false);
      return;
    }
    setFilteredTrades(filterTradesBySearchTerm(trades, term));
    setShowTradeDropdown(true);
  };

  const selectBuilderRepaymentTrade = async (trade) => {
    const address = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
    try {
      const existingEFT = await checkCommissionTrustEFT(
        trade._id,
        "BuilderRepayment",
      );
      if (existingEFT.exists) {
        toast.error(
          `Builder repayment already completed for Trade #${trade.tradeNumber}!\nEFT #${existingEFT.eftNumber} was created on ${formatDate(existingEFT.date)}.`,
          { duration: 6000 },
        );
        setBuilderRepaymentEftCreated(true);
        setShowTradeDropdown(false);
        return;
      }

      const [tradeRes, builderRes] = await Promise.all([
        axiosInstance.get(`/trades/${trade._id}`),
        axiosInstance.get(`/commission-trust-eft/builder-name/${trade._id}`),
      ]);
      const fullTrade = tradeRes.data;
      const builderName = builderRes.data?.builderName || "";
      const suggestedRepaymentAmount =
        builderRes.data?.suggestedRepaymentAmount ?? null;
      if (!builderName) {
        toast.error(
          builderRes.data?.message ||
            "Builder name not found. Record Received From when finalizing the trade first.",
          { duration: 6000 },
        );
      }
      setBuilderRepaymentForm((prev) => ({
        ...prev,
        tradeNumber: `${trade.tradeNumber} - ${address}`,
        selectedTrade: fullTrade,
        builderName,
        suggestedRepaymentAmount,
      }));
      setBuilderRepaymentEftCreated(false);
      setShowTradeDropdown(false);
    } catch (error) {
      console.error("Error loading builder repayment trade:", error);
      toast.error("Could not load trade details. Please try again.");
    }
  };

  const handleGeneralToCommissionTradeSearch = (searchTerm) => {
    const term = String(searchTerm ?? "");
    setGeneralToCommissionForm((prev) => ({
      ...prev,
      tradeNumber: term,
      selectedTrade: null,
    }));
    if (term.trim() === "") {
      setFilteredTrades([]);
      setShowTradeDropdown(false);
      return;
    }
    setFilteredTrades(filterTradesBySearchTerm(trades, term));
    setShowTradeDropdown(true);
  };

  const selectGeneralToCommissionTrade = async (trade) => {
    const address = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
    try {
      const existingEFT = await checkCommissionTrustEFT(
        trade._id,
        "GeneralToCommissionTransfer",
      );
      if (existingEFT.exists) {
        toast.error(
          `General to Commission transfer already completed for Trade #${trade.tradeNumber}!\nEFT #${existingEFT.eftNumber} was created on ${formatDate(existingEFT.date)}.`,
          { duration: 6000 },
        );
        setGeneralToCommissionEftCreated(true);
        setShowTradeDropdown(false);
        return;
      }

      const response = await axiosInstance.get(`/trades/${trade._id}`);
      setGeneralToCommissionForm({
        tradeNumber: `${trade.tradeNumber} - ${address}`,
        selectedTrade: response.data,
      });
      setGeneralToCommissionEftCreated(false);
      setShowTradeDropdown(false);
    } catch (error) {
      console.error("Error loading trade for general to commission:", error);
      toast.error("Could not load trade details. Please try again.");
    }
  };

  const GeneralToCommissionDetailsForm = ({ trade, onBack, eftCreated }) => {
    const eftBlocked = Boolean(eftCreated) && !isTradeVoided(trade);
    const [formState, setFormState] = useState({
      chequeDate: getCurrentMDYDate(),
      bankAccount: "Commission Trust",
      tradeNumber: trade?.tradeNumber || "",
      amount: "",
      noteOnStub: "Commission transfer from General to Commission",
    });
    const [useCustomDate, setUseCustomDate] = useState(false);

    useEffect(() => {
      if (trade) {
        const { netToOfficeTotal } = getNetToOfficeTotal(trade);
        setFormState((prev) => ({
          ...prev,
          tradeNumber: trade.tradeNumber,
          amount: netToOfficeTotal || "",
        }));
      }
    }, [trade]);

    const handleInputChange = (e) => {
      const { name, value } = e.target;
      setFormState((prev) => ({ ...prev, [name]: value }));
    };

    const handleEFTClick = async () => {
      if (!trade) return;
      const amount = Number(formState.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error("Please enter a valid transfer amount.");
        return;
      }

      const existingEFT = await checkCommissionTrustEFT(
        trade._id,
        "GeneralToCommissionTransfer",
      );
      if (existingEFT.exists) {
        toast.error(
          `General to Commission transfer already completed for Trade #${trade.tradeNumber}!\nEFT #${existingEFT.eftNumber} was created on ${formatDate(existingEFT.date)}.`,
          { duration: 6000 },
        );
        setGeneralToCommissionEftCreated(true);
        return;
      }

      const tradeAddress = `${trade.keyInfo?.streetNumber || ""} ${
        trade.keyInfo?.streetName || ""
      }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
      const partyNames = getPartyNamesByDealType(trade);

      try {
        const eftResponse = await axiosInstance.post(
          "/commission-trust-eft/general-to-commission",
          {
            tradeId: trade._id,
            amount,
            chequeDate: formState.chequeDate,
            notes: formState.noteOnStub,
          },
        );
        const eftNum = eftResponse.data.eftNumber;

        setEftReceiptData({
          eftNumber: eftNum,
          paidTo: "Save Max Success Realty., Brokerage",
          trade: `${trade.tradeNumber} ${tradeAddress}`,
          notes:
            formState.noteOnStub ||
            "Commission transfer from General to Commission",
          amount: String(amount),
          payTo: "Save Max Success Realty., Brokerage",
          orderOf: {
            address: "634 Champlain St",
            cityProvincePostal: "Dieppe, NB E1A 1P4",
          },
          note: `${trade.tradeNumber} ${tradeAddress}`,
          chequeDate: formState.chequeDate,
          seller: partyNames.firstParty,
          buyer: partyNames.secondParty,
          firstPartyLabel: partyNames.firstPartyLabel,
          secondPartyLabel: partyNames.secondPartyLabel,
        });
        setIsOurBrokerageEFT(true);
        setShowEFTReceipt(true);
        setGeneralToCommissionEftCreated(true);
        toast.success(
          "Transfer posted to ledger and EFT created successfully!",
        );
      } catch (error) {
        console.error("Error creating general to commission transfer:", error);
        toast.error(
          error.response?.data?.message ||
            "Failed to create transfer. Please try again.",
        );
      }
    };

    return (
      <div className="p-6 border border-gray-200 rounded-lg">
        <h3 className="font-semibold mb-4 text-lg">
          General to Commission Transfer Details
        </h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cheque Date
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="useCustomDateGenComm"
                checked={useCustomDate}
                onChange={(e) => setUseCustomDate(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label
                htmlFor="useCustomDateGenComm"
                className="text-sm text-gray-600"
              >
                Override Date
              </label>
            </div>
            {useCustomDate ? (
              <input
                type="date"
                name="chequeDate"
                value={
                  formState.chequeDate.includes("/")
                    ? (() => {
                        const [month, day, year] =
                          formState.chequeDate.split("/");
                        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
                      })()
                    : formState.chequeDate
                }
                onChange={(e) => {
                  const selectedDate = new Date(e.target.value + "T00:00:00");
                  const formattedDate = `${(selectedDate.getMonth() + 1)
                    .toString()
                    .padStart(2, "0")}/${selectedDate
                    .getDate()
                    .toString()
                    .padStart(2, "0")}/${selectedDate.getFullYear()}`;
                  setFormState((prev) => ({
                    ...prev,
                    chequeDate: formattedDate,
                  }));
                }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
              />
            ) : (
              <input
                type="text"
                name="chequeDate"
                value={formState.chequeDate}
                readOnly
                className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Bank Account
            </label>
            <input
              type="text"
              name="bankAccount"
              value={formState.bankAccount}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Trade #
            </label>
            <input
              type="text"
              name="tradeNumber"
              value={formState.tradeNumber}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Transfer Amount
            </label>
            <input
              type="number"
              name="amount"
              value={formState.amount}
              onChange={handleInputChange}
              min="0.01"
              step="0.01"
              placeholder="Enter amount"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">
              Note on Stub
            </label>
            <input
              type="text"
              name="noteOnStub"
              value={formState.noteOnStub}
              onChange={handleInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
        </div>
        <div className="flex space-x-4">
          <button
            type="button"
            onClick={handleEFTClick}
            disabled={eftBlocked}
            className={`py-2 px-6 rounded-md transition-colors ${
              eftBlocked
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : "bg-gray-200 text-black hover:bg-gray-300"
            }`}
          >
            {eftBlocked ? "EFT Created" : "E.F.T."}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600 transition-colors"
          >
            Exit
          </button>
        </div>
      </div>
    );
  };

  const BuilderRepaymentDetailsForm = ({
    trade,
    builderName,
    suggestedRepaymentAmount,
    onBack,
    eftCreated,
  }) => {
    const eftBlocked = Boolean(eftCreated) && !isTradeVoided(trade);
    const formatSuggestedAmount = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return "";
      return n.toFixed(2);
    };

    const [formState, setFormState] = useState({
      chequeDate: getCurrentMDYDate(),
      bankAccount: "Commission Trust",
      tradeNumber: trade?.tradeNumber || "",
      builderName: builderName || "",
      builderStreetNumber: "",
      builderStreetName: "",
      builderUnit: "",
      builderCity: "",
      builderProvince: "",
      builderPostalCode: "",
      amount: formatSuggestedAmount(suggestedRepaymentAmount),
      noteOnStub: "Builder repayment",
    });
    const [useCustomDate, setUseCustomDate] = useState(false);

    useEffect(() => {
      if (trade) {
        const prefilled = formatSuggestedAmount(suggestedRepaymentAmount);
        setFormState((prev) => ({
          ...prev,
          tradeNumber: trade.tradeNumber,
          builderName: builderName || prev.builderName,
          amount: prefilled || prev.amount,
        }));
      }
    }, [trade, builderName, suggestedRepaymentAmount]);

    const handleInputChange = (e) => {
      const { name, value } = e.target;
      setFormState((prev) => ({ ...prev, [name]: value }));
    };

    const handleEFTClick = async () => {
      if (!trade) return;
      const amount = Number(formState.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error("Please enter a valid repayment amount.");
        return;
      }
      if (!formState.builderName?.trim()) {
        toast.error(
          "Builder name is required. Record Received From when finalizing the trade first.",
        );
        return;
      }

      const existingEFT = await checkCommissionTrustEFT(
        trade._id,
        "BuilderRepayment",
      );
      if (existingEFT.exists) {
        toast.error(
          `Builder repayment already completed for Trade #${trade.tradeNumber}!\nEFT #${existingEFT.eftNumber} was created on ${formatDate(existingEFT.date)}.`,
          { duration: 6000 },
        );
        setBuilderRepaymentEftCreated(true);
        return;
      }

      const tradeAddress = `${trade.keyInfo?.streetNumber || ""} ${
        trade.keyInfo?.streetName || ""
      }${trade.keyInfo?.unit ? ` ${trade.keyInfo.unit}` : ""}`.trim();
      const partyNames = getPartyNamesByDealType(trade);

      try {
        const eftResponse = await axiosInstance.post(
          "/commission-trust-eft/builder-repayment",
          {
            tradeId: trade._id,
            amount,
            builderName: formState.builderName.trim(),
            chequeDate: formState.chequeDate,
            notes: formState.noteOnStub,
          },
        );
        const eftNum = eftResponse.data.eftNumber;
        const paidTo =
          eftResponse.data.builderName || formState.builderName.trim();

        setEftReceiptData({
          eftNumber: eftNum,
          paidTo,
          trade: `${trade.tradeNumber} ${tradeAddress}`,
          notes: formState.noteOnStub || "Builder repayment",
          amount: String(amount),
          payTo: paidTo,
          orderOf: {
            streetNumber: formState.builderStreetNumber,
            streetName: formState.builderStreetName,
            unitNumber: formState.builderUnit,
            city: formState.builderCity,
            province: formState.builderProvince,
            postalCode: formState.builderPostalCode,
          },
          note: `${trade.tradeNumber} ${tradeAddress}`,
          chequeDate: formState.chequeDate,
          seller: partyNames.firstParty,
          buyer: partyNames.secondParty,
          firstPartyLabel: partyNames.firstPartyLabel,
          secondPartyLabel: partyNames.secondPartyLabel,
        });
        setIsOurBrokerageEFT(false);
        setShowEFTReceipt(true);
        setBuilderRepaymentEftCreated(true);
        toast.success(
          "Builder repayment posted to ledger and EFT created successfully!",
        );
      } catch (error) {
        console.error("Error creating builder repayment EFT:", error);
        toast.error(
          error.response?.data?.message ||
            "Failed to create builder repayment. Please try again.",
        );
      }
    };

    return (
      <div className="p-6 border border-gray-200 rounded-lg">
        <h3 className="font-semibold mb-4 text-lg">
          Builder Repayment Cheque Details
        </h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cheque Date
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="useCustomDateBuilder"
                checked={useCustomDate}
                onChange={(e) => setUseCustomDate(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label
                htmlFor="useCustomDateBuilder"
                className="text-sm text-gray-600"
              >
                Override Date
              </label>
            </div>
            {useCustomDate ? (
              <input
                type="date"
                name="chequeDate"
                value={
                  formState.chequeDate.includes("/")
                    ? (() => {
                        const [month, day, year] =
                          formState.chequeDate.split("/");
                        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
                      })()
                    : formState.chequeDate
                }
                onChange={(e) => {
                  const selectedDate = new Date(e.target.value + "T00:00:00");
                  const formattedDate = `${(selectedDate.getMonth() + 1)
                    .toString()
                    .padStart(2, "0")}/${selectedDate
                    .getDate()
                    .toString()
                    .padStart(2, "0")}/${selectedDate.getFullYear()}`;
                  setFormState((prev) => ({
                    ...prev,
                    chequeDate: formattedDate,
                  }));
                }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
              />
            ) : (
              <input
                type="text"
                name="chequeDate"
                value={formState.chequeDate}
                readOnly
                className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Bank Account
            </label>
            <input
              type="text"
              name="bankAccount"
              value={formState.bankAccount}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Trade #
            </label>
            <input
              type="text"
              name="tradeNumber"
              value={formState.tradeNumber}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Builder Name (finalize balance payment)
            </label>
            <input
              type="text"
              name="builderName"
              value={formState.builderName}
              readOnly
              className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Builder Street #
            </label>
            <input
              type="text"
              name="builderStreetNumber"
              value={formState.builderStreetNumber}
              onChange={handleInputChange}
              placeholder="Street #"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Builder Street Name
            </label>
            <input
              type="text"
              name="builderStreetName"
              value={formState.builderStreetName}
              onChange={handleInputChange}
              placeholder="Street name"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Builder Unit #
            </label>
            <input
              type="text"
              name="builderUnit"
              value={formState.builderUnit}
              onChange={handleInputChange}
              placeholder="Unit # (optional)"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Builder City
            </label>
            <input
              type="text"
              name="builderCity"
              value={formState.builderCity}
              onChange={handleInputChange}
              placeholder="City"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Builder Province
            </label>
            <input
              type="text"
              name="builderProvince"
              value={formState.builderProvince}
              onChange={handleInputChange}
              placeholder="Province"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Builder Postal Code
            </label>
            <input
              type="text"
              name="builderPostalCode"
              value={formState.builderPostalCode}
              onChange={handleInputChange}
              placeholder="Postal code"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Repayment Amount
            </label>
            <input
              type="number"
              name="amount"
              value={formState.amount}
              onChange={handleInputChange}
              min="0.01"
              step="0.01"
              placeholder="Enter amount"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
            {suggestedRepaymentAmount != null &&
              Number(suggestedRepaymentAmount) > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  Pre-filled from finalize balance payment (
                  {formatSuggestedAmount(suggestedRepaymentAmount)}). You may
                  change this amount.
                </p>
              )}
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">
              Note on Stub
            </label>
            <input
              type="text"
              name="noteOnStub"
              value={formState.noteOnStub}
              onChange={handleInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
        </div>
        <div className="flex space-x-4">
          <button
            type="button"
            onClick={handleEFTClick}
            disabled={eftBlocked}
            className={`py-2 px-6 rounded-md transition-colors ${
              eftBlocked
                ? "bg-gray-400 text-gray-600 cursor-not-allowed"
                : "bg-gray-200 text-black hover:bg-gray-300"
            }`}
          >
            {eftBlocked ? "EFT Created" : "E.F.T."}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600 transition-colors"
          >
            Exit
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <Navbar />
      <div className="flex">
        {/* Left Sidebar */}
        <FinanceSidebar />
        {/* Main Content */}
        <div className="flex-1 p-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">
              Commission Trust Payments
            </h2>

            {/* Secondary Horizontal Navbar */}
            <div className="bg-white py-4 border-b mb-6">
              <nav className="flex space-x-8">
                <button
                  className={`text-lg font-medium px-3 py-2 hover:text-blue-600 transition-colors ${
                    activeSection === "outside-brokers"
                      ? "text-blue-600 border-b-2 border-blue-600"
                      : "text-gray-500"
                  }`}
                  onClick={() => setActiveSection("outside-brokers")}
                >
                  Outside Brokers Commission Cheques
                </button>
                <button
                  className={`text-lg font-medium px-3 py-2 hover:text-blue-600 transition-colors ${
                    activeSection === "agent-commission"
                      ? "text-blue-600 border-b-2 border-blue-600"
                      : "text-gray-500"
                  }`}
                  onClick={() => setActiveSection("agent-commission")}
                >
                  Agent Commission Cheques
                </button>

                <button
                  className={`text-lg font-medium px-3 py-2 hover:text-blue-600 transition-colors ${
                    activeSection === "our-brokerage"
                      ? "text-blue-600 border-b-2 border-blue-600"
                      : "text-gray-500"
                  }`}
                  onClick={() => setActiveSection("our-brokerage")}
                >
                  Our Brokerage Commission
                </button>
                <button
                  className={`text-lg font-medium px-3 py-2 hover:text-blue-600 transition-colors ${
                    activeSection === "builder-repayment"
                      ? "text-blue-600 border-b-2 border-blue-600"
                      : "text-gray-500"
                  }`}
                  onClick={() => setActiveSection("builder-repayment")}
                >
                  Builder Repayment
                </button>
                <button
                  className={`text-lg font-medium px-3 py-2 hover:text-blue-600 transition-colors ${
                    activeSection === "general-to-commission"
                      ? "text-blue-600 border-b-2 border-blue-600"
                      : "text-gray-500"
                  }`}
                  onClick={() => setActiveSection("general-to-commission")}
                >
                  General to Commission
                </button>
              </nav>
            </div>

            {/* Outside Brokers Commission Cheques Form */}
            {activeSection === "outside-brokers" && (
              <div className="space-y-4">
                {!showOutsideBrokersDetailsForm ? (
                  <div className="p-6 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold mb-4 text-lg">
                      Outside Brokers Commission Transfer Form
                    </h3>
                    <form
                      onSubmit={handleOutsideBrokersSubmit}
                      className="space-y-4"
                    >
                      {/* Name */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Name
                        </label>
                        <input
                          type="text"
                          value={outsideBrokersForm.name}
                          readOnly
                          className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>

                      {/* Type */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Type
                        </label>
                        <input
                          type="text"
                          value={outsideBrokersForm.type}
                          readOnly
                          className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>

                      {/* Trade Number Search */}
                      <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Trade Number
                        </label>
                        <input
                          type="text"
                          value={outsideBrokersForm.tradeNumber}
                          onChange={(e) =>
                            handleOutsideBrokersTradeSearch(e.target.value)
                          }
                          placeholder="Search trade number or address..."
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />

                        {/* Dropdown for trade search results */}
                        {showTradeDropdown && filteredTrades.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                            {filteredTrades.map((trade) => {
                              const address = `${
                                trade.keyInfo?.streetNumber || ""
                              } ${trade.keyInfo?.streetName || ""}${
                                trade.keyInfo?.unit
                                  ? ` ${trade.keyInfo.unit}`
                                  : ""
                              }`.trim();
                              return (
                                <div
                                  key={trade._id}
                                  className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-200"
                                  onClick={() =>
                                    selectOutsideBrokersTrade(trade)
                                  }
                                >
                                  <div className="font-medium">
                                    Trade #{trade.tradeNumber}
                                  </div>
                                  <div className="text-sm text-gray-600">
                                    {address}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Outside Broker Checkboxes (includes referral agents from trade) */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Outside Broker
                          {getOutsideBrokersWithReferrals(
                            outsideBrokersForm.selectedTrade,
                          )?.length > 1
                            ? "s"
                            : ""}
                        </label>
                        {!outsideBrokersForm.selectedTrade ? (
                          <div className="text-sm text-gray-500 italic">
                            Select a trade first
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="border border-gray-300 rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                              {getOutsideBrokersWithReferrals(
                                outsideBrokersForm.selectedTrade,
                              )?.map((broker, index) => {
                                const brokerKey = getOutsideBrokerKey(broker);
                                const isSelected =
                                  outsideBrokersForm.selectedOutsideBrokers.some(
                                    (selected) =>
                                      getOutsideBrokerKey(selected) ===
                                      brokerKey,
                                  );
                                const isEftCreated =
                                  eftCreated.outsideBrokersCommission[
                                    brokerKey
                                  ] || false;
                                const displayName =
                                  broker.agentName ||
                                  `${broker.firstName || ""} ${broker.lastName || ""}`.trim();
                                const displayCompany = broker.company || "";

                                return (
                                  <div
                                    key={index}
                                    className="flex items-center space-x-2"
                                  >
                                    <input
                                      type="checkbox"
                                      id={`broker-${index}`}
                                      checked={isSelected}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setOutsideBrokersForm((prev) => {
                                            const alreadySelected =
                                              prev.selectedOutsideBrokers.some(
                                                (selected) =>
                                                  getOutsideBrokerKey(
                                                    selected,
                                                  ) === brokerKey,
                                              );

                                            if (alreadySelected) return prev;

                                            if (
                                              prev.selectedOutsideBrokers
                                                .length >= 5
                                            ) {
                                              toast.error(
                                                "You can select up to 5 outside brokers for EFT.",
                                              );
                                              return prev;
                                            }

                                            return {
                                              ...prev,
                                              selectedOutsideBrokers: [
                                                ...prev.selectedOutsideBrokers,
                                                broker,
                                              ],
                                            };
                                          });
                                        } else {
                                          setOutsideBrokersForm((prev) => ({
                                            ...prev,
                                            selectedOutsideBrokers:
                                              prev.selectedOutsideBrokers.filter(
                                                (b) =>
                                                  getOutsideBrokerKey(b) !==
                                                  brokerKey,
                                              ),
                                          }));
                                        }
                                      }}
                                      disabled={isEftCreated}
                                      className="rounded border-gray-300"
                                    />
                                    <label
                                      htmlFor={`broker-${index}`}
                                      className={`text-sm ${
                                        isEftCreated
                                          ? "text-gray-400 cursor-not-allowed"
                                          : "text-gray-700 cursor-pointer"
                                      }`}
                                    >
                                      {displayName} - {displayCompany}
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                            {(() => {
                              const outsideBrokersList =
                                getOutsideBrokersWithReferrals(
                                  outsideBrokersForm.selectedTrade,
                                ) || [];
                              const allEftsIssued =
                                outsideBrokersList.length > 0 &&
                                outsideBrokersList.every(
                                  (broker) =>
                                    eftCreated.outsideBrokersCommission[
                                      getOutsideBrokerKey(broker)
                                    ],
                                );
                              return allEftsIssued ? (
                                <p className="text-sm text-red-500 font-medium mt-1">
                                  (Payment Completed – all{" "}
                                  {outsideBrokersList.length} EFT(s) issued)
                                </p>
                              ) : null;
                            })()}
                          </div>
                        )}
                        {outsideBrokersForm.selectedOutsideBrokers.length >
                          0 && (
                          <div className="mt-2 text-sm text-blue-600">
                            {outsideBrokersForm.selectedOutsideBrokers.length}{" "}
                            broker(s) selected
                          </div>
                        )}
                        <div className="mt-1 text-xs text-gray-500">
                          You can issue up to 5 EFTs (select up to 5 brokers).
                        </div>
                      </div>

                      {/* Proceed Button */}
                      <div className="pt-4">
                        <button
                          type="submit"
                          className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Proceed
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <OutsideBrokersCommissionDetailsForm
                    trade={outsideBrokersForm.selectedTrade}
                    selectedOutsideBrokers={
                      outsideBrokersForm.selectedOutsideBrokers
                    }
                    currentBrokerIndex={currentBrokerIndex}
                    onNextBroker={() => {
                      if (
                        currentBrokerIndex <
                        outsideBrokersForm.selectedOutsideBrokers.length - 1
                      ) {
                        setCurrentBrokerIndex(currentBrokerIndex + 1);
                      }
                    }}
                    onBack={() => {
                      setShowOutsideBrokersDetailsForm(false);
                      setCurrentBrokerIndex(0);
                    }}
                    eftCreated={eftCreated.outsideBrokersCommission}
                  />
                )}
              </div>
            )}

            {/* Agent Commission Cheques Form */}
            {activeSection === "agent-commission" && (
              <div className="space-y-4">
                {!showDetailsForm ? (
                  <div className="p-6 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold mb-4 text-lg">
                      Agent Commission Transfer Form
                    </h3>
                    <form
                      onSubmit={handleAgentCommissionSubmit}
                      className="space-y-4"
                    >
                      {/* Name */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Name
                        </label>
                        <input
                          type="text"
                          value={agentCommissionForm.name}
                          readOnly
                          className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>

                      {/* Cheque Type */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Cheque Type
                        </label>
                        <input
                          type="text"
                          value={agentCommissionForm.chequeType}
                          readOnly
                          className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>

                      {/* Trade Number Search */}
                      <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Trade Number
                        </label>
                        <input
                          type="text"
                          value={agentCommissionForm.tradeNumber}
                          onChange={(e) =>
                            handleAgentCommissionTradeSearch(e.target.value)
                          }
                          placeholder="Search trade number or address..."
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />

                        {/* Dropdown for trade search results */}
                        {showTradeDropdown && filteredTrades.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                            {filteredTrades.map((trade) => {
                              const address = `${
                                trade.keyInfo?.streetNumber || ""
                              } ${trade.keyInfo?.streetName || ""}${
                                trade.keyInfo?.unit
                                  ? ` ${trade.keyInfo.unit}`
                                  : ""
                              }`.trim();
                              return (
                                <div
                                  key={trade._id}
                                  className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-200"
                                  onClick={() =>
                                    selectAgentCommissionTrade(trade)
                                  }
                                >
                                  <div className="font-medium">
                                    Trade #{trade.tradeNumber}
                                  </div>
                                  <div className="text-sm text-gray-600">
                                    {address}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Agent Number Dropdown */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Agent
                        </label>
                        <select
                          name="selectedAgentId"
                          value={agentCommissionForm.selectedAgentId}
                          onChange={(e) =>
                            setAgentCommissionForm((prev) => ({
                              ...prev,
                              selectedAgentId: e.target.value,
                            }))
                          }
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100"
                          required
                          disabled={!agentCommissionForm.selectedTrade}
                        >
                          <option value="" disabled>
                            {agentCommissionForm.selectedTrade
                              ? "Select an agent"
                              : "Select a trade first"}
                          </option>
                          {(() => {
                            const uniqueAgents = [];
                            const seenAgentIds = new Set();

                            agentCommissionForm.selectedTrade?.agentCommissionList?.forEach(
                              (agent) => {
                                const isReferral =
                                  (agent.classification || "").toUpperCase() ===
                                  "REFERRAL";
                                if (
                                  !isReferral &&
                                  !seenAgentIds.has(agent.agentId)
                                ) {
                                  seenAgentIds.add(agent.agentId);
                                  uniqueAgents.push(agent);
                                }
                              },
                            );

                            return uniqueAgents.map((agent, index) => (
                              <option key={index} value={agent.agentId}>
                                {agent.agentName} ({agent.agentId})
                              </option>
                            ));
                          })()}
                        </select>
                      </div>

                      {/* Proceed Button */}
                      <div className="pt-4">
                        <button
                          type="submit"
                          className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Proceed
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <AgentCommissionDetailsForm
                    trade={agentCommissionForm.selectedTrade}
                    selectedAgentId={agentCommissionForm.selectedAgentId}
                    onBack={() => setShowDetailsForm(false)}
                    eftCreatedForAgent={
                      eftCreated.agentCommission[
                        String(agentCommissionForm.selectedAgentId)
                      ] || false
                    }
                  />
                )}
              </div>
            )}

            {/* Our Brokerage Commission Section */}
            {activeSection === "our-brokerage" && (
              <div className="space-y-4">
                {!showOurBrokerageDetailsForm ? (
                  <div className="p-6 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold mb-4 text-lg">
                      Our Brokerage Commission Transfer Form
                    </h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (ourBrokerageForm.selectedTrade) {
                          setShowOurBrokerageDetailsForm(true);
                        } else {
                          alert("Please select a trade to proceed.");
                        }
                      }}
                      className="space-y-4"
                    >
                      {/* Trade Number Search */}
                      <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Trade Number
                        </label>
                        <input
                          type="text"
                          value={ourBrokerageForm.tradeNumber}
                          onChange={(e) =>
                            handleOurBrokerageTradeSearch(e.target.value)
                          }
                          placeholder="Search trade number or address..."
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                        {/* Dropdown for trade search results */}
                        {showTradeDropdown && filteredTrades.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                            {filteredTrades.map((trade) => {
                              const address = `${
                                trade.keyInfo?.streetNumber || ""
                              } ${trade.keyInfo?.streetName || ""}${
                                trade.keyInfo?.unit
                                  ? ` ${trade.keyInfo.unit}`
                                  : ""
                              }`.trim();
                              return (
                                <div
                                  key={trade._id}
                                  className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-200"
                                  onClick={() => selectOurBrokerageTrade(trade)}
                                >
                                  <div className="font-medium">
                                    Trade #{trade.tradeNumber}
                                  </div>
                                  <div className="text-sm text-gray-600">
                                    {address}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {/* Proceed Button */}
                      <div className="pt-4">
                        <button
                          type="submit"
                          className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Proceed
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <OurBrokerageCommissionDetailsForm
                    trade={ourBrokerageForm.selectedTrade}
                    onBack={() => setShowOurBrokerageDetailsForm(false)}
                    eftCreated={eftCreated.ourBrokerageCommission}
                  />
                )}
              </div>
            )}

            {activeSection === "builder-repayment" && (
              <div className="space-y-4">
                {!showBuilderRepaymentDetailsForm ? (
                  <div className="p-6 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold mb-4 text-lg">
                      Builder Repayment Transfer Form
                    </h3>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!builderRepaymentForm.selectedTrade) {
                          alert("Please select a trade to proceed.");
                          return;
                        }
                        if (!builderRepaymentForm.builderName?.trim()) {
                          toast.error(
                            "Builder name not found for this trade. Record Received From when finalizing the trade first.",
                          );
                          return;
                        }
                        const existingEFT = await checkCommissionTrustEFT(
                          builderRepaymentForm.selectedTrade._id,
                          "BuilderRepayment",
                        );
                        if (existingEFT.exists) {
                          toast.error(
                            `Builder repayment already completed for Trade #${builderRepaymentForm.selectedTrade.tradeNumber}!\nEFT #${existingEFT.eftNumber} was created on ${formatDate(existingEFT.date)}.`,
                            { duration: 6000 },
                          );
                          setBuilderRepaymentEftCreated(true);
                          return;
                        }
                        setShowBuilderRepaymentDetailsForm(true);
                      }}
                      className="space-y-4"
                    >
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Name
                        </label>
                        <input
                          type="text"
                          value={builderRepaymentForm.name}
                          readOnly
                          className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Type
                        </label>
                        <input
                          type="text"
                          value={builderRepaymentForm.type}
                          readOnly
                          className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
                        />
                      </div>
                      <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Trade Number
                        </label>
                        <input
                          type="text"
                          value={builderRepaymentForm.tradeNumber}
                          onChange={(e) =>
                            handleBuilderRepaymentTradeSearch(e.target.value)
                          }
                          placeholder="Search trade number or address..."
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                        {showTradeDropdown && filteredTrades.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                            {filteredTrades.map((trade) => {
                              const address = `${
                                trade.keyInfo?.streetNumber || ""
                              } ${trade.keyInfo?.streetName || ""}${
                                trade.keyInfo?.unit
                                  ? ` ${trade.keyInfo.unit}`
                                  : ""
                              }`.trim();
                              return (
                                <div
                                  key={trade._id}
                                  className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-200"
                                  onClick={() =>
                                    selectBuilderRepaymentTrade(trade)
                                  }
                                >
                                  <div className="font-medium">
                                    Trade #{trade.tradeNumber}
                                  </div>
                                  <div className="text-sm text-gray-600">
                                    {address}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Builder Name (finalize balance payment — Received
                          From)
                        </label>
                        <input
                          type="text"
                          value={builderRepaymentForm.builderName}
                          readOnly
                          placeholder="Select a trade to load builder name"
                          className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm"
                        />
                      </div>
                      <div className="pt-4">
                        <button
                          type="submit"
                          className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Proceed
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <BuilderRepaymentDetailsForm
                    trade={builderRepaymentForm.selectedTrade}
                    builderName={builderRepaymentForm.builderName}
                    suggestedRepaymentAmount={
                      builderRepaymentForm.suggestedRepaymentAmount
                    }
                    onBack={() => setShowBuilderRepaymentDetailsForm(false)}
                    eftCreated={builderRepaymentEftCreated}
                  />
                )}
              </div>
            )}

            {activeSection === "general-to-commission" && (
              <div className="space-y-4">
                {!showGeneralToCommissionDetailsForm ? (
                  <div className="p-6 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold mb-4 text-lg">
                      Commission Transfer — General to Commission Account
                    </h3>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!generalToCommissionForm.selectedTrade) {
                          alert("Please select a trade to proceed.");
                          return;
                        }
                        const existingEFT = await checkCommissionTrustEFT(
                          generalToCommissionForm.selectedTrade._id,
                          "GeneralToCommissionTransfer",
                        );
                        if (existingEFT.exists) {
                          toast.error(
                            `General to Commission transfer already completed for Trade #${generalToCommissionForm.selectedTrade.tradeNumber}!\nEFT #${existingEFT.eftNumber} was created on ${formatDate(existingEFT.date)}.`,
                            { duration: 6000 },
                          );
                          setGeneralToCommissionEftCreated(true);
                          return;
                        }
                        setShowGeneralToCommissionDetailsForm(true);
                      }}
                      className="space-y-4"
                    >
                      <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Trade Number
                        </label>
                        <input
                          type="text"
                          value={generalToCommissionForm.tradeNumber}
                          onChange={(e) =>
                            handleGeneralToCommissionTradeSearch(e.target.value)
                          }
                          placeholder="Search trade number or address..."
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                        {showTradeDropdown && filteredTrades.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                            {filteredTrades.map((trade) => {
                              const address = `${
                                trade.keyInfo?.streetNumber || ""
                              } ${trade.keyInfo?.streetName || ""}${
                                trade.keyInfo?.unit
                                  ? ` ${trade.keyInfo.unit}`
                                  : ""
                              }`.trim();
                              return (
                                <div
                                  key={trade._id}
                                  className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-200"
                                  onClick={() =>
                                    selectGeneralToCommissionTrade(trade)
                                  }
                                >
                                  <div className="font-medium">
                                    Trade #{trade.tradeNumber}
                                  </div>
                                  <div className="text-sm text-gray-600">
                                    {address}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="pt-4">
                        <button
                          type="submit"
                          className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Proceed
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <GeneralToCommissionDetailsForm
                    trade={generalToCommissionForm.selectedTrade}
                    onBack={() => setShowGeneralToCommissionDetailsForm(false)}
                    eftCreated={generalToCommissionEftCreated}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* EFT Receipt Modal */}
      {showEFTReceipt && eftReceiptData && (
        <EFTReceipt
          data={eftReceiptData}
          hideTradeSellerBuyer={isOurBrokerageEFT}
          onClose={() => {
            setShowEFTReceipt(false);
            setEftReceiptData(null);
            setEftNumber(null);
            setIsOurBrokerageEFT(false);
          }}
        />
      )}

      {/* EFT Receipt Modal for Outside Brokers Commission Cheques */}
      {showOutsideBrokersReceipt && outsideBrokersReceiptData && (
        <EFTReceipt
          data={outsideBrokersReceiptData}
          onClose={() => {
            setShowOutsideBrokersReceipt(false);
            setOutsideBrokersReceiptData(null);
          }}
        />
      )}
    </div>
  );
};

export default CommissionTrustPayments;
