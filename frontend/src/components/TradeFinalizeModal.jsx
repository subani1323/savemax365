import React, { useState, useEffect } from "react";

import { toast } from "react-toastify";

import axiosInstance from "../config/axios";

import { formatDate } from "../utils/eftUtils";
import { roundTo2 } from "../utils/numberUtils";
import {
  applyPennyBalanceTo21300,
  buildDepositShortfallLedgerEntries,
  buildSecondDepositLiabilityEntry,
  buildSecondDepositLiabilitySpread,
  buildTradeFinalizePreview,
  filterTrustDepositRowsForPrint,
  getTradeTotalCommissionAmount,
  sumLedgerRows,
} from "../utils/tradeFinalizePreview";
import { getTradeTaxRate } from "../constants/tax";
import {
  buildFeeTaxCreditEntries,
  getAgentFeeLedgerCredits,
} from "../utils/agentFeeTaxSplit";

const paymentTypes = ["EFT", "Cheque", "Wire", "Cash"];

const TradeFinalizeModal = ({ trade, onClose }) => {
  // Set finalizedDate to current date by default - use local date without timezone conversion

  const today = new Date();

  const todayStr = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  function formatDateToDDMMYYYY(dateStr) {
    if (!dateStr) return "";

    const [yyyy, mm, dd] = dateStr.split("-");

    return `${dd}/${mm}/${yyyy}`;
  }

  const [finalizedDate, setFinalizedDate] = useState(todayStr);

  const [closingDate, setClosingDate] = useState(
    trade?.keyInfo?.closeDate || ""
  );

  const [end, setEnd] = useState("");

  const [isFinalizing, setIsFinalizing] = useState(false);

  // New state for payment popup

  const [showPaymentPopup, setShowPaymentPopup] = useState(false);

  const [receivedFrom, setReceivedFrom] = useState("");

  const [paymentAmount, setPaymentAmount] = useState("");

  const [paymentType, setPaymentType] = useState(paymentTypes[0]);

  const [eftNumber, setEftNumber] = useState("");

  const [commissionTrustTransactions, setCommissionTrustTransactions] =
    useState([]);

  const [realEstateTrustTransactions, setRealEstateTrustTransactions] =
    useState([]);

  const [ledgerEntries, setLedgerEntries] = useState([]);

  const [fallenThru, setFallenThru] = useState(false);

  useEffect(() => {
    if (trade?._id) {
      axiosInstance

        .get(`/commission-trust-eft/trade/${trade._id}`)

        .then((res) => setCommissionTrustTransactions(res.data))

        .catch(() => setCommissionTrustTransactions([]));

      axiosInstance

        .get(`/real-estate-trust-eft/trade/${trade._id}`)

        .then((res) => setRealEstateTrustTransactions(res.data))

        .catch(() => setRealEstateTrustTransactions([]));

      axiosInstance

        .get(`/ledger?tradeId=${trade._id}`)

        .then((res) => setLedgerEntries(res.data))

        .catch(() => setLedgerEntries([]));
    }
  }, [trade?._id]);

  // Auto-set end value based on We Hold value

  useEffect(() => {
    if (getWeHoldValue() === "No") {
      setEnd("Selling Side");
    }
  }, [trade]);

  // Reset EFT number when trade changes

  useEffect(() => {
    setEftNumber("");
  }, [trade?._id]);

  // Helper functions to extract required fields

  const getDepositAmount = () => {
    const records = trade?.trustRecords || [];
    if (!records.length) return "-";

    const heldRecords = records.filter((r) => {
      const hold = String(r?.weHold || "Yes").trim().toLowerCase();
      return hold === "yes";
    });
    const toSum = heldRecords.length ? heldRecords : records;
    const total = toSum.reduce((sum, r) => {
      const n = parseFloat(r?.amount ?? r?.depositAmount ?? r?.payeeEntry?.amount);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);

    return total.toFixed(2);
  };

  // Helper to get 'We Hold' value from trust form

  const getWeHoldValue = () => {
    if (trade?.trustRecords && trade.trustRecords.length > 0) {
      return trade.trustRecords[0].weHold || "-";
    }

    return "-";
  };

  const getCommissionData = () => {
    // From commission income section under commission form

    const rows = trade?.commission?.commissionIncomeRows || [];

    // For each row, check if it is for Listing Side or Selling Side by 'end' or fallback to first row

    // If not present, fallback to first row for backward compatibility

    let listing = rows.find((r) => r.end === "Listing Side");

    let selling = rows.find((r) => r.end === "Selling Side");

    // If not found, try to use the first row for both

    if (!listing && rows.length > 0) listing = rows[0];

    if (!selling && rows.length > 0) selling = rows[0];

    return { listing, selling };
  };

  const getAgentCommissionData = () => {
    // From agent info section under trade info

    const agent = (trade?.agentCommissionList || [])[0] || {};

    return agent;
  };

  const getAgentCommissionDataList = () => {
    // From agent info section under trade info - return all agents

    return trade?.agentCommissionList || [];
  };

  const commissionData = getCommissionData();

  const agentData = getAgentCommissionData();

  const agentList = getAgentCommissionDataList();

  // Helper functions to get individual agent data

  const getAgent1Data = () => {
    return agentList[0] || {};
  };

  const getAgent2Data = () => {
    return agentList[1] || {};
  };

  // Get data for any agent by index (0-based); used for Agent 3, 4, etc.
  const getAgentData = (index) => {
    return agentList[index] || {};
  };

  // Helper to check if we should show dual agent fields (for journal/ledger logic - exactly 2)

  const shouldShowDualAgentFields = () => {
    const agentCount = agentList.length;

    return agentCount === 2;
  };

  // Show per-agent breakdown when there are 2 or more agents (for display)
  const shouldShowMultipleAgentFields = () => {
    return agentList.length >= 2;
  };

  // Helper to calculate tax and total

  const getCommissionAndTaxTotal = () => {
    let commission = 0;

    if (end === "Selling Side") {
      commission = parseFloat(commissionData.selling?.sellingAmount || 0);
    } else if (end === "Listing Side") {
      commission = parseFloat(commissionData.listing?.listingAmount || 0);
    }

    const tax = commission * 0.13;

    const total = commission + tax;

    return {
      commission: commission ? commission.toFixed(2) : "-",

      tax: commission ? tax.toFixed(2) : "-",

      total: commission ? total.toFixed(2) : "-",
    };
  };

  const { commission, tax, total } = getCommissionAndTaxTotal();

  // Helper to calculate total commission (Listing Amount + Selling Amount + Listing Tax + Selling Tax)

  const getTotalCommission = () => {
    const listingAmount = parseFloat(
      commissionData.listing?.listingAmount || 0
    );

    const sellingAmount = parseFloat(
      commissionData.selling?.sellingAmount || 0
    );

    const listingTax = parseFloat(commissionData.listing?.listingTax || 0);

    const sellingTax = parseFloat(commissionData.selling?.sellingTax || 0);

    const totalCommission =
      listingAmount + sellingAmount + listingTax + sellingTax;

    return totalCommission > 0 ? totalCommission.toFixed(2) : "-";
  };

  // Helper to calculate total buyer rebate from all agents

  const getTotalBuyerRebate = () => {
    const totalBuyerRebate = (trade.agentCommissionList || []).reduce(
      (total, agent) => {
        if (agent.buyerRebateIncluded === "yes" && agent.buyerRebateAmount) {
          return total + parseFloat(agent.buyerRebateAmount || 0);
        }

        return total;
      },

      0
    );

    return totalBuyerRebate > 0 ? totalBuyerRebate.toFixed(2) : "-";
  };

  // Helper to get the trade address

  const getTradeAddress = () => {
    const k = trade?.keyInfo || {};

    return `${k.streetNumber || ""} ${k.streetName || ""}`.trim();
  };

  // Helper to get listing broker's company name from outside brokers section

  const getListingBrokerCompanyName = () => {
    if (trade?.outsideBrokers && trade.outsideBrokers.length > 0) {
      // Find the listing broker

      const listingBroker = trade.outsideBrokers.find(
        (broker) =>
          broker.type === "Listing Broker" ||
          broker.end?.toLowerCase().includes("listing")
      );

      return listingBroker?.company || "";
    }

    return "";
  };

  // Helper to get selling amount + tax from commission income section

  const getSellingAmountAndTax = () => {
    const sellingAmount = parseFloat(
      commissionData.selling?.sellingAmount || 0
    );

    const sellingTax = parseFloat(commissionData.selling?.sellingTax || 0);

    return (sellingAmount + sellingTax).toFixed(2);
  };

  // Auto-populate payment popup fields when "We Hold" is "No" or when deposit is less than total commission

  useEffect(() => {
    if (showPaymentPopup) {
      const weHoldValue = getWeHoldValue();

      const depositAmount = parseFloat(getDepositAmount()) || 0;

      const totalCommission = parseFloat(getTotalCommission()) || 0;

      if (weHoldValue === "No") {
        // Auto-populate "Received From" with listing broker's company name

        const listingBrokerCompany = getListingBrokerCompanyName();

        if (listingBrokerCompany && !receivedFrom.trim()) {
          setReceivedFrom(listingBrokerCompany);
        }

        // Auto-populate "Amount" with selling amount + tax

        const sellingAmountAndTax = getSellingAmountAndTax();

        if (sellingAmountAndTax !== "0.00" && !paymentAmount.trim()) {
          setPaymentAmount(sellingAmountAndTax);
        }
      } else if (weHoldValue === "Yes" && totalCommission > depositAmount) {
        // When "We Hold" is "Yes" but deposit is less than total commission

        // Don't auto-populate "Received From" - let user type it

        // Auto-populate "Amount" with (Total Commission - Deposit Amount)

        const remainingAmount = (totalCommission - depositAmount).toFixed(2);

        if (remainingAmount !== "0.00" && !paymentAmount.trim()) {
          setPaymentAmount(remainingAmount);
        }
      }
    }
  }, [showPaymentPopup, trade, receivedFrom, paymentAmount]);

  // Update getTransactionDetails to remove the 21500 Commission Payable debit transaction

  const getTransactionDetails = () => {
    const address = getTradeAddress();

    const commissionDescription = `Trade #: ${trade.tradeNumber} - ${address}`;

    const commissionDate = finalizedDate;

    const closingDateForTransactions = closingDate || todayStr;
    // When on Co-operating side (Selling Side), payment-related 10004/12200 entries
    // should use the finalized date for Trial Balance posting.
    const isCoOperatingSide = end === "Selling Side";
    const paymentDateForTransactions = isCoOperatingSide
      ? commissionDate
      : closingDateForTransactions;

    console.log("=== getTransactionDetails - Date Assignment ===");

    console.log("Finalized Date (Blue section):", commissionDate);

    console.log("Closing Date (Red section):", closingDateForTransactions);

    const depositAmount = parseFloat(getDepositAmount()) || 0;

    // Handle multiple agents vs single agent scenarios

    let agentNet, agentCommission, agentHST, feesDeducted, taxOnFeesDeducted;

    if (shouldShowMultipleAgentFields()) {
      // For 2+ agents, sum up the values from all agents

      agentNet = agentList.reduce(
        (sum, a) => sum + parseFloat(a.netCommission || 0),
        0
      );
      agentCommission = agentList.reduce(
        (sum, a) => sum + parseFloat(a.amount || 0),
        0
      );
      agentHST = agentList.reduce(
        (sum, a) => sum + parseFloat(a.tax || 0),
        0
      );
      feesDeducted = agentList.reduce(
        (sum, a) => sum + parseFloat(a.feesDeducted || 0),
        0
      );
      taxOnFeesDeducted = agentList.reduce((sum, a) => {
        const tax = a.feesDeducted
          ? parseFloat(a.feesDeducted) * 0.13
          : 0;
        return sum + tax;
      }, 0);
    } else {
      // Single agent scenario

      agentNet = parseFloat(agentData.netCommission || 0);

      agentCommission = parseFloat(agentData.amount || 0);

      agentHST = parseFloat(agentData.tax || 0);

      feesDeducted = parseFloat(agentData.feesDeducted || 0);

      taxOnFeesDeducted =
        agentData.totalFees && agentData.feesDeducted
          ? parseFloat(agentData.totalFees) - parseFloat(agentData.feesDeducted)
          : 0;
    }

    const listingAmount = parseFloat(
      commissionData.listing?.listingAmount || 0
    );

    const listingTax = parseFloat(commissionData.listing?.listingTax || 0);

    const sellingAmount = parseFloat(
      commissionData.selling?.sellingAmount || 0
    );

    const sellingTax = parseFloat(commissionData.selling?.sellingTax || 0);

    const weHold = getWeHoldValue();

    const popupAmount = parseFloat(paymentAmount) || 0;

    const popupDescription = `Trade #: ${trade.tradeNumber} - Received From: ${receivedFrom}`;

    const popupDate = finalizedDate || todayStr;

    if (weHold === "Yes") {
      console.log("=== We Hold = Yes - Creating Transaction Preview ===");

      console.log(
        "Blue section (transactions 1-9) will use date:",

        commissionDate
      );

      console.log(
        "Red section (transactions 10-12) will use date:",

        closingDateForTransactions
      );

      let transactions = [];

      if (shouldShowMultipleAgentFields()) {
        // We Hold = Yes: use Listing Side order when classification is Listing Side (50100/23001 listing once only)
        const isListingSide = end === "Listing Side";
        if (isListingSide) {
          // Order: per agent (21500-c, 44100-c, 23001-c); 50100-d and 23001-d listing only once (with first agent); then 51100-d, 23001-d selling tax, 40100-c, 23000-c, 21300-d, 21300-c, 21100-c
          const perAgentEntries = [];
          for (let i = 0; i < agentList.length; i++) {
            const data = getAgentData(i);
            perAgentEntries.push(
              { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: parseFloat(data.netCommission || 0), description: commissionDescription, date: commissionDate }
            );
            if (i === 0) {
              perAgentEntries.push(
                { accountNumber: "50100", accountName: "Agent's Commission", debit: listingAmount, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: listingTax, credit: 0, description: commissionDescription, date: commissionDate }
              );
            }
            perAgentEntries.push(
              { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: parseFloat(data.feesDeducted || 0), description: commissionDescription, date: commissionDate },
              ...buildFeeTaxCreditEntries({ agent: data, taxRate: getTradeTaxRate(trade), description: commissionDescription, date: commissionDate })
            );
          }
          const afterAgentEntries = [
            { accountNumber: "51100", accountName: "Outside Broker Commission", debit: sellingAmount, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: sellingTax, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "40100", accountName: "Commission Income", debit: 0, credit: listingAmount + sellingAmount, description: commissionDescription, date: commissionDate },
            { accountNumber: "23000", accountName: "HST Collected", debit: 0, credit: listingTax + sellingTax, description: commissionDescription, date: commissionDate },
            { accountNumber: "21300", accountName: "Deposit Liability", debit: depositAmount, credit: 0, description: commissionDescription, date: commissionDate },
            ...buildSecondDepositLiabilitySpread(
              depositAmount,
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
              commissionDescription,
              commissionDate,
            ),
            { accountNumber: "21100", accountName: "Outside Broker Payable", debit: 0, credit: sellingAmount + sellingTax, description: commissionDescription, date: commissionDate },
          ];
          transactions = [...perAgentEntries, ...afterAgentEntries];
        } else {
          // Selling Side (or other): keep existing order
          const agent1Data = getAgent1Data();
          const baseTransactions = [
            { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: listingTax, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "51100", accountName: "Outside Broker Commission", debit: listingAmount, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "21100", accountName: "Outside Broker Payable", debit: 0, credit: sellingAmount + sellingTax, description: commissionDescription, date: commissionDate },
            ...buildSecondDepositLiabilitySpread(
              depositAmount,
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
              commissionDescription,
              commissionDate,
            ),
            { accountNumber: "21300", accountName: "Deposit Liability", debit: depositAmount, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "23000", accountName: "HST Collected", debit: 0, credit: listingTax + sellingTax, description: commissionDescription, date: commissionDate },
            { accountNumber: "40100", accountName: "Commission Income", debit: 0, credit: listingAmount + sellingAmount, description: commissionDescription, date: commissionDate },
            ...buildFeeTaxCreditEntries({ agent: agent1Data, taxRate: getTradeTaxRate(trade), description: commissionDescription, date: commissionDate }),
            { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: parseFloat(agent1Data.feesDeducted || 0), description: commissionDescription, date: commissionDate },
            { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: sellingTax, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "50100", accountName: "Agent's Commission", debit: sellingAmount, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: parseFloat(agent1Data.netCommission || 0), description: commissionDescription, date: commissionDate },
          ];
          const additionalAgentEntries = [];
          for (let i = 1; i < agentList.length; i++) {
            const data = getAgentData(i);
            additionalAgentEntries.push(
              { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: parseFloat(data.netCommission || 0), description: commissionDescription, date: commissionDate },
              { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: parseFloat(data.feesDeducted || 0), description: commissionDescription, date: commissionDate },
              ...buildFeeTaxCreditEntries({ agent: data, taxRate: getTradeTaxRate(trade), description: commissionDescription, date: commissionDate })
            );
          }
          transactions = [...baseTransactions, ...additionalAgentEntries];
        }
      } else {
        // Single agent
        if (weHold === "Yes" && end === "Listing Side") {
          // Listing Side + We Hold Yes: 21500-c, 50100-d, 23001-d, 44100-c, 23001-c, then 51100-d, 23001-d, 40100-c, 23000-c, 21300-d, 21300-c, 21100-c
          transactions = [
            { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: agentNet, description: commissionDescription, date: commissionDate },
            { accountNumber: "50100", accountName: "Agent's Commission", debit: listingAmount, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: listingTax, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: feesDeducted, description: commissionDescription, date: commissionDate },
            ...(shouldShowMultipleAgentFields()
                ? agentList.flatMap((a) =>
                    buildFeeTaxCreditEntries({
                      agent: a,
                      taxRate: getTradeTaxRate(trade),
                      description: commissionDescription,
                      date: commissionDate,
                    }),
                  )
                : buildFeeTaxCreditEntries({
                    agent: agentData,
                    taxRate: getTradeTaxRate(trade),
                    description: commissionDescription,
                    date: commissionDate,
                  })),
            { accountNumber: "51100", accountName: "Outside Broker Commission", debit: sellingAmount, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: sellingTax, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "40100", accountName: "Commission Income", debit: 0, credit: listingAmount + sellingAmount, description: commissionDescription, date: commissionDate },
            { accountNumber: "23000", accountName: "HST Collected", debit: 0, credit: listingTax + sellingTax, description: commissionDescription, date: commissionDate },
            { accountNumber: "21300", accountName: "Deposit Liability", debit: depositAmount, credit: 0, description: commissionDescription, date: commissionDate },
            ...buildSecondDepositLiabilitySpread(
              depositAmount,
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
              commissionDescription,
              commissionDate,
            ),
            { accountNumber: "21100", accountName: "Outside Broker Payable", debit: 0, credit: sellingAmount + sellingTax, description: commissionDescription, date: commissionDate },
          ];
        } else {
          // Single agent (existing logic for Selling Side or We Hold No)
          transactions = [
            { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: agentNet, description: commissionDescription, date: commissionDate },
            { accountNumber: "50100", accountName: "Agent's Commission", debit: listingAmount, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: agentHST, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: feesDeducted, description: commissionDescription, date: commissionDate },
            ...(shouldShowMultipleAgentFields()
                ? agentList.flatMap((a) =>
                    buildFeeTaxCreditEntries({
                      agent: a,
                      taxRate: getTradeTaxRate(trade),
                      description: commissionDescription,
                      date: commissionDate,
                    }),
                  )
                : buildFeeTaxCreditEntries({
                    agent: agentData,
                    taxRate: getTradeTaxRate(trade),
                    description: commissionDescription,
                    date: commissionDate,
                  })),
            { accountNumber: "40100", accountName: "Commission Income", debit: 0, credit: listingAmount + sellingAmount, description: commissionDescription, date: commissionDate },
            { accountNumber: "23000", accountName: "HST Collected", debit: 0, credit: listingTax + sellingTax, description: commissionDescription, date: commissionDate },
            { accountNumber: "21300", accountName: "Deposit Liability", debit: depositAmount, credit: 0, description: commissionDescription, date: commissionDate },
            ...buildSecondDepositLiabilitySpread(
              depositAmount,
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
              commissionDescription,
              commissionDate,
            ),
            { accountNumber: "21100", accountName: "Outside Broker Payable", debit: 0, credit: sellingAmount + sellingTax, description: commissionDescription, date: commissionDate },
            { accountNumber: "51100", accountName: "Outside Broker Commission", debit: sellingAmount, credit: 0, description: commissionDescription, date: commissionDate },
            { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: sellingTax, credit: 0, description: commissionDescription, date: commissionDate },
          ];
        }
      }

      const totalCommissionAmount = getTradeTotalCommissionAmount(
        listingAmount,
        sellingAmount,
        listingTax,
        sellingTax,
      );

      if (totalCommissionAmount > depositAmount) {
        const showPaymentClearing =
          !shouldShowMultipleAgentFields() || popupAmount > 0;
        transactions.push(
          ...buildDepositShortfallLedgerEntries({
            depositAmount,
            totalCommissionAmount,
            commissionDescription,
            commissionDate,
            closingDate: closingDateForTransactions,
            tradeNumber: trade.tradeNumber,
            address,
            receivedFrom,
            includePaymentClearing: showPaymentClearing,
            paymentAmount: popupAmount,
          }),
        );
      }

      return transactions;
    } else {
      // Old logic for We Hold = No

      const commission = getCommissionAndTaxTotal().commission;

      const tax = getCommissionAndTaxTotal().tax;

      const commissionTxns = [
        {
          accountNumber: "40100",

          accountName: "Commission Income",

          debit: 0,

          credit: parseFloat(commission),

          description: commissionDescription,

          date: commissionDate,
        },

        {
          accountNumber: "23001",

          accountName: "HST Input Tax Credit",

          debit: parseFloat(tax),

          credit: 0,

          description: commissionDescription,

          date: commissionDate,
        },

        {
          accountNumber: "23000",

          accountName: "HST Collected",

          debit: 0,

          credit: parseFloat(tax),

          description: commissionDescription,

          date: commissionDate,
        },

        {
          accountNumber: "50100",

          accountName: "Agent's Commission",

          debit: parseFloat(agentData.amount || 0),

          credit: 0,

          description: commissionDescription,

          date: commissionDate,
        },

        {
          accountNumber: "21500",

          accountName: "Commission Payable",

          debit: 0,

          credit: parseFloat(agentData.netCommission || 0),

          description: commissionDescription,

          date: commissionDate,
        },

        {
          accountNumber: "44100",

          accountName: "Fee Deducted Income",

          debit: 0,

          credit: parseFloat(agentData.feesDeducted || 0),

          description: commissionDescription,

          date: commissionDate,
        },

        ...buildFeeTaxCreditEntries({
          agent: agentData,
          taxRate: getTradeTaxRate(trade),
          description: commissionDescription,
          date: commissionDate,
        }),
      ];

      // Additional transactions for Agent 2, 3, 4... when We Hold = No
      if (shouldShowMultipleAgentFields()) {
        for (let i = 1; i < agentList.length; i++) {
          const data = getAgentData(i);
          commissionTxns.push({
            accountNumber: "50100",
            accountName: "Agent's Commission",
            debit: parseFloat(data.amount || 0),
            credit: 0,
            description: commissionDescription,
            date: commissionDate,
          });
          commissionTxns.push({
            accountNumber: "21500",
            accountName: "Commission Payable",
            debit: 0,
            credit: parseFloat(data.netCommission || 0),
            description: commissionDescription,
            date: commissionDate,
          });
          commissionTxns.push({
            accountNumber: "44100",
            accountName: "Fee Deducted Income",
            debit: 0,
            credit: parseFloat(data.feesDeducted || 0),
            description: commissionDescription,
            date: commissionDate,
          });
          commissionTxns.push(
            ...buildFeeTaxCreditEntries({
              agent: data,
              taxRate: getTradeTaxRate(trade),
              description: commissionDescription,
              date: commissionDate,
            }),
          );
        }
      }

      // Always include these three transactions if popupAmount > 0 (i.e., payment popup is open and filled)

      if (popupAmount > 0) {
        commissionTxns.push({
          accountNumber: "12200",

          accountName: "A/R - Commission From Deals",

          debit: popupAmount,

          credit: 0,

          description: commissionDescription,

          date: commissionDate,
        });

        commissionTxns.push({
          accountNumber: "10004",

          accountName: "Cash - Commission Trust Account",

          debit: popupAmount,

          credit: 0,

          description: popupDescription,

          date: paymentDateForTransactions,
        });

        commissionTxns.push({
          accountNumber: "12200",

          accountName: "A/R - Commission From Deals",

          debit: 0,

          credit: popupAmount,

          description: popupDescription,

          date: paymentDateForTransactions,
        });
      }

      return commissionTxns;
    }
  };

  // Update handleConfirmPayment to remove the 21500 Commission Payable debit transaction

  const handleConfirmPayment = async () => {
    // Check if trade is already finalized

    if (trade.isFinalized) {
      toast.error("This trade is already finalized.");

      return;
    }

    // Validate required fields

    if (!finalizedDate) {
      toast.error("Please enter the finalized date.");

      return;
    }

    // Validate closing date when We Hold = Yes

    const weHoldValue = getWeHoldValue();

    if (weHoldValue === "Yes" && !closingDate) {
      toast.error(
        "Please ensure the closing date is set when 'We Hold = Yes'."
      );

      return;
    }

    if (!receivedFrom.trim()) {
      toast.error("Please enter who the payment was received from.");

      return;
    }

    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      toast.error("Please enter a valid payment amount.");

      return;
    }

    // Validate EFT number when deposit amount is less than total commission

    const depositAmount = parseFloat(getDepositAmount()) || 0;

    const totalCommission = parseFloat(getTotalCommission()) || 0;

    if (totalCommission > depositAmount && !eftNumber) {
      toast.error(
        "EFT number is required when deposit amount is less than total commission."
      );

      return;
    }

    setIsFinalizing(true);

    try {
      const address = getTradeAddress();

      const commissionDescription = `Trade #: ${trade.tradeNumber} - ${address}`;

      const commissionDate = finalizedDate;

      const closingDateForTransactions = closingDate || todayStr;
      const isCoOperatingSide = end === "Selling Side";
      const paymentDateForTransactions = isCoOperatingSide
        ? commissionDate
        : closingDateForTransactions;

      const depositAmount = parseFloat(getDepositAmount()) || 0;

      // Handle multiple agents vs single agent scenarios

      let agentNet, agentCommission, agentHST, feesDeducted, taxOnFeesDeducted;

      if (shouldShowMultipleAgentFields()) {
        agentNet = agentList.reduce(
          (sum, a) => sum + parseFloat(a.netCommission || 0),
          0
        );
        agentCommission = agentList.reduce(
          (sum, a) => sum + parseFloat(a.amount || 0),
          0
        );
        agentHST = agentList.reduce(
          (sum, a) => sum + parseFloat(a.tax || 0),
          0
        );
        feesDeducted = agentList.reduce(
          (sum, a) => sum + parseFloat(a.feesDeducted || 0),
          0
        );
        taxOnFeesDeducted = agentList.reduce((sum, a) => {
          const tax = a.feesDeducted
            ? parseFloat(a.feesDeducted) * 0.13
            : 0;
          return sum + tax;
        }, 0);
      } else {
        // Single agent scenario

        agentNet = parseFloat(agentData.netCommission || 0);

        agentCommission = parseFloat(agentData.amount || 0);

        agentHST = parseFloat(agentData.tax || 0);

        feesDeducted = parseFloat(agentData.feesDeducted || 0);

        taxOnFeesDeducted =
          agentData.totalFees && agentData.feesDeducted
            ? parseFloat(agentData.totalFees) -
              parseFloat(agentData.feesDeducted)
            : 0;
      }

      const listingAmount = parseFloat(
        commissionData.listing?.listingAmount || 0
      );

      const listingTax = parseFloat(commissionData.listing?.listingTax || 0);

      const sellingAmount = parseFloat(
        commissionData.selling?.sellingAmount || 0
      );

      const sellingTax = parseFloat(commissionData.selling?.sellingTax || 0);

      const weHold = getWeHoldValue();

      if (weHold === "Yes") {
        console.log("=== WE HOLD = YES - Starting ledger transactions ===");

        console.log("Commission Description:", commissionDescription);

        console.log("Commission Date (Blue section):", commissionDate);

        console.log("Closing Date (Red section):", closingDateForTransactions);

        console.log("Trade Number:", trade.tradeNumber);

        console.log("Address:", address);

        // Updated logic for We Hold = Yes

        try {
          if (shouldShowMultipleAgentFields()) {
            console.log("=== POSTING MULTI-AGENT TRANSACTIONS (We Hold = Yes) ===");
            const isListingSide = end === "Listing Side";
            let multiAgentTransactions;
            if (isListingSide) {
              const perAgentEntries = [];
              for (let i = 0; i < agentList.length; i++) {
                const data = getAgentData(i);
                perAgentEntries.push(
                  { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: parseFloat(data.netCommission || 0), description: commissionDescription, date: commissionDate },
                  { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: parseFloat(data.feesDeducted || 0), description: commissionDescription, date: commissionDate },
                  ...buildFeeTaxCreditEntries({ agent: data, taxRate: getTradeTaxRate(trade), description: commissionDescription, date: commissionDate })
                );
                if (i === 0) {
                  perAgentEntries.push(
                    { accountNumber: "50100", accountName: "Agent's Commission", debit: listingAmount, credit: 0, description: commissionDescription, date: commissionDate },
                    { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: listingTax, credit: 0, description: commissionDescription, date: commissionDate }
                  );
                }
              }
              const afterAgentEntries = [
                { accountNumber: "51100", accountName: "Outside Broker Commission", debit: sellingAmount, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: sellingTax, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "40100", accountName: "Commission Income", debit: 0, credit: listingAmount + sellingAmount, description: commissionDescription, date: commissionDate },
                { accountNumber: "23000", accountName: "HST Collected", debit: 0, credit: listingTax + sellingTax, description: commissionDescription, date: commissionDate },
                { accountNumber: "21300", accountName: "Deposit Liability", debit: depositAmount, credit: 0, description: commissionDescription, date: commissionDate },
                ...buildSecondDepositLiabilitySpread(
              depositAmount,
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
              commissionDescription,
              commissionDate,
            ),
                { accountNumber: "21100", accountName: "Outside Broker Payable", debit: 0, credit: sellingAmount + sellingTax, description: commissionDescription, date: commissionDate },
              ];
              multiAgentTransactions = [...perAgentEntries, ...afterAgentEntries];
            } else {
              const agent1Data = getAgent1Data();
              const baseTransactions = [
                { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: listingTax, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "51100", accountName: "Outside Broker Commission", debit: listingAmount, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "21100", accountName: "Outside Broker Payable", debit: 0, credit: sellingAmount + sellingTax, description: commissionDescription, date: commissionDate },
                { accountNumber: "21300", accountName: "Deposit Liability", debit: depositAmount, credit: 0, description: commissionDescription, date: commissionDate },
                ...buildSecondDepositLiabilitySpread(
                  depositAmount,
                  listingAmount,
                  sellingAmount,
                  listingTax,
                  sellingTax,
                  commissionDescription,
                  commissionDate,
                ),
                { accountNumber: "23000", accountName: "HST Collected", debit: 0, credit: listingTax + sellingTax, description: commissionDescription, date: commissionDate },
                { accountNumber: "40100", accountName: "Commission Income", debit: 0, credit: listingAmount + sellingAmount, description: commissionDescription, date: commissionDate },
                ...buildFeeTaxCreditEntries({ agent: agent1Data, taxRate: getTradeTaxRate(trade), description: commissionDescription, date: commissionDate }),
                { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: parseFloat(agent1Data.feesDeducted || 0), description: commissionDescription, date: commissionDate },
                { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: sellingTax, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "50100", accountName: "Agent's Commission", debit: sellingAmount, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: parseFloat(agent1Data.netCommission || 0), description: commissionDescription, date: commissionDate },
              ];
              const additionalAgentEntries = [];
              for (let i = 1; i < agentList.length; i++) {
                const data = getAgentData(i);
                additionalAgentEntries.push(
                  { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: parseFloat(data.netCommission || 0), description: commissionDescription, date: commissionDate },
                  { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: parseFloat(data.feesDeducted || 0), description: commissionDescription, date: commissionDate },
                  ...buildFeeTaxCreditEntries({ agent: data, taxRate: getTradeTaxRate(trade), description: commissionDescription, date: commissionDate })
                );
              }
              multiAgentTransactions = [...baseTransactions, ...additionalAgentEntries];
            }

            for (let i = 0; i < multiAgentTransactions.length; i++) {
              const transaction = multiAgentTransactions[i];
              console.log(`Posting transaction ${i + 1}: ${transaction.accountNumber} - ${transaction.accountName} with date: ${transaction.date}`);
              await axiosInstance.post("/ledger", transaction);
              console.log(`Transaction ${i + 1} posted successfully`);
            }
            console.log("=== ALL MULTI-AGENT TRANSACTIONS POSTED SUCCESSFULLY ===");

            const multiTotalCommission = getTradeTotalCommissionAmount(
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
            );
            if (depositAmount < multiTotalCommission) {
              for (const tx of buildDepositShortfallLedgerEntries({
                depositAmount,
                totalCommissionAmount: multiTotalCommission,
                commissionDescription,
                commissionDate,
                closingDate: paymentDateForTransactions,
                tradeNumber: trade.tradeNumber,
                address,
                receivedFrom,
                mode: "accrual",
              })) {
                await axiosInstance.post("/ledger", tx);
              }
            }

            const popupAmount = parseFloat(paymentAmount) || 0;
            if (popupAmount > 0) {
              for (const tx of buildDepositShortfallLedgerEntries({
                depositAmount,
                totalCommissionAmount: multiTotalCommission,
                commissionDescription,
                commissionDate,
                closingDate: paymentDateForTransactions,
                tradeNumber: trade.tradeNumber,
                address,
                receivedFrom,
                includePaymentClearing: true,
                paymentAmount: popupAmount,
                mode: "clearing",
              })) {
                await axiosInstance.post("/ledger", {
                  ...tx,
                  eftNumber: eftNumber,
                  reference: `EFT#${eftNumber}`,
                });
              }
              console.log(
                "=== PAYMENT POPUP TRANSACTIONS POSTED SUCCESSFULLY ==="
              );
            }
          } else {
            // Single agent transactions
            if (end === "Listing Side") {
              console.log("=== POSTING SINGLE AGENT (Listing Side) TRANSACTIONS ===");
              const singleListingTransactions = [
                { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: agentNet, description: commissionDescription, date: commissionDate },
                { accountNumber: "50100", accountName: "Agent's Commission", debit: listingAmount, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: listingTax, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: feesDeducted, description: commissionDescription, date: commissionDate },
                ...(shouldShowMultipleAgentFields()
                ? agentList.flatMap((a) =>
                    buildFeeTaxCreditEntries({
                      agent: a,
                      taxRate: getTradeTaxRate(trade),
                      description: commissionDescription,
                      date: commissionDate,
                    }),
                  )
                : buildFeeTaxCreditEntries({
                    agent: agentData,
                    taxRate: getTradeTaxRate(trade),
                    description: commissionDescription,
                    date: commissionDate,
                  })),
                { accountNumber: "51100", accountName: "Outside Broker Commission", debit: sellingAmount, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: sellingTax, credit: 0, description: commissionDescription, date: commissionDate },
                { accountNumber: "40100", accountName: "Commission Income", debit: 0, credit: listingAmount + sellingAmount, description: commissionDescription, date: commissionDate },
                { accountNumber: "23000", accountName: "HST Collected", debit: 0, credit: listingTax + sellingTax, description: commissionDescription, date: commissionDate },
                { accountNumber: "21300", accountName: "Deposit Liability", debit: depositAmount, credit: 0, description: commissionDescription, date: commissionDate },
                ...buildSecondDepositLiabilitySpread(
              depositAmount,
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
              commissionDescription,
              commissionDate,
            ),
                { accountNumber: "21100", accountName: "Outside Broker Payable", debit: 0, credit: sellingAmount + sellingTax, description: commissionDescription, date: commissionDate },
              ];
              for (const tx of singleListingTransactions) {
                await axiosInstance.post("/ledger", tx);
              }
              const listingTotalCommission = getTradeTotalCommissionAmount(
                listingAmount,
                sellingAmount,
                listingTax,
                sellingTax,
              );
              if (depositAmount < listingTotalCommission) {
                for (const tx of buildDepositShortfallLedgerEntries({
                  depositAmount,
                  totalCommissionAmount: listingTotalCommission,
                  commissionDescription,
                  commissionDate,
                  closingDate: paymentDateForTransactions,
                  tradeNumber: trade.tradeNumber,
                  address,
                  receivedFrom,
                  mode: "accrual",
                })) {
                  await axiosInstance.post("/ledger", tx);
                }
              }
              const popupAmount = parseFloat(paymentAmount) || 0;
              if (popupAmount > 0) {
                for (const tx of buildDepositShortfallLedgerEntries({
                  depositAmount,
                  totalCommissionAmount: listingTotalCommission,
                  commissionDescription,
                  commissionDate,
                  closingDate: paymentDateForTransactions,
                  tradeNumber: trade.tradeNumber,
                  address,
                  receivedFrom,
                  includePaymentClearing: true,
                  paymentAmount: popupAmount,
                  mode: "clearing",
                })) {
                  await axiosInstance.post("/ledger", {
                    ...tx,
                    eftNumber: eftNumber,
                    reference: `EFT#${eftNumber}`,
                  });
                }
              }
            } else {
            console.log("=== POSTING SINGLE AGENT TRANSACTIONS ===");
            console.log("=== POSTING BLUE SECTION (Transactions 1-9) ===");
            console.log("Using finalized date for all blue section transactions:", commissionDate);

            await axiosInstance.post("/ledger", {
              accountNumber: "21500",
              accountName: "Commission Payable",
              debit: 0,
              credit: agentNet,
              description: commissionDescription,
              date: commissionDate,
            });

            // 2. Agent's Commission - 50100 - d (debit)
            console.log(
              "Posting transaction 2: 50100 - Agent's Commission (debit) with date:",
              commissionDate
            );
            await axiosInstance.post("/ledger", {
              accountNumber: "50100",
              accountName: "Agent's Commission",
              debit: listingAmount,
              credit: 0,
              description: commissionDescription,
              date: commissionDate,
            });

            // 3. HST Input Tax Credit - 23001 - d (debit)
            console.log(
              "Posting transaction 3: 23001 - HST Input Tax Credit (debit) with date:",
              commissionDate
            );
            await axiosInstance.post("/ledger", {
              accountNumber: "23001",
              accountName: "HST Input Tax Credit",
              debit: listingTax,
              credit: 0,
              description: commissionDescription,
              date: commissionDate,
            });

            // 4. Fee Deducted Income - 44100 - c (credit)
            console.log(
              "Posting transaction 4: 44100 - Fee Deducted Income (credit) with date:",
              commissionDate
            );
            await axiosInstance.post("/ledger", {
              accountNumber: "44100",
              accountName: "Fee Deducted Income",
              debit: 0,
              credit: feesDeducted,
              description: commissionDescription,
              date: commissionDate,
            });

            // 5. HST Input Tax Credit - 23001 - c (credit)
            console.log(
              "Posting transaction 5: 23001 - HST Input Tax Credit (credit) with date:",
              commissionDate
            );
            for (const feeTx of shouldShowMultipleAgentFields()
              ? agentList.flatMap((a) =>
                  buildFeeTaxCreditEntries({
                    agent: a,
                    taxRate: getTradeTaxRate(trade),
                    description: commissionDescription,
                    date: commissionDate,
                  }),
                )
              : buildFeeTaxCreditEntries({
                  agent: agentData,
                  taxRate: getTradeTaxRate(trade),
                  description: commissionDescription,
                  date: commissionDate,
                })) {
              await axiosInstance.post("/ledger", feeTx);
            }

            // 6. Commission Income - 40100 - c (credit)
            console.log(
              "Posting transaction 6: 40100 - Commission Income (credit) with date:",
              commissionDate
            );
            await axiosInstance.post("/ledger", {
              accountNumber: "40100",
              accountName: "Commission Income",
              debit: 0,
              credit: listingAmount + sellingAmount,
              description: commissionDescription,
              date: commissionDate,
            });

            // 7. HST Collected - 23000 - c (credit)
            console.log(
              "Posting transaction 7: 23000 - HST Collected (credit) with date:",
              commissionDate
            );
            await axiosInstance.post("/ledger", {
              accountNumber: "23000",
              accountName: "HST Collected",
              debit: 0,
              credit: listingTax + sellingTax,
              description: commissionDescription,
              date: commissionDate,
            });

            // 8. Deposit Liability - 21300 - d (debit)
            console.log(
              "Posting transaction 8: 21300 - Deposit Liability (debit) with date:",
              commissionDate
            );
            await axiosInstance.post("/ledger", {
              accountNumber: "21300",
              accountName: "Deposit Liability",
              debit: depositAmount,
              credit: 0,
              description: commissionDescription,
              date: commissionDate,
            });

            const totalCommissionAmount = getTradeTotalCommissionAmount(
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
            );
            const second21300 = buildSecondDepositLiabilityEntry(
              depositAmount,
              totalCommissionAmount,
              commissionDescription,
              commissionDate,
            );
            if (second21300) {
              console.log(
                "Posting transaction 9: 21300 - Deposit Liability (credit) with date:",
                commissionDate,
              );
              await axiosInstance.post("/ledger", second21300);
            } else if (depositAmount < totalCommissionAmount) {
              console.log(
                "Posting transaction 9: 12200 - A/R - Commission From Deals (debit) with date:",
                commissionDate,
              );
              for (const tx of buildDepositShortfallLedgerEntries({
                depositAmount,
                totalCommissionAmount,
                commissionDescription,
                commissionDate,
                closingDate: paymentDateForTransactions,
                tradeNumber: trade.tradeNumber,
                address,
                receivedFrom,
                mode: "accrual",
              })) {
                await axiosInstance.post("/ledger", tx);
              }
            }

            // Red marked section (last 3 transactions) - use finalized date
            console.log("=== POSTING RED SECTION (Transactions 10-12) ===");
            console.log(
              "Using finalized date for all red section transactions:",
              commissionDate
            );

            // 10. Outside Broker Payable - 21100 - c (credit)
            console.log(
              "Posting transaction 10: 21100 - Outside Broker Payable (credit) with date:",
              commissionDate
            );
            await axiosInstance.post("/ledger", {
              accountNumber: "21100",
              accountName: "Outside Broker Payable",
              debit: 0,
              credit: sellingAmount + sellingTax,
              description: commissionDescription,
              date: commissionDate,
            });

            // 11. Outside Broker Commission - 51100 - d (debit)
            console.log(
              "Posting transaction 11: 51100 - Outside Broker Commission (debit) with date:",
              commissionDate
            );
            await axiosInstance.post("/ledger", {
              accountNumber: "51100",
              accountName: "Outside Broker Commission",
              debit: sellingAmount,
              credit: 0,
              description: commissionDescription,
              date: commissionDate,
            });

            // 12. HST Input Tax Credit - 23001 - d (debit)
            console.log(
              "Posting transaction 12: 23001 - HST Input Tax Credit (debit) with date:",
              commissionDate
            );
            await axiosInstance.post("/ledger", {
              accountNumber: "23001",
              accountName: "HST Input Tax Credit",
              debit: sellingTax,
              credit: 0,
              description: commissionDescription,
              date: commissionDate,
            });

            if (depositAmount < totalCommissionAmount) {
              const shortfallAmount = roundTo2(
                totalCommissionAmount - depositAmount,
              );
              console.log(
                "Posting payment clearing: 10004 Dr / 12200 Cr with date:",
                paymentDateForTransactions,
              );
              for (const tx of buildDepositShortfallLedgerEntries({
                depositAmount,
                totalCommissionAmount,
                commissionDescription,
                commissionDate,
                closingDate: paymentDateForTransactions,
                tradeNumber: trade.tradeNumber,
                address,
                receivedFrom,
                includePaymentClearing: true,
                paymentAmount: shortfallAmount,
                mode: "clearing",
              })) {
                await axiosInstance.post("/ledger", {
                  ...tx,
                  eftNumber: eftNumber,
                  reference: `EFT#${eftNumber}`,
                });
              }
            }

            console.log(
              "=== ALL SINGLE AGENT TRANSACTIONS POSTED SUCCESSFULLY ==="
            );
            }
          }
        } catch (error) {
          console.error("Error posting We Hold = Yes transactions:", error);

          throw error; // Re-throw to be caught by the outer catch block
        }
      } else {
        // Logic for We Hold = No - Create transactions as specified

        const popupAmount = parseFloat(paymentAmount) || 0;

        const popupDescription = `Trade #: ${trade.tradeNumber} - Received From: ${receivedFrom}`;

        const popupDate = finalizedDate;

        // 1. Agent Commission - 40100 - c (credit)

        await axiosInstance.post("/ledger", {
          accountNumber: "40100",

          accountName: "Commission Income",

          debit: 0,

          credit: parseFloat(commission),

          description: commissionDescription,

          date: commissionDate,
        });

        // 2. Tax - 23001 - d (debit)

        await axiosInstance.post("/ledger", {
          accountNumber: "23001",

          accountName: "HST Input Tax Credit",

          debit: parseFloat(tax),

          credit: 0,

          description: commissionDescription,

          date: commissionDate,
        });

        // 3. Tax - 23000 - c (credit)

        await axiosInstance.post("/ledger", {
          accountNumber: "23000",

          accountName: "HST Collected",

          debit: 0,

          credit: parseFloat(tax),

          description: commissionDescription,

          date: commissionDate,
        });

        // 4. Agent Commission - 50100 - d (debit)

        await axiosInstance.post("/ledger", {
          accountNumber: "50100",

          accountName: "Agent's Commission",

          debit: parseFloat(agentData.amount || 0),

          credit: 0,

          description: commissionDescription,

          date: commissionDate,
        });

        // 5. Agent Net - 21500 - c (credit) - Fixed: should be credit, not debit

        await axiosInstance.post("/ledger", {
          accountNumber: "21500",

          accountName: "Commission Payable",

          debit: 0,

          credit: parseFloat(agentData.netCommission || 0),

          description: commissionDescription,

          date: commissionDate,
        });

        // 6. Fees Deducted - 44100 - c (credit)

        await axiosInstance.post("/ledger", {
          accountNumber: "44100",

          accountName: "Fee Deducted Income",

          debit: 0,

          credit: parseFloat(agentData.feesDeducted || 0),

          description: commissionDescription,

          date: commissionDate,
        });

        // 7. Tax For Deduction: plan HST → 23001; office expenses (incl. tax) → 12100

        for (const feeTx of buildFeeTaxCreditEntries({
          agent: agentData,
          taxRate: getTradeTaxRate(trade),
          description: commissionDescription,
          date: commissionDate,
        })) {
          await axiosInstance.post("/ledger", feeTx);
        }

        // Additional transactions for Agent 2, 3, 4... when We Hold = No (same as Agent 2)
        if (shouldShowMultipleAgentFields()) {
          for (let i = 1; i < agentList.length; i++) {
            const data = getAgentData(i);
            await axiosInstance.post("/ledger", {
              accountNumber: "50100",
              accountName: "Agent's Commission",
              debit: parseFloat(data.amount || 0),
              credit: 0,
              description: commissionDescription,
              date: commissionDate,
            });
            await axiosInstance.post("/ledger", {
              accountNumber: "21500",
              accountName: "Commission Payable",
              debit: 0,
              credit: parseFloat(data.netCommission || 0),
              description: commissionDescription,
              date: commissionDate,
            });
            await axiosInstance.post("/ledger", {
              accountNumber: "44100",
              accountName: "Fee Deducted Income",
              debit: 0,
              credit: parseFloat(data.feesDeducted || 0),
              description: commissionDescription,
              date: commissionDate,
            });
            for (const feeTx of buildFeeTaxCreditEntries({
              agent: data,
              taxRate: getTradeTaxRate(trade),
              description: commissionDescription,
              date: commissionDate,
            })) {
              await axiosInstance.post("/ledger", feeTx);
            }
          }
        }

        // 12. Total - 12200 - d (debit)

        if (popupAmount > 0) {
          await axiosInstance.post("/ledger", {
            accountNumber: "12200",

            accountName: "A/R - Commission From Deals",

            debit: popupAmount,

            credit: 0,

            description: commissionDescription,

            date: commissionDate,

            eftNumber: eftNumber,
          });
        }

        // 13. Amount(Confirm Payment Popup) - 10004 - d (debit)

        if (popupAmount > 0) {
          await axiosInstance.post("/ledger", {
            accountNumber: "10004",

            accountName: "Cash - Commission Trust Account",

            debit: popupAmount,

            credit: 0,

            description: popupDescription,

            date: paymentDateForTransactions,

            eftNumber: eftNumber,
          });
        }

        // 14. Amount (Confirm Payment Popup) - 12200 - c (credit)

        if (popupAmount > 0) {
          await axiosInstance.post("/ledger", {
            accountNumber: "12200",

            accountName: "A/R - Commission From Deals",

            debit: 0,

            credit: popupAmount,

            description: popupDescription,

            date: paymentDateForTransactions,

            eftNumber: eftNumber,
          });
        }

        // 15. Buyer Rebate - 52100 - c (credit) if there is any buyer rebate

        const totalBuyerRebate = parseFloat(getTotalBuyerRebate()) || 0;

        if (totalBuyerRebate > 0) {
          await axiosInstance.post("/ledger", {
            accountNumber: "52100",

            accountName: "Referral Fees",

            debit: 0,

            credit: totalBuyerRebate,

            description: `Trade #: ${trade.tradeNumber} - Buyer Rebate`,

            date: commissionDate,
          });
        }
      }

      // Additional transactions when Total Commission > Deposit Amount

      // Note: These transactions are already posted above in the main transaction block

      // No need to post them again here to avoid duplicates

      // The main transaction block already handles:

      // - 10004 - Cash - Commission Trust Account (debit) at line 738

      // - 12200 - A/R - Commission From Deals (credit) at line 752

      // Buyer rebate transaction is already posted above in the main transaction block

      // No need to post it again here to avoid duplicates

      // Finalize the trade after processing all transactions

      const response = await axiosInstance.post(
        `/trades/finalize/${trade.tradeNumber}`,

        { finalizedDate: finalizedDate }
      );

      if (response.data && response.data.success) {
        // Persist 4000-series Commission Received row for Trade Record Sheet CT Activity
        if (trade?._id && eftNumber && Number(paymentAmount) > 0 && receivedFrom) {
          try {
            await axiosInstance.post("/commission-trust-eft/finalize-trade-payment", {
              tradeId: trade._id,
              amount: paymentAmount,
              recipient: receivedFrom,
              eftNumber,
              chequeDate: finalizedDate,
            });
          } catch (metaErr) {
            console.warn(
              "Finalize ledger posted, but CommissionReceived EFT metadata was not saved:",
              metaErr,
            );
          }
        }

        toast.success("Trade finalized and posted to ledger successfully!");

        setShowPaymentPopup(false);

        setEftNumber(""); // Reset EFT number after successful payment

        if (onClose) onClose();

        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("refreshTrialBalance"));
        }
      } else {
        toast.error(response.data.message || "Failed to finalize trade.");
      }
    } catch (err) {
      toast.error("Error finalizing trade. Please try again.");
    } finally {
      setIsFinalizing(false);
    }
  };

  // This function now checks hold field and shows payment popup if needed

  const handleFinalizeTrade = async () => {
    if (trade.isFinalized) {
      toast.error("This trade is already finalized.");

      return;
    }

    // Validate finalized date

    if (!finalizedDate) {
      toast.error("Please enter the finalized date.");

      return;
    }

    // Validate closing date when We Hold = Yes

    const weHoldValue = getWeHoldValue();

    if (weHoldValue === "Yes" && !closingDate) {
      toast.error(
        "Please ensure the closing date is set when 'We Hold = Yes'."
      );

      return;
    }

    if (fallenThru) {
      // Mark trade as finalized but do not process any transactions or update Trial Balance

      try {
        const response = await axiosInstance.post(
          `/trades/finalize/${trade.tradeNumber}`,

          { fallenThru: true, finalizedDate: finalizedDate }
        );

        if (response.data && response.data.success) {
          toast.success(
            "Trade marked as Fallen Thru. No transactions processed."
          );

          setEftNumber(""); // Reset EFT number when marking as fallen thru

          if (onClose) onClose();
        } else {
          toast.error(
            response.data.message || "Failed to mark trade as Fallen Thru."
          );
        }
      } catch (error) {
        if (
          error.response &&
          error.response.data &&
          error.response.data.message
        ) {
          toast.error(error.response.data.message);
        } else {
          toast.error("An error occurred while marking trade as Fallen Thru.");
        }
      }

      return;
    }

    // Check if hold field is "NO" or if Total Commission is higher than Deposit - show payment popup

    const depositAmount = parseFloat(getDepositAmount()) || 0;

    const totalCommission = parseFloat(getTotalCommission()) || 0;

    if (weHoldValue === "No" || totalCommission > depositAmount) {
      // Generate new EFT number each time the popup is opened

      generateNextEFTNumber()
        .then((eftNumber) => {
          console.log("Generated EFT number:", eftNumber);
          setEftNumber(eftNumber);

          setShowPaymentPopup(true);
        })
        .catch((error) => {
          console.error("Error generating EFT number:", error);
          // Fallback to local generation
          const localEFTNumber = generateLocalEFTNumber();
          console.log("Using local EFT number:", localEFTNumber);
          setEftNumber(localEFTNumber);
          setShowPaymentPopup(true);
        });

      return;
    }

    // For "Yes" hold field, post all required transactions

    try {
      // --- BEGIN WE HOLD = YES LOGIC ---

      const address = getTradeAddress();

      const commissionDescription = `Trade #: ${trade.tradeNumber} - ${address}`;

      const commissionDate = finalizedDate;

      const closingDateForTransactions = closingDate || todayStr;
      const isCoOperatingSide = end === "Selling Side";
      const paymentDateForTransactions = isCoOperatingSide
        ? commissionDate
        : closingDateForTransactions;

      const depositAmount = parseFloat(getDepositAmount()) || 0;

      // Handle multiple agents vs single agent scenarios

      let agentNet, agentCommission, agentHST, feesDeducted, taxOnFeesDeducted;

      if (shouldShowMultipleAgentFields()) {
        agentNet = agentList.reduce(
          (sum, a) => sum + parseFloat(a.netCommission || 0),
          0
        );
        agentCommission = agentList.reduce(
          (sum, a) => sum + parseFloat(a.amount || 0),
          0
        );
        agentHST = agentList.reduce(
          (sum, a) => sum + parseFloat(a.tax || 0),
          0
        );
        feesDeducted = agentList.reduce(
          (sum, a) => sum + parseFloat(a.feesDeducted || 0),
          0
        );
        taxOnFeesDeducted = agentList.reduce((sum, a) => {
          const tax = a.feesDeducted
            ? parseFloat(a.feesDeducted) * 0.13
            : 0;
          return sum + tax;
        }, 0);
      } else {
        // Single agent scenario

        agentNet = parseFloat(agentData.netCommission || 0);

        agentCommission = parseFloat(agentData.amount || 0);

        agentHST = parseFloat(agentData.tax || 0);

        feesDeducted = parseFloat(agentData.feesDeducted || 0);

        taxOnFeesDeducted =
          agentData.totalFees && agentData.feesDeducted
            ? parseFloat(agentData.totalFees) -
              parseFloat(agentData.feesDeducted)
            : 0;
      }

      const listingAmount = parseFloat(
        commissionData.listing?.listingAmount || 0
      );

      const listingTax = parseFloat(commissionData.listing?.listingTax || 0);

      const sellingAmount = parseFloat(
        commissionData.selling?.sellingAmount || 0
      );

      const sellingTax = parseFloat(commissionData.selling?.sellingTax || 0);

      // Post all transactions for We Hold = Yes

      console.log("=== WE HOLD = YES - Starting ledger transactions ===");

      console.log("Commission Description:", commissionDescription);

      console.log("Commission Date (Blue section):", commissionDate);

      console.log("Closing Date (Red section):", closingDateForTransactions);

      console.log("Trade Number:", trade.tradeNumber);

      console.log("Address:", address);

      try {
        if (shouldShowMultipleAgentFields()) {
          console.log("=== POSTING MULTI-AGENT TRANSACTIONS (We Hold = Yes) ===");
          const isListingSide = end === "Listing Side";
          let multiAgentTransactions;
          if (isListingSide) {
            const perAgentEntries = [];
            for (let i = 0; i < agentList.length; i++) {
              const data = getAgentData(i);
              perAgentEntries.push(
                { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: parseFloat(data.netCommission || 0), description: commissionDescription, date: commissionDate },
                { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: parseFloat(data.feesDeducted || 0), description: commissionDescription, date: commissionDate },
                ...buildFeeTaxCreditEntries({ agent: data, taxRate: getTradeTaxRate(trade), description: commissionDescription, date: commissionDate })
              );
              if (i === 0) {
                perAgentEntries.push(
                  { accountNumber: "50100", accountName: "Agent's Commission", debit: listingAmount, credit: 0, description: commissionDescription, date: commissionDate },
                  { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: listingTax, credit: 0, description: commissionDescription, date: commissionDate }
                );
              }
            }
            const afterAgentEntries = [
              { accountNumber: "51100", accountName: "Outside Broker Commission", debit: sellingAmount, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: sellingTax, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "40100", accountName: "Commission Income", debit: 0, credit: listingAmount + sellingAmount, description: commissionDescription, date: commissionDate },
              { accountNumber: "23000", accountName: "HST Collected", debit: 0, credit: listingTax + sellingTax, description: commissionDescription, date: commissionDate },
              { accountNumber: "21300", accountName: "Deposit Liability", debit: depositAmount, credit: 0, description: commissionDescription, date: commissionDate },
              ...buildSecondDepositLiabilitySpread(
              depositAmount,
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
              commissionDescription,
              commissionDate,
            ),
              { accountNumber: "21100", accountName: "Outside Broker Payable", debit: 0, credit: sellingAmount + sellingTax, description: commissionDescription, date: commissionDate },
            ];
            multiAgentTransactions = [...perAgentEntries, ...afterAgentEntries];
          } else {
            const agent1Data = getAgent1Data();
            const baseTransactions = [
              { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: listingTax, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "51100", accountName: "Outside Broker Commission", debit: listingAmount, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "21100", accountName: "Outside Broker Payable", debit: 0, credit: sellingAmount + sellingTax, description: commissionDescription, date: commissionDate },
              ...buildSecondDepositLiabilitySpread(
              depositAmount,
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
              commissionDescription,
              commissionDate,
            ),
              { accountNumber: "21300", accountName: "Deposit Liability", debit: depositAmount, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "23000", accountName: "HST Collected", debit: 0, credit: listingTax + sellingTax, description: commissionDescription, date: commissionDate },
              { accountNumber: "40100", accountName: "Commission Income", debit: 0, credit: listingAmount + sellingAmount, description: commissionDescription, date: commissionDate },
              ...buildFeeTaxCreditEntries({ agent: agent1Data, taxRate: getTradeTaxRate(trade), description: commissionDescription, date: commissionDate }),
              { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: parseFloat(agent1Data.feesDeducted || 0), description: commissionDescription, date: commissionDate },
              { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: sellingTax, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "50100", accountName: "Agent's Commission", debit: sellingAmount, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: parseFloat(agent1Data.netCommission || 0), description: commissionDescription, date: commissionDate },
            ];
            const additionalAgentEntries = [];
            for (let i = 1; i < agentList.length; i++) {
              const data = getAgentData(i);
              additionalAgentEntries.push(
                { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: parseFloat(data.netCommission || 0), description: commissionDescription, date: commissionDate },
                { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: parseFloat(data.feesDeducted || 0), description: commissionDescription, date: commissionDate },
                ...buildFeeTaxCreditEntries({ agent: data, taxRate: getTradeTaxRate(trade), description: commissionDescription, date: commissionDate })
              );
            }
            multiAgentTransactions = [...baseTransactions, ...additionalAgentEntries];
          }

          for (let i = 0; i < multiAgentTransactions.length; i++) {
            const transaction = multiAgentTransactions[i];
            console.log(`Posting transaction ${i + 1}: ${transaction.accountNumber} - ${transaction.accountName} with date: ${transaction.date}`);
            await axiosInstance.post("/ledger", transaction);
            console.log(`Transaction ${i + 1} posted successfully`);
          }
          console.log("=== ALL MULTI-AGENT TRANSACTIONS POSTED SUCCESSFULLY ===");

          const finalizeMultiTotal = getTradeTotalCommissionAmount(
            listingAmount,
            sellingAmount,
            listingTax,
            sellingTax,
          );
          if (depositAmount < finalizeMultiTotal) {
            for (const tx of buildDepositShortfallLedgerEntries({
              depositAmount,
              totalCommissionAmount: finalizeMultiTotal,
              commissionDescription,
              commissionDate,
              closingDate: paymentDateForTransactions,
              tradeNumber: trade.tradeNumber,
              address,
              receivedFrom,
              mode: "accrual",
            })) {
              await axiosInstance.post("/ledger", tx);
            }
          }
          const popupAmount = parseFloat(paymentAmount) || 0;
          if (popupAmount > 0) {
            for (const tx of buildDepositShortfallLedgerEntries({
              depositAmount,
              totalCommissionAmount: finalizeMultiTotal,
              commissionDescription,
              commissionDate,
              closingDate: paymentDateForTransactions,
              tradeNumber: trade.tradeNumber,
              address,
              receivedFrom,
              includePaymentClearing: true,
              paymentAmount: popupAmount,
              mode: "clearing",
            })) {
              await axiosInstance.post("/ledger", {
                ...tx,
                eftNumber: eftNumber,
                reference: `EFT#${eftNumber}`,
              });
            }
            console.log("=== PAYMENT POPUP TRANSACTIONS POSTED SUCCESSFULLY ===");
          }
        } else {
          // Single agent transactions
          if (end === "Listing Side") {
            console.log("=== POSTING SINGLE AGENT (Listing Side) TRANSACTIONS ===");
            const singleListingTransactions = [
              { accountNumber: "21500", accountName: "Commission Payable", debit: 0, credit: agentNet, description: commissionDescription, date: commissionDate },
              { accountNumber: "50100", accountName: "Agent's Commission", debit: listingAmount, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: listingTax, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "44100", accountName: "Fee Deducted Income", debit: 0, credit: feesDeducted, description: commissionDescription, date: commissionDate },
              ...(shouldShowMultipleAgentFields()
                ? agentList.flatMap((a) =>
                    buildFeeTaxCreditEntries({
                      agent: a,
                      taxRate: getTradeTaxRate(trade),
                      description: commissionDescription,
                      date: commissionDate,
                    }),
                  )
                : buildFeeTaxCreditEntries({
                    agent: agentData,
                    taxRate: getTradeTaxRate(trade),
                    description: commissionDescription,
                    date: commissionDate,
                  })),
              { accountNumber: "51100", accountName: "Outside Broker Commission", debit: sellingAmount, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "23001", accountName: "HST Input Tax Credit", debit: sellingTax, credit: 0, description: commissionDescription, date: commissionDate },
              { accountNumber: "40100", accountName: "Commission Income", debit: 0, credit: listingAmount + sellingAmount, description: commissionDescription, date: commissionDate },
              { accountNumber: "23000", accountName: "HST Collected", debit: 0, credit: listingTax + sellingTax, description: commissionDescription, date: commissionDate },
              { accountNumber: "21300", accountName: "Deposit Liability", debit: depositAmount, credit: 0, description: commissionDescription, date: commissionDate },
              ...buildSecondDepositLiabilitySpread(
              depositAmount,
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
              commissionDescription,
              commissionDate,
            ),
              { accountNumber: "21100", accountName: "Outside Broker Payable", debit: 0, credit: sellingAmount + sellingTax, description: commissionDescription, date: commissionDate },
            ];
            for (const tx of singleListingTransactions) {
              await axiosInstance.post("/ledger", tx);
            }
            const finalizeListingTotal = getTradeTotalCommissionAmount(
              listingAmount,
              sellingAmount,
              listingTax,
              sellingTax,
            );
            if (depositAmount < finalizeListingTotal) {
              for (const tx of buildDepositShortfallLedgerEntries({
                depositAmount,
                totalCommissionAmount: finalizeListingTotal,
                commissionDescription,
                commissionDate,
                closingDate: paymentDateForTransactions,
                tradeNumber: trade.tradeNumber,
                address,
                receivedFrom,
                mode: "accrual",
              })) {
                await axiosInstance.post("/ledger", tx);
              }
            }
            const popupAmount = parseFloat(paymentAmount) || 0;
            if (popupAmount > 0) {
              for (const tx of buildDepositShortfallLedgerEntries({
                depositAmount,
                totalCommissionAmount: finalizeListingTotal,
                commissionDescription,
                commissionDate,
                closingDate: paymentDateForTransactions,
                tradeNumber: trade.tradeNumber,
                address,
                receivedFrom,
                includePaymentClearing: true,
                paymentAmount: popupAmount,
                mode: "clearing",
              })) {
                await axiosInstance.post("/ledger", {
                  ...tx,
                  eftNumber: eftNumber,
                  reference: `EFT#${eftNumber}`,
                });
              }
            }
          } else {
          console.log("=== POSTING SINGLE AGENT TRANSACTIONS ===");
          console.log("=== POSTING BLUE SECTION (Transactions 1-9) ===");
          console.log("Using finalized date for all blue section transactions:", commissionDate);

          await axiosInstance.post("/ledger", {
            accountNumber: "21500",
            accountName: "Commission Payable",
            debit: 0,
            credit: agentNet,
            description: commissionDescription,
            date: commissionDate,
          });

          await axiosInstance.post("/ledger", {
            accountNumber: "50100",
            accountName: "Agent's Commission",
            debit: listingAmount,
            credit: 0,
            description: commissionDescription,
            date: commissionDate,
          });

          // 3. HST Input Tax Credit - 23001 - d (debit)
          console.log(
            "Posting transaction 3: 23001 - HST Input Tax Credit (debit) with date:",
            commissionDate
          );
          await axiosInstance.post("/ledger", {
            accountNumber: "23001",
            accountName: "HST Input Tax Credit",
            debit: listingTax,
            credit: 0,
            description: commissionDescription,
            date: commissionDate,
          });

          // 4. Fee Deducted Income - 44100 - c (credit)
          console.log(
            "Posting transaction 4: 44100 - Fee Deducted Income (credit) with date:",
            commissionDate
          );
          await axiosInstance.post("/ledger", {
            accountNumber: "44100",
            accountName: "Fee Deducted Income",
            debit: 0,
            credit: feesDeducted,
            description: commissionDescription,
            date: commissionDate,
          });

          // 5. HST Input Tax Credit - 23001 - c (credit)
          console.log(
            "Posting transaction 5: 23001 - HST Input Tax Credit (credit) with date:",
            commissionDate
          );
          for (const feeTx of shouldShowMultipleAgentFields()
              ? agentList.flatMap((a) =>
                  buildFeeTaxCreditEntries({
                    agent: a,
                    taxRate: getTradeTaxRate(trade),
                    description: commissionDescription,
                    date: commissionDate,
                  }),
                )
              : buildFeeTaxCreditEntries({
                  agent: agentData,
                  taxRate: getTradeTaxRate(trade),
                  description: commissionDescription,
                  date: commissionDate,
                })) {
              await axiosInstance.post("/ledger", feeTx);
            }

          // 6. Commission Income - 40100 - c (credit)
          console.log(
            "Posting transaction 6: 40100 - Commission Income (credit) with date:",
            commissionDate
          );
          await axiosInstance.post("/ledger", {
            accountNumber: "40100",
            accountName: "Commission Income",
            debit: 0,
            credit: listingAmount + sellingAmount,
            description: commissionDescription,
            date: commissionDate,
          });

          // 7. HST Collected - 23000 - c (credit)
          console.log(
            "Posting transaction 7: 23000 - HST Collected (credit) with date:",
            commissionDate
          );
          await axiosInstance.post("/ledger", {
            accountNumber: "23000",
            accountName: "HST Collected",
            debit: 0,
            credit: listingTax + sellingTax,
            description: commissionDescription,
            date: commissionDate,
          });

          // 8. Deposit Liability - 21300 - d (debit)
          console.log(
            "Posting transaction 8: 21300 - Deposit Liability (debit) with date:",
            commissionDate
          );
          await axiosInstance.post("/ledger", {
            accountNumber: "21300",
            accountName: "Deposit Liability",
            debit: depositAmount,
            credit: 0,
            description: commissionDescription,
            date: commissionDate,
          });

          const finalizeTotalCommission = getTradeTotalCommissionAmount(
            listingAmount,
            sellingAmount,
            listingTax,
            sellingTax,
          );
          const finalizeSecond21300 = buildSecondDepositLiabilityEntry(
            depositAmount,
            finalizeTotalCommission,
            commissionDescription,
            commissionDate,
          );
          if (finalizeSecond21300) {
            console.log(
              "Posting transaction 9: 21300 - Deposit Liability (credit) with date:",
              commissionDate,
            );
            await axiosInstance.post("/ledger", finalizeSecond21300);
          } else if (depositAmount < finalizeTotalCommission) {
            for (const tx of buildDepositShortfallLedgerEntries({
              depositAmount,
              totalCommissionAmount: finalizeTotalCommission,
              commissionDescription,
              commissionDate,
              closingDate: paymentDateForTransactions,
              tradeNumber: trade.tradeNumber,
              address,
              receivedFrom,
              mode: "accrual",
            })) {
              await axiosInstance.post("/ledger", tx);
            }
          }

          // Red marked section (last 3 transactions) - use finalized date
          console.log("=== POSTING RED SECTION (Transactions 10-12) ===");
          console.log(
            "Using finalized date for all red section transactions:",
            commissionDate
          );

          // 10. Outside Broker Payable - 21100 - c (credit)
          console.log(
            "Posting transaction 10: 21100 - Outside Broker Payable (credit) with date:",
            commissionDate
          );
          await axiosInstance.post("/ledger", {
            accountNumber: "21100",
            accountName: "Outside Broker Payable",
            debit: 0,
            credit: sellingAmount + sellingTax,
            description: commissionDescription,
            date: commissionDate,
          });

          // 11. Outside Broker Commission - 51100 - d (debit)
          console.log(
            "Posting transaction 11: 51100 - Outside Broker Commission (debit) with date:",
            commissionDate
          );
          await axiosInstance.post("/ledger", {
            accountNumber: "51100",
            accountName: "Outside Broker Commission",
            debit: sellingAmount,
            credit: 0,
            description: commissionDescription,
            date: commissionDate,
          });

          // 12. HST Input Tax Credit - 23001 - d (debit)
          console.log(
            "Posting transaction 12: 23001 - HST Input Tax Credit (debit) with date:",
            commissionDate
          );
          await axiosInstance.post("/ledger", {
            accountNumber: "23001",
            accountName: "HST Input Tax Credit",
            debit: sellingTax,
            credit: 0,
            description: commissionDescription,
            date: commissionDate,
          });

          if (depositAmount < finalizeTotalCommission) {
            const shortfallAmount = roundTo2(
              finalizeTotalCommission - depositAmount,
            );
            for (const tx of buildDepositShortfallLedgerEntries({
              depositAmount,
              totalCommissionAmount: finalizeTotalCommission,
              commissionDescription,
              commissionDate,
              closingDate: paymentDateForTransactions,
              tradeNumber: trade.tradeNumber,
              address,
              receivedFrom,
              includePaymentClearing: true,
              paymentAmount: shortfallAmount,
              mode: "clearing",
            })) {
              await axiosInstance.post("/ledger", {
                ...tx,
                eftNumber: eftNumber,
                reference: `EFT#${eftNumber}`,
              });
            }
          }

          console.log(
            "=== ALL SINGLE AGENT TRANSACTIONS POSTED SUCCESSFULLY ==="
          );
          }
        }
      } catch (error) {
        console.error("Error posting We Hold = Yes transactions:", error);

        throw error; // Re-throw to be caught by the outer catch block
      }

      // Finalize the trade after processing all transactions

      const response = await axiosInstance.post(
        `/trades/finalize/${trade.tradeNumber}`,

        { finalizedDate: finalizedDate }
      );

      if (response.data && response.data.success) {
        toast.success("Trade finalized and posted to ledger successfully!");

        setEftNumber(""); // Reset EFT number after successful finalization

        if (onClose) onClose();

        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("refreshTrialBalance"));
        }
      } else {
        toast.error(response.data.message || "Failed to finalize trade.");
      }
    } catch (error) {
      if (
        error.response &&
        error.response.data &&
        error.response.data.message
      ) {
        toast.error(error.response.data.message);
      } else {
        toast.error("An error occurred while finalizing the trade.");
      }
    }
  };

  // Helper to get ledger entries for a given EFT number

  const getLedgerEntriesForEFT = (eftNumber) => {
    return ledgerEntries.filter(
      (entry) => String(entry.eftNumber) === String(eftNumber)
    );
  };

  // Function to generate next EFT number

  const generateNextEFTNumber = async () => {
    try {
      const response = await axiosInstance.get("/eft/next-number");

      if (response.data && response.data.eftNumber) {
        return response.data.eftNumber;
      }

      // Fallback to local generation if backend fails

      return generateLocalEFTNumber();
    } catch (error) {
      console.error("Error getting next EFT number from backend:", error);

      // Fallback to local generation if backend fails

      return generateLocalEFTNumber();
    }
  };

  // Fallback local EFT number generation

  const generateLocalEFTNumber = () => {
    // Get all existing EFT numbers from ledger entries

    const existingEFTNumbers = ledgerEntries

      .filter((entry) => entry.eftNumber && entry.eftNumber.startsWith("EFT"))

      .map((entry) => {
        const match = entry.eftNumber.match(/EFT(\d+)/);

        return match ? parseInt(match[1]) : 0;
      })

      .sort((a, b) => b - a);

    // Start from 300 if no existing numbers, otherwise increment the highest

    const nextNumber =
      existingEFTNumbers.length > 0 ? Math.max(...existingEFTNumbers) + 1 : 4000;

    return nextNumber;
  };

  // When Confirm Payment popup opens and EFT# is needed, ensure we have a value to show
  useEffect(() => {
    if (
      showPaymentPopup &&
      (parseFloat(getDepositAmount()) || 0) <
        (parseFloat(getTotalCommission()) || 0) &&
      !eftNumber
    ) {
      const local = generateLocalEFTNumber();
      if (local != null && local !== "") {
        setEftNumber(String(local));
      }
    }
  }, [showPaymentPopup, eftNumber]);

  const buildPrintLedgerTableRows = (rows, includeReference = false) =>
    rows
      .map(
        (row) => `
        <tr>
          <td style="border: 1px solid #000; padding: 8px; min-width: 120px; width: 120px;">${formatDate(
            row.date || row.chequeDate || finalizedDate || todayStr,
          )}</td>
          <td style="border: 1px solid #000; padding: 8px;">${
            row.accountNumber || ""
          }</td>
          <td style="border: 1px solid #000; padding: 8px;">${
            row.accountName || ""
          }</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
            row.debit ? Number(row.debit).toFixed(2) : ""
          }</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
            row.credit ? Number(row.credit).toFixed(2) : ""
          }</td>
          <td style="border: 1px solid #000; padding: 8px;">${
            row.description || ""
          }</td>
          ${
            includeReference
              ? `<td style="border: 1px solid #000; padding: 8px;">${
                  row.eftNumber
                    ? String(row.eftNumber).match(/^\d+$/)
                      ? `EFT#${row.eftNumber}`
                      : row.eftNumber
                    : ""
                }</td>`
              : ""
          }
        </tr>
      `,
      )
      .join("");

  // Print handler

  const handlePrintDetails = () => {
    const {
      details,
      finalizeReversalRows,
      commissionReversalRows,
      postFinalizeActivityRows,
      suppressFinalizeReversalTable,
    } = buildTradeFinalizePreview({
      trade,
      ledgerEntries,
      isFinalized: trade.isFinalized,
      getTransactionDetails,
    });

    const { totalDebit, totalCredit, closingBalance } =
      applyPennyBalanceTo21300(details);

    const finalizeReversalTotals = sumLedgerRows(finalizeReversalRows);
    const finalizeReversalTableRows = buildPrintLedgerTableRows(
      finalizeReversalRows,
      true,
    );

    const commissionReversalTotals = sumLedgerRows(commissionReversalRows);
    const commissionReversalTableRows = buildPrintLedgerTableRows(
      commissionReversalRows,
      true,
    );

    const postFinalizeTotals = sumLedgerRows(postFinalizeActivityRows);
    const postFinalizeTableRows = buildPrintLedgerTableRows(
      postFinalizeActivityRows,
      true,
    );

    const trustDepositRowsFiltered = filterTrustDepositRowsForPrint(
      ledgerEntries,
      trade.tradeNumber,
    );

    const trustDepositRows = trustDepositRowsFiltered

      .map(
        (row) => `

        <tr>

          <td style="border: 1px solid #000; padding: 8px; min-width: 120px; width: 120px;">${formatDate(
            row.date || finalizedDate || todayStr
          )}</td>

          <td style="border: 1px solid #000; padding: 8px;">${
            row.accountNumber || ""
          }</td>

          <td style="border: 1px solid #000; padding: 8px;">${
            row.accountName || ""
          }</td>

          <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
            row.debit ? Number(row.debit).toFixed(2) : ""
          }</td>

          <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
            row.credit ? Number(row.credit).toFixed(2) : ""
          }</td>

          <td style="border: 1px solid #000; padding: 8px;">${
            row.description || ""
          }</td>

        </tr>

      `
      )

      .join("");

    let trustDepositDebit = 0;

    let trustDepositCredit = 0;

    trustDepositRowsFiltered.forEach((row) => {
      trustDepositDebit += Number(row.debit) || 0;

      trustDepositCredit += Number(row.credit) || 0;
    });

    const trustDepositClosing = (
      trustDepositCredit - trustDepositDebit
    ).toFixed(2);

    // Commission Trust Payments: show ledger entries for each EFT

    let commissionTrustDebit = 0;

    let commissionTrustCredit = 0;

    const commissionTrustRows = commissionTrustTransactions

      .map((eft) => {
        const entries = getLedgerEntriesForEFT(eft.eftNumber);

        if (!entries.length) return "";

        return entries

          .map((row) => {
            commissionTrustDebit += Number(row.debit) || 0;

            commissionTrustCredit += Number(row.credit) || 0;

            // Use the date from the ledger entry (trial balance) instead of EFT date

            const transactionDate =
              row.chequeDate ||
              row.date ||
              eft.date ||
              finalizedDate ||
              todayStr;

            return `

          <tr>

            <td style="border: 1px solid #000; padding: 8px; min-width: 120px; width: 120px;">${formatDate(
              transactionDate
            )}</td>

            <td style="border: 1px solid #000; padding: 8px;">${
              row.accountNumber || ""
            }</td>

            <td style="border: 1px solid #000; padding: 8px;">${
              row.accountName || ""
            }</td>

            <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
              row.debit ? Number(row.debit).toFixed(2) : ""
            }</td>

            <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
              row.credit ? Number(row.credit).toFixed(2) : ""
            }</td>

            <td style="border: 1px solid #000; padding: 8px;">${
              row.description || ""
            }</td>

            <td style="border: 1px solid #000; padding: 8px;">${
              eft.eftNumber || ""
            }</td>

          </tr>

        `;
          })

          .join("");
      })

      .join("");

    const commissionTrustClosing = (
      commissionTrustCredit - commissionTrustDebit
    ).toFixed(2);

    // Real Estate Trust Payments: show ledger entries for each EFT

    let realEstateTrustDebit = 0;

    let realEstateTrustCredit = 0;

    const realEstateTrustRows = realEstateTrustTransactions

      .map((eft) => {
        const entries = getLedgerEntriesForEFT(eft.eftNumber).filter(
          (row) =>
            row.description &&
            row.description.includes(`Trade #: ${trade.tradeNumber}`)
        );

        const eftDate = eft.date ? eft.date : finalizedDate || todayStr;

        // If this EFT is a Commission Transfer, generate 10004/10002 rows

        if (eft.type === "CommissionTransfer") {
          // Add to totals

          if (eft.amount) {
            realEstateTrustDebit += Number(eft.amount) || 0;

            realEstateTrustCredit += Number(eft.amount) || 0;
          }

          return [
            `<tr>

              <td style="border: 1px solid #000; padding: 8px; min-width: 120px; width: 120px;">${formatDate(
                eftDate
              )}</td>

              <td style="border: 1px solid #000; padding: 8px;">10004</td>

              <td style="border: 1px solid #000; padding: 8px;">CASH - COMMISSION TRUST ACCOUNT</td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
                eft.amount ? Number(eft.amount).toFixed(2) : ""
              }</td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;"></td>

              <td style="border: 1px solid #000; padding: 8px;">Commission Transfer for Trade #: ${
                trade.tradeNumber
              }</td>

              <td style="border: 1px solid #000; padding: 8px;">${
                eft.eftNumber || ""
              }</td>

            </tr>`,

            `<tr>

              <td style="border: 1px solid #000; padding: 8px; min-width: 120px; width: 120px;">${formatDate(
                eftDate
              )}</td>

              <td style="border: 1px solid #000; padding: 8px;">10002</td>

              <td style="border: 1px solid #000; padding: 8px;">CASH - TRUST</td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;"></td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
                eft.amount ? Number(eft.amount).toFixed(2) : ""
              }</td>

              <td style="border: 1px solid #000; padding: 8px;">Commission Transfer for Trade #: ${
                trade.tradeNumber
              }</td>

              <td style="border: 1px solid #000; padding: 8px;">${
                eft.eftNumber || ""
              }</td>

            </tr>`,
          ].join("");
        }

        // Otherwise, render as before (Balance of Deposit, etc)

        entries.forEach((row) => {
          realEstateTrustDebit += Number(row.debit) || 0;

          realEstateTrustCredit += Number(row.credit) || 0;
        });

        return entries

          .map((row) => {
            // Use the date from the ledger entry (trial balance) instead of EFT date

            const transactionDate = row.chequeDate || row.date || eftDate;

            return `

          <tr>

            <td style="border: 1px solid #000; padding: 8px; min-width: 120px; width: 120px;">${formatDate(
              transactionDate
            )}</td>

            <td style="border: 1px solid #000; padding: 8px;">${
              row.accountNumber || ""
            }</td>

            <td style="border: 1px solid #000; padding: 8px;">${
              row.accountName || ""
            }</td>

            <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
              row.debit ? Number(row.debit).toFixed(2) : ""
            }</td>

            <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
              row.credit ? Number(row.credit).toFixed(2) : ""
            }</td>

            <td style="border: 1px solid #000; padding: 8px;">${
              row.description || ""
            }</td>

            <td style="border: 1px solid #000; padding: 8px;">${
              eft.eftNumber || ""
            }</td>

          </tr>

        `;
          })

          .join("");
      })

      .join("");

    const realEstateTrustClosing = (
      realEstateTrustCredit - realEstateTrustDebit
    ).toFixed(2);

    // Get address details for header

    const k = trade?.keyInfo || {};

    const address = `${k.streetNumber || ""} ${k.streetName || ""}`.trim();

    const postal = k.postalCode || "";

    const city = k.city || "";

    const province = k.province || "";

    const printWindow = window.open("", "", "width=900,height=700");

    const html = `

      <html>

      <head>

        <title>Transaction Details</title>

        <style>

          body { font-family: Arial, sans-serif; margin: 40px; font-size: 13px; }

          h2 { margin-bottom: 20px; }

          h3 { margin-top: 30px; margin-bottom: 10px; font-size: 15px; }

          .header { margin-bottom: 30px; }

          .header div { margin-bottom: 2px; }

          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; font-size: 12px; }

          th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }

          th { background: #f5f5f5; }

          @media print { .no-print { display: none !important; } }

        </style>

      </head>

      <body>

        <div class="header">

          <div><b>SAVEMAX 365 REALTY</b></div>

          <div>Trade #: ${trade.tradeNumber}</div>

          <div>${address}${
      address && (city || province || postal) ? "," : ""
    } ${city}${city && province ? "," : ""} ${province} ${postal}</div>

        </div>

        <h2>Transaction Details for Trade #${trade.tradeNumber}</h2>

        <table style="width: 100%; border-collapse: collapse;">

          <thead>

            <tr>

              <th style="border: 1px solid #000; padding: 8px; text-align: left; min-width: 120px; width: 120px;">Date</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Number</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Name</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Debit</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Credit</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Description</th>

            </tr>

          </thead>

          <tbody>

            ${details

              .map((row, index) => {
                return `

                  <tr>

                    <td style="border: 1px solid #000; padding: 8px; min-width: 120px; width: 120px;">${
                      row.date || finalizedDate || todayStr
                    }</td>

                    <td style="border: 1px solid #000; padding: 8px;">${
                      row.accountNumber
                    }</td>

                    <td style="border: 1px solid #000; padding: 8px;">${
                      row.accountName
                    }</td>

                    <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
                      row.debit !== 0 ? row.debit.toFixed(2) : ""
                    }</td>

                    <td style="border: 1px solid #000; padding: 8px; text-align: right;">${
                      row.credit !== 0 ? row.credit.toFixed(2) : ""
                    }</td>

                    <td style="border: 1px solid #000; padding: 8px;">${
                      row.description
                    }</td>

                  </tr>

                `;
              })

              .join("")}

          </tbody>

          <tfoot>

            <tr>

              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Total</b></td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${totalDebit.toFixed(
                2
              )}</b></td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${totalCredit.toFixed(
                2
              )}</b></td>

              <td style="border: 1px solid #000; padding: 8px;"></td>

            </tr>

            <tr>

              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Net (Credit - Debit)</b></td>

              <td colspan="3" style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${closingBalance}</b></td>

            </tr>

          </tfoot>

        </table>

        ${
          postFinalizeTableRows
            ? `<h3>Builder Repayment, General to Commission Transfer &amp; Commission Recall</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="border: 1px solid #000; padding: 8px; text-align: left; min-width: 120px; width: 120px;">Date</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Number</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Name</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Debit</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Credit</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Description</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Reference</th>
            </tr>
          </thead>
          <tbody>
            ${postFinalizeTableRows}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Total</b></td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${postFinalizeTotals.debit.toFixed(
                2,
              )}</b></td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${postFinalizeTotals.credit.toFixed(
                2,
              )}</b></td>
              <td colspan="2" style="border: 1px solid #000; padding: 8px;"></td>
            </tr>
            <tr>
              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Net (Credit - Debit)</b></td>
              <td colspan="4" style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${postFinalizeTotals.net}</b></td>
            </tr>
          </tfoot>
        </table>`
            : ""
        }

        ${
          commissionReversalTableRows
            ? `<h3>Commission Reversals</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="border: 1px solid #000; padding: 8px; text-align: left; min-width: 120px; width: 120px;">Date</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Number</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Name</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Debit</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Credit</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Description</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Reference</th>
            </tr>
          </thead>
          <tbody>
            ${commissionReversalTableRows}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Total</b></td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${commissionReversalTotals.debit.toFixed(
                2,
              )}</b></td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${commissionReversalTotals.credit.toFixed(
                2,
              )}</b></td>
              <td colspan="2" style="border: 1px solid #000; padding: 8px;"></td>
            </tr>
            <tr>
              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Net (Credit - Debit)</b></td>
              <td colspan="4" style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${commissionReversalTotals.net}</b></td>
            </tr>
          </tfoot>
        </table>`
            : ""
        }

        ${
          finalizeReversalTableRows && !suppressFinalizeReversalTable
            ? `<h3>Reversal Transactions</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="border: 1px solid #000; padding: 8px; text-align: left; min-width: 120px; width: 120px;">Date</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Number</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Name</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Debit</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Credit</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Description</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Reference</th>
            </tr>
          </thead>
          <tbody>
            ${finalizeReversalTableRows}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Total</b></td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${finalizeReversalTotals.debit.toFixed(
                2,
              )}</b></td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${finalizeReversalTotals.credit.toFixed(
                2,
              )}</b></td>
              <td colspan="2" style="border: 1px solid #000; padding: 8px;"></td>
            </tr>
            <tr>
              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Net (Credit - Debit)</b></td>
              <td colspan="4" style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${finalizeReversalTotals.net}</b></td>
            </tr>
          </tfoot>
        </table>`
            : ""
        }

        ${
          trustDepositRows || commissionTrustRows || realEstateTrustRows
            ? `<div style="page-break-inside: avoid;">

                ${
                  trustDepositRows
                    ? `<h3>Trust Deposit Transactions</h3>

        <table style="width: 100%; border-collapse: collapse;">

          <thead>

            <tr>

              <th style="border: 1px solid #000; padding: 8px; text-align: left; min-width: 120px; width: 120px;">Date</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Number</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Name</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Debit</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Credit</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Description</th>

            </tr>

          </thead>

          <tbody>

            ${trustDepositRows}

          </tbody>

          <tfoot>

            <tr>

              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Total</b></td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${trustDepositDebit.toFixed(
                2
              )}</b></td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${trustDepositCredit.toFixed(
                2
              )}</b></td>

              <td style="border: 1px solid #000; padding: 8px;"></td>

            </tr>

            <tr>

              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Net (Credit - Debit)</b></td>

              <td colspan="3" style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${trustDepositClosing}</b></td>

            </tr>

          </tfoot>

        </table>`
                    : ""
                }

                ${
                  commissionTrustRows
                    ? `<h3>Commission Trust Payments</h3>

        <table style="width: 100%; border-collapse: collapse;">

          <thead>

            <tr>

              <th style="border: 1px solid #000; padding: 8px; text-align: left; min-width: 120px; width: 120px;">Date</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Number</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Name</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Debit</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Credit</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Description</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">EFT #</th>

            </tr>

          </thead>

          <tbody>

            ${commissionTrustRows}

          </tbody>

          <tfoot>

            <tr>

              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Total</b></td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${commissionTrustDebit.toFixed(
                2
              )}</b></td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${commissionTrustCredit.toFixed(
                2
              )}</b></td>

              <td colspan="2" style="border: 1px solid #000; padding: 8px;"></td>

            </tr>

            <tr>

              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Net (Credit - Debit)</b></td>

              <td colspan="4" style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${commissionTrustClosing}</b></td>

            </tr>

          </tfoot>

        </table>`
                    : ""
                }

                ${
                  realEstateTrustRows
                    ? `<h3>Real Estate Trust Payments</h3>

        <table style="width: 100%; border-collapse: collapse;">

          <thead>

            <tr>

              <th style="border: 1px solid #000; padding: 8px; text-align: left; min-width: 120px; width: 120px;">Date</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Number</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Account Name</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Debit</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: right;">Credit</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">Description</th>

              <th style="border: 1px solid #000; padding: 8px; text-align: left;">EFT #</th>

            </tr>

          </thead>

          <tbody>

            ${realEstateTrustRows}

          </tbody>

          <tfoot>

            <tr>

              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Total</b></td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${realEstateTrustDebit.toFixed(
                2
              )}</b></td>

              <td style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${realEstateTrustCredit.toFixed(
                2
              )}</b></td>

              <td colspan="2" style="border: 1px solid #000; padding: 8px;"></td>

            </tr>

            <tr>

              <td colspan="3" style="border: 1px solid #000; padding: 8px;"><b>Net (Credit - Debit)</b></td>

              <td colspan="4" style="border: 1px solid #000; padding: 8px; text-align: right;"><b>${realEstateTrustClosing}</b></td>

            </tr>

          </tfoot>

        </table>`
                    : ""
                }

              </div>`
            : ""
        }

        <button onclick="window.print()" class="no-print" style="padding:10px 20px;font-size:16px;">Print</button>

      </body>

      </html>

    `;

    printWindow.document.write(html);

    printWindow.document.close();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          className="absolute top-2 right-2 text-gray-500 hover:text-gray-800 text-2xl"
          onClick={() => {
            setEftNumber(""); // Reset EFT number when closing modal

            if (onClose) onClose();
          }}
        >
          &times;
        </button>

        <h2 className="text-xl font-bold mb-4">Finalize Trade</h2>

        {getWeHoldValue() === "Yes" ? (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block font-medium mb-1">Finalized Date</label>

              <input
                type="date"
                className="border rounded px-2 py-1 w-full"
                value={finalizedDate}
                onChange={(e) => setFinalizedDate(e.target.value)}
              />
            </div>

            <div>
              <label className="block font-medium mb-1">Closing Date</label>

              <div
                className={`border rounded px-2 py-1 ${
                  !closingDate && getWeHoldValue() === "Yes"
                    ? "bg-red-50 border-red-300"
                    : "bg-gray-50"
                }`}
              >
                {formatDateToDDMMYYYY(closingDate)}
              </div>

              {!closingDate && getWeHoldValue() === "Yes" && (
                <p className="text-red-500 text-xs mt-1">
                  Closing date is required when We Hold = Yes
                </p>
              )}
            </div>

            <div>
              <label className="block font-medium mb-1">Deposit Amount</label>

              <div className="border rounded px-2 py-1 bg-gray-50">
                {getDepositAmount()}
              </div>
            </div>

            <div>
              <label className="block font-medium mb-1">We Hold</label>

              <div className="border rounded px-2 py-1 bg-gray-50">
                {getWeHoldValue()}
              </div>
            </div>

            {shouldShowMultipleAgentFields() ? (
              <>
                {agentList.map((agent, index) => {
                  const agentNum = index + 1;
                  const data = getAgentData(index);
                  const taxOnFees = getAgentFeeLedgerCredits(
                    data,
                    getTradeTaxRate(trade),
                  ).taxForDeductionDisplay.toFixed(2);
                  return (
                    <React.Fragment key={`agent-summary-${index}`}>
                      <div>
                        <label className="block font-medium mb-1">
                          Agent {agentNum} Commission
                        </label>
                        <div className="border rounded px-2 py-1 bg-gray-50">
                          {data.amount || "-"}
                        </div>
                      </div>
                      <div>
                        <label className="block font-medium mb-1">
                          Agent {agentNum} Net Commission
                        </label>
                        <div className="border rounded px-2 py-1 bg-gray-50">
                          {data.netCommission || "-"}
                        </div>
                      </div>
                      <div>
                        <label className="block font-medium mb-1">
                          Agent {agentNum} HST Amount
                        </label>
                        <div className="border rounded px-2 py-1 bg-gray-50">
                          {data.tax || "-"}
                        </div>
                      </div>
                      <div>
                        <label className="block font-medium mb-1">
                          Agent {agentNum} Fees Deducted
                        </label>
                        <div className="border rounded px-2 py-1 bg-gray-50">
                          {data.feesDeducted || "-"}
                        </div>
                      </div>
                      <div>
                        <label className="block font-medium mb-1">
                          Agent {agentNum} Tax on Fees Deducted
                        </label>
                        <div className="border rounded px-2 py-1 bg-gray-50">
                          {taxOnFees}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                <div>
                  <label className="block font-medium mb-1">
                    Listing Amount
                  </label>
                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {commissionData.listing?.listingAmount || "-"}
                  </div>
                </div>
                <div>
                  <label className="block font-medium mb-1">Listing Tax</label>
                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {commissionData.listing?.listingTax || "-"}
                  </div>
                </div>
                <div>
                  <label className="block font-medium mb-1">
                    Selling Amount
                  </label>
                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {commissionData.selling?.sellingAmount || "-"}
                  </div>
                </div>
                <div>
                  <label className="block font-medium mb-1">Selling Tax</label>
                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {commissionData.selling?.sellingTax || "-"}
                  </div>
                </div>
                <div>
                  <label className="block font-medium mb-1">
                    Total Commission
                  </label>
                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {getTotalCommission()}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block font-medium mb-1">
                    Agent Commission
                  </label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {agentData.amount || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">Agent Net</label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {agentData.netCommission || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">Agent HST</label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {agentData.tax || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">
                    Listing Amount
                  </label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {commissionData.listing?.listingAmount || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">Listing Tax</label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {commissionData.listing?.listingTax || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">
                    Selling Amount
                  </label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {commissionData.selling?.sellingAmount || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">Selling Tax</label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {commissionData.selling?.sellingTax || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">
                    Total Commission
                  </label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {getTotalCommission()}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">
                    Fees Deducted
                  </label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {agentData.feesDeducted || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">
                    Tax on Fees Deducted
                  </label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {getAgentFeeLedgerCredits(
                      agentData,
                      getTradeTaxRate(trade),
                    ).taxForDeductionDisplay.toFixed(2)}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">Buyer Rebate</label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {getTotalBuyerRebate()}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block font-medium mb-1">Finalized Date</label>

              <input
                type="date"
                className="border rounded px-2 py-1 w-full"
                value={finalizedDate}
                onChange={(e) => setFinalizedDate(e.target.value)}
              />
            </div>

            <div>
              <label className="block font-medium mb-1">Closing Date</label>

              <input
                type="date"
                className="border rounded px-2 py-1 w-full"
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
              />
            </div>

            <div>
              <label className="block font-medium mb-1">End</label>

              <select
                className="border rounded px-2 py-1 w-full"
                value={getWeHoldValue() === "No" ? "Selling Side" : end}
                onChange={(e) => setEnd(e.target.value)}
                disabled={getWeHoldValue() === "No"}
              >
                <option value="">Select</option>

                <option value="Listing Side">Listing Side</option>

                <option value="Selling Side">Selling Side</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1">Deposit Amount</label>

              <div className="border rounded px-2 py-1 bg-gray-50">
                {getDepositAmount()}
              </div>
            </div>

            {/* We Hold field (read-only, auto-filled) */}

            <div>
              <label className="block font-medium mb-1">We Hold</label>

              <div className="border rounded px-2 py-1 bg-gray-50">
                {getWeHoldValue()}
              </div>
            </div>

            <div>
              <label className="block font-medium mb-1">Commission</label>

              <div className="border rounded px-2 py-1 bg-gray-50">
                {commission}
              </div>
            </div>

            <div>
              <label className="block font-medium mb-1">Tax</label>

              <div className="border rounded px-2 py-1 bg-gray-50">{tax}</div>
            </div>

            <div>
              <label className="block font-medium mb-1">Total</label>

              <div className="border rounded px-2 py-1 bg-gray-50">{total}</div>
            </div>

            <div>
              <label className="block font-medium mb-1">Total Commission</label>

              <div className="border rounded px-2 py-1 bg-gray-50">
                {getTotalCommission()}
              </div>
            </div>

            {shouldShowMultipleAgentFields() ? (
              <>
                {agentList.map((agent, index) => {
                  const agentNum = index + 1;
                  const data = getAgentData(index);
                  const taxForDeduction = getAgentFeeLedgerCredits(
                    data,
                    getTradeTaxRate(trade),
                  ).taxForDeductionDisplay.toFixed(2);
                  return (
                    <React.Fragment key={`agent-popup-${index}`}>
                      <div>
                        <label className="block font-medium mb-1">
                          Agent {agentNum} Commission
                        </label>
                        <div className="border rounded px-2 py-1 bg-gray-50">
                          {data.amount || "-"}
                        </div>
                      </div>
                      <div>
                        <label className="block font-medium mb-1">
                          Agent {agentNum} Net
                        </label>
                        <div className="border rounded px-2 py-1 bg-gray-50">
                          {data.netCommission || "-"}
                        </div>
                      </div>
                      <div>
                        <label className="block font-medium mb-1">
                          Agent {agentNum} Fees Deducted
                        </label>
                        <div className="border rounded px-2 py-1 bg-gray-50">
                          {data.feesDeducted || "-"}
                        </div>
                      </div>
                      <div>
                        <label className="block font-medium mb-1">
                          Agent {agentNum} Tax for Deduction
                        </label>
                        <div className="border rounded px-2 py-1 bg-gray-50">
                          {taxForDeduction}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </>
            ) : (
              <>
                <div>
                  <label className="block font-medium mb-1">
                    Agent Commission
                  </label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {agentData.amount || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">Agent Net</label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {agentData.netCommission || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">
                    Fees Deducted
                  </label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {agentData.feesDeducted || "-"}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">
                    Tax For Deduction
                  </label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {getAgentFeeLedgerCredits(
                      agentData,
                      getTradeTaxRate(trade),
                    ).taxForDeductionDisplay.toFixed(2)}
                  </div>
                </div>

                <div>
                  <label className="block font-medium mb-1">Buyer Rebate</label>

                  <div className="border rounded px-2 py-1 bg-gray-50">
                    {getTotalBuyerRebate()}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mt-6">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="fallenThru"
              checked={fallenThru}
              onChange={(e) => setFallenThru(e.target.checked)}
              className="mr-2"
            />

            <label htmlFor="fallenThru" className="font-medium">
              Fallen Thru
            </label>
          </div>

          <div className="flex gap-2">
            <button
              className="px-6 py-2 bg-blue-900 text-white font-semibold rounded hover:bg-blue-800 disabled:opacity-60"
              onClick={handlePrintDetails}
              disabled={isFinalizing}
            >
              Print Details
            </button>

            <button
              className="px-6 py-2 bg-blue-900 text-white font-semibold rounded hover:bg-blue-800 disabled:opacity-60"
              onClick={handleFinalizeTrade}
              disabled={isFinalizing}
            >
              {isFinalizing ? "Finalizing..." : "Finalize Trade"}
            </button>
          </div>
        </div>

        {/* Payment Confirmation Popup */}

        {showPaymentPopup && (
          <div
            className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50"
            onClick={() => {
              setShowPaymentPopup(false);
            }}
          >
            <div
              className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md relative"
              onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside the modal
            >
              <button
                className="absolute top-2 right-2 text-gray-500 hover:text-gray-800 text-2xl"
                onClick={() => setShowPaymentPopup(false)}
              >
                &times;
              </button>

              <h2 className="text-lg font-bold mb-4">Confirm Payment</h2>

              <div className="mb-4">
                <label className="block font-medium mb-1">Finalized Date</label>

                <input
                  type="date"
                  className="border rounded px-2 py-1 w-full"
                  value={finalizedDate}
                  onChange={(e) => setFinalizedDate(e.target.value)}
                />
              </div>

              {getWeHoldValue() === "Yes" && (
                <div className="mb-4">
                  <label className="block font-medium mb-1">Closing Date</label>

                  <div
                    className={`border rounded px-2 py-1 ${
                      !closingDate ? "bg-red-50 border-red-300" : "bg-gray-50"
                    }`}
                  >
                    {formatDateToDDMMYYYY(closingDate)}
                  </div>

                  {!closingDate && (
                    <p className="text-red-500 text-xs mt-1">
                      Closing date is required when We Hold = Yes
                    </p>
                  )}
                </div>
              )}

              <div className="mb-4">
                <label className="block font-medium mb-1">Received From</label>

                <input
                  type="text"
                  className="border rounded px-2 py-1 w-full"
                  value={receivedFrom}
                  onChange={(e) => setReceivedFrom(e.target.value)}
                />
              </div>

              <div className="mb-4">
                <label className="block font-medium mb-1">Amount</label>

                <input
                  type="number"
                  className="border rounded px-2 py-1 w-full"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  step="0.01"
                />
              </div>

              <div className="mb-4">
                <label className="block font-medium mb-1">Payment Type</label>

                <select
                  className="border rounded px-2 py-1 w-full"
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value)}
                >
                  {paymentTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              {/* EFT# field - only show when deposit amount is less than total commission */}

              {(() => {
                const depositAmount = parseFloat(getDepositAmount()) || 0;

                const totalCommission = parseFloat(getTotalCommission()) || 0;

                return totalCommission > depositAmount ? (
                  <div className="mb-4">
                    <label className="block font-medium mb-1">EFT#</label>

                    <input
                      type="text"
                      className="border rounded px-2 py-1 w-full bg-gray-50"
                      value={eftNumber}
                      readOnly
                    />
                  </div>
                ) : null;
              })()}

              <div className="flex justify-end gap-2">
                <button
                  className="px-6 py-2 bg-gray-500 text-white font-semibold rounded hover:bg-gray-600 disabled:opacity-60"
                  onClick={() => setShowPaymentPopup(false)}
                  disabled={isFinalizing}
                >
                  Cancel
                </button>

                <button
                  className="px-6 py-2 bg-blue-900 text-white font-semibold rounded hover:bg-blue-800 disabled:opacity-60"
                  onClick={handlePrintDetails}
                  disabled={isFinalizing}
                >
                  Print Details
                </button>

                <button
                  className="px-6 py-2 bg-blue-900 text-white font-semibold rounded hover:bg-blue-800 disabled:opacity-60"
                  onClick={handleConfirmPayment}
                  disabled={isFinalizing}
                >
                  {isFinalizing ? "Processing..." : "Confirm Payment"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TradeFinalizeModal;
