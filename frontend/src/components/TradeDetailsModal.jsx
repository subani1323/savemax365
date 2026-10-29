import React, { useEffect, useMemo, useState } from "react";

import logo2 from "../Assets/logo2.jpg";

import TradeEditModal from "./TradeEditModal";

import {
  formatCurrency,
  formatDate,
  getEFTTypeDisplayName,
  getAgentPlanSplitPercentLabel,
  getPaymentPlanDisplayName,
} from "../utils/eftUtils";

import axiosInstance from "../config/axios";
import { getTradeTaxRate } from "../constants/tax";
import { roundTo2 } from "../utils/numberUtils";
import {
  getBuyerRebateListingSellingForSheet,
  isBuyerRebateIncludedYes,
} from "../utils/tradeFinancialUtils";
import { buildDisplayCommissionTrustEfts } from "../utils/tradePaymentDetailsDisplay";
import {
  buildFeeTaxCreditEntries,
  buildOfficeExpenseFinancialRows,
  resolveOfficeExpenseAmounts,
  resolveOfficeExpenseAmountsForSheet,
} from "../utils/agentFeeTaxSplit";
import { EXPENSE_FIELDS, roundMoney } from "../utils/agentExpenseUtils";

/** Convert tax-incl map → trade officeExpenseAmounts patch (selected lines). */
function officeExpensePatchFromBases(bases = {}, taxRatePercent = 13) {
  const officeExpenseAmounts = {};
  const officeExpenseSelected = {};
  let any = false;
  for (const f of EXPENSE_FIELDS) {
    const base = roundMoney(bases[f.key] || 0);
    officeExpenseAmounts[f.key] = base;
    officeExpenseSelected[f.key] = base > 0;
    if (base > 0) any = true;
  }
  return any
    ? {
        officeExpensesEnabled: true,
        officeExpenseTaxRate:
          taxRatePercent > 1 ? taxRatePercent : taxRatePercent * 100,
        officeExpenseAmounts,
        officeExpenseSelected,
      }
    : null;
}

/** One signature line per person on Commission Trust Agreement (ADE uses LISTING + SELLING rows). */
function dedupeAgentDoubleEnderForTrustSignatures(agents, tradeClassification) {
  if (!agents?.length) return agents || [];
  if (tradeClassification !== "AGENT DOUBLE ENDER") return agents;
  const out = [];
  const seen = new Set();
  for (const a of agents) {
    if ((a.classification || "").toUpperCase() !== "AGENT DOUBLE ENDER") {
      out.push(a);
      continue;
    }
    const k = String(a.agentId ?? a.agentName ?? "");
    if (seen.has(k)) continue;
    seen.add(k);
    const same = agents.filter(
      (x) =>
        (x.classification || "").toUpperCase() === "AGENT DOUBLE ENDER" &&
        String(x.agentId ?? x.agentName ?? "") === k,
    );
    const selling = same.find(
      (x) => (x.transactionType || "").toUpperCase() === "SELLING",
    );
    out.push(selling || same[0]);
  }
  return out;
}

const TRUST_ACTIVITY_EXCLUDED_EFT_TYPES = new Set([
  "BuilderRepayment",
  "GeneralToCommissionTransfer",
]);

function excludeSeparateTrustActivityEfts(efts) {
  return (efts || []).filter(
    (eft) => !TRUST_ACTIVITY_EXCLUDED_EFT_TYPES.has(eft.type),
  );
}

const EFT_ACTIVITY_TABLE_COLGROUP = `<colgroup>
    <col style="width:8%">
    <col style="width:12%">
    <col style="width:11%">
    <col style="width:24%">
    <col style="width:45%">
  </colgroup>`;

const COMMISSION_RECALL_TABLE_COLGROUP = `<colgroup>
    <col style="width:12%">
    <col style="width:18%">
    <col style="width:11%">
    <col style="width:14%">
    <col style="width:45%">
  </colgroup>`;

function buildEftActivityTableHtml(efts, emptyMessage) {
  if (!efts?.length) {
    return `<div class="text-gray-500">${emptyMessage}</div>`;
  }
  return `<table class="eft-activity-table">${EFT_ACTIVITY_TABLE_COLGROUP}<thead><tr>
    <th>EFT #</th><th>Date</th><th>Amount</th><th>Recipient</th><th>Description</th>
  </tr></thead><tbody>
  ${efts
    .map(
      (eft) => `<tr>
        <td>${eft.eftNumber || ""}</td>
        <td>${
          eft.chequeDate || eft.date
            ? formatDate(eft.chequeDate || eft.date)
            : "-"
        }</td>
        <td>${formatCurrency(eft.amount || "")}</td>
        <td>${eft.recipient || eft.agentName || ""}</td>
        <td>${eft.description || ""}</td>
      </tr>`,
    )
    .join("")}
  </tbody></table>`;
}

function buildCommissionRecallTableHtml(recalls, emptyMessage) {
  if (!recalls?.length) {
    return `<div class="text-gray-500">${emptyMessage}</div>`;
  }
  return `<table class="commission-recall-table">${COMMISSION_RECALL_TABLE_COLGROUP}<thead><tr>
    <th>Date</th><th>Agent</th><th>Amount</th><th>Reference</th><th>Description</th>
  </tr></thead><tbody>
  ${recalls
    .map(
      (recall) => `<tr>
        <td>${recall.recalledAt ? formatDate(recall.recalledAt) : "-"}</td>
        <td>${recall.agentName || ""}</td>
        <td>${formatCurrency(recall.amount || "")}</td>
        <td>${recall.recallRef || ""}</td>
        <td>${recall.description || recall.notes || ""}</td>
      </tr>`,
    )
    .join("")}
  </tbody></table>`;
}

function EftActivityTable({ efts, emptyMessage }) {
  if (!efts?.length) {
    return <div className="text-gray-500">{emptyMessage}</div>;
  }
  return (
    <table className="min-w-full table-fixed border text-sm mb-2">
      <colgroup>
        <col style={{ width: "8%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "11%" }} />
        <col style={{ width: "24%" }} />
        <col style={{ width: "45%" }} />
      </colgroup>
      <thead>
        <tr className="bg-gray-100">
          <th className="border px-2 py-1">EFT #</th>
          <th className="border px-2 py-1 whitespace-nowrap">Date</th>
          <th className="border px-2 py-1">Amount</th>
          <th className="border px-2 py-1">Recipient</th>
          <th className="border px-2 py-1">Description</th>
        </tr>
      </thead>
      <tbody>
        {efts.map((eft, idx) => (
          <tr key={eft._id || eft.eftNumber || idx}>
            <td className="border px-2 py-1">{eft.eftNumber || ""}</td>
            <td className="border px-2 py-1 whitespace-nowrap">
              {eft.chequeDate || eft.date
                ? formatDate(eft.chequeDate || eft.date)
                : "-"}
            </td>
            <td className="border px-2 py-1">
              {formatCurrency(eft.amount || "")}
            </td>
            <td className="border px-2 py-1">
              {eft.recipient || eft.agentName || ""}
            </td>
            <td className="border px-2 py-1 break-words">
              {eft.description || ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CommissionRecallTable({ recalls, emptyMessage }) {
  if (!recalls?.length) {
    return <div className="text-gray-500">{emptyMessage}</div>;
  }
  return (
    <table className="min-w-full table-fixed border text-sm mb-2">
      <colgroup>
        <col style={{ width: "12%" }} />
        <col style={{ width: "18%" }} />
        <col style={{ width: "11%" }} />
        <col style={{ width: "14%" }} />
        <col style={{ width: "45%" }} />
      </colgroup>
      <thead>
        <tr className="bg-gray-100">
          <th className="border px-2 py-1 whitespace-nowrap">Date</th>
          <th className="border px-2 py-1">Agent</th>
          <th className="border px-2 py-1">Amount</th>
          <th className="border px-2 py-1">Reference</th>
          <th className="border px-2 py-1">Description</th>
        </tr>
      </thead>
      <tbody>
        {recalls.map((recall, idx) => (
          <tr key={recall._id || recall.recallRef || idx}>
            <td className="border px-2 py-1 whitespace-nowrap">
              {recall.recalledAt ? formatDate(recall.recalledAt) : "-"}
            </td>
            <td className="border px-2 py-1">{recall.agentName || ""}</td>
            <td className="border px-2 py-1">
              {formatCurrency(recall.amount || "")}
            </td>
            <td className="border px-2 py-1">{recall.recallRef || ""}</td>
            <td className="border px-2 py-1 break-words">
              {recall.description || recall.notes || ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TradeDetailsModal = ({ trade, onClose, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);

  const [isPrinting, setIsPrinting] = useState(false);

  const [showPrintAgentModal, setShowPrintAgentModal] = useState(false);

  const [showNotesModal, setShowNotesModal] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteAuthor, setNoteAuthor] = useState(() => {
    try {
      return localStorage.getItem("tradeNoteAuthorName") || "";
    } catch {
      return "";
    }
  });
  const [noteSaveStatus, setNoteSaveStatus] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  const tradeNotes = useMemo(() => {
    const list = Array.isArray(trade?.tradeNotes) ? [...trade.tradeNotes] : [];
    return list.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }, [trade?.tradeNotes]);

  const tradeRecordSheetAgentPickerEntries = useMemo(() => {
    const list = (trade?.agentCommissionList || []).filter(
      (a) => (a.classification || "").toUpperCase() !== "REFERRAL",
    );
    const isAde =
      (trade?.keyInfo?.classification || "") === "AGENT DOUBLE ENDER";
    if (!isAde) {
      return list.map((agent, idx) => ({
        key: `agent-${idx}`,
        label: agent.agentName || `Agent ${idx + 1}`,
        printIndex: idx,
      }));
    }
    const byKey = new Map();
    list.forEach((agent, idx) => {
      const kid = String(agent.agentId ?? agent.agentName ?? `idx-${idx}`);
      if (!byKey.has(kid)) byKey.set(kid, []);
      byKey.get(kid).push({ agent, idx });
    });
    return [...byKey.values()].map((pairs, groupIdx) => {
      const sellingPair = pairs.find(
        (p) => (p.agent.transactionType || "").toUpperCase() === "SELLING",
      );
      const primary = sellingPair || pairs[0];
      const { agent } = primary;
      return {
        key: `${agent.agentId ?? agent.agentName ?? groupIdx}`,
        label: agent.agentName || "Agent",
        printIndex: primary.idx,
      };
    });
  }, [trade?.agentCommissionList, trade?.keyInfo?.classification]);

  const handleSaveTradeNote = async () => {
    const text = String(noteDraft || "").trim();
    const author = String(noteAuthor || "").trim();
    if (!text) {
      setNoteSaveStatus("Type a note first");
      return;
    }
    if (!author) {
      setNoteSaveStatus("Enter your name to save");
      return;
    }
    if (!trade?._id) {
      setNoteSaveStatus("Trade not saved yet");
      return;
    }

    try {
      setNoteSaving(true);
      setNoteSaveStatus("Saving…");
      const { data: updatedTrade } = await axiosInstance.patch(
        `/trades/${trade._id}/notes`,
        { text, authorName: author },
      );
      try {
        localStorage.setItem("tradeNoteAuthorName", author);
      } catch {
        /* ignore */
      }
      setNoteDraft("");
      setNoteSaveStatus("Saved");
      if (typeof onUpdate === "function") {
        onUpdate(updatedTrade);
      }
    } catch (err) {
      console.error("Error saving trade note:", err);
      setNoteSaveStatus(err?.response?.data?.message || "Failed to save note");
    } finally {
      setNoteSaving(false);
    }
  };

  if (!trade) return null;

  // Helper: get nested safely

  const get = (obj, path, fallback = "-") =>
    path

      .split(".")

      .reduce((o, k) => (o && o[k] !== undefined ? o[k] : fallback), obj);

  // Helper to render a table from an array of objects

  const renderTable = (rows) => {
    if (!rows || !rows.length)
      return <div className="text-gray-500">No data.</div>;

    const headers = Object.keys(rows[0]);

    const capitalizedHeaders = headers.map(
      (h) => h.charAt(0).toUpperCase() + h.slice(1),
    );

    return (
      <table className="min-w-full border border-gray-300 mb-2 text-sm">
        <thead>
          <tr>
            {headers.map((h, index) => (
              <th key={h} className="px-2 py-1 text-left bg-gray-100 border">
                {capitalizedHeaders[index]}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {headers.map((h) => (
                <td key={h} className="border px-2 py-1">
                  {row[h]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  // Add a helper function inside the component, before renderFinancialSection

  const displayAmount = (val) =>
    val !== undefined && val !== null && val !== "" ? val : "0.00";

  // Print function

  const handlePrint = async (selectedAgentIndex = null) => {
    if (isPrinting) return;

    setIsPrinting(true);

    try {
      let printWindow = window.open("", "_blank");

      let useCurrentWindow = false;

      if (!printWindow) {
        useCurrentWindow = true;

        printWindow = window;
      }

      const currentDate = new Date().toLocaleDateString();

      let realEstateTrustEFTs = [];

      let commissionTrustEFTs = [];

      let allCommissionTrustEFTs = [];

      let commissionRecalls = [];

      let ledgerEntries = [];

      if (trade && trade._id) {
        try {
          const [realEstateRes, commissionRes, ledgerRes, recallsRes] =
            await Promise.all([
              axiosInstance.get(`/real-estate-trust-eft/trade/${trade._id}`),

              axiosInstance.get(`/commission-trust-eft/trade/${trade._id}`),

              axiosInstance.get("/ledger"),

              axiosInstance.get(`/commission-recalls?tradeId=${trade._id}`),
            ]);

          realEstateTrustEFTs = realEstateRes.data || [];

          allCommissionTrustEFTs = commissionRes.data || [];

          commissionRecalls = recallsRes.data || [];

          commissionTrustEFTs = excludeSeparateTrustActivityEfts(
            allCommissionTrustEFTs,
          );

          const allLedgerEntries = ledgerRes.data || [];

          const tradeNumber = trade.tradeNumber || trade.keyInfo?.tradeNumber;

          ledgerEntries = allLedgerEntries.filter(
            (entry) =>
              entry.tradeNumber === tradeNumber ||
              (entry.description &&
                entry.description.includes(`Trade #: ${tradeNumber}`)),
          );
        } catch (err) {
          // fallback to empty arrays
        }
      }

      const commissionIncome =
        trade.commission?.commissionIncomeRows?.[0] || {};

      // Get the trade classification

      const tradeClassification = trade.keyInfo?.classification || "";

      const isCoOperatingSide = tradeClassification === "CO-OPERATING SIDE";

      // Calculate Sub-Total and HST for Commission row

      const listingAmount =
        commissionIncome.listingAmount && commissionIncome.listingAmount !== ""
          ? parseFloat(commissionIncome.listingAmount)
          : 0;

      const sellingAmount =
        commissionIncome.sellingAmount && commissionIncome.sellingAmount !== ""
          ? parseFloat(commissionIncome.sellingAmount)
          : 0;

      const subTotal = (listingAmount + sellingAmount).toFixed(2);

      const taxRate = getTradeTaxRate(trade);

      const listingTax = roundTo2(listingAmount * taxRate).toFixed(2);

      const sellingTax = roundTo2(sellingAmount * taxRate).toFixed(2);

      const hst = roundTo2(
        parseFloat(listingTax) + parseFloat(sellingTax),
      ).toFixed(2);

      const total = roundTo2(parseFloat(subTotal) + parseFloat(hst)).toFixed(2);

      const outsideBrokersList = [];
      let totalObListing = 0;
      let totalObSelling = 0;
      let totalObSubTotal = 0;
      let totalObTax = 0;
      let totalObTotal = 0;

      const brokerRows =
        trade.commission?.outsideBrokersRows?.length > 0
          ? trade.commission.outsideBrokersRows
          : trade.outsideBrokers || [];

      brokerRows.forEach((outsideBrokerInfo) => {
        // Get the broker name
        const brokerName = `${
          outsideBrokerInfo.agentName || outsideBrokerInfo.firstName || ""
        } ${outsideBrokerInfo.lastName || ""}`.trim();

        // Get the company name
        const companyName =
          outsideBrokerInfo.company || outsideBrokerInfo.brokerage || "";

        // Combine name and company
        const obName =
          brokerName && companyName
            ? `${brokerName} - ${companyName}`
            : brokerName || companyName || "Outside Broker";

        // Get the selling amount from either source
        const brokerSellingAmount = outsideBrokerInfo.sellingAmount || "0.00";

        // First check the broker's end from outsideBrokers array
        const matchingBrokerInOB = trade.outsideBrokers?.find((ob) => {
          const outsideBrokerName = `${ob.firstName} ${ob.lastName}`.trim();
          return (
            outsideBrokerName ===
              (outsideBrokerInfo.agentName || outsideBrokerInfo.firstName) ||
            ob.company === outsideBrokerInfo.company
          );
        });

        // Determine the end type from either the matching broker or current broker info
        let endType = "";

        if (matchingBrokerInOB) {
          if (
            matchingBrokerInOB.end?.toLowerCase().includes("listing") ||
            matchingBrokerInOB.type?.toLowerCase().includes("listing")
          ) {
            endType = "listing";
          } else {
            endType = "selling";
          }
        } else {
          const end = (
            outsideBrokerInfo.end ||
            outsideBrokerInfo.type ||
            ""
          ).toLowerCase();
          endType = end.includes("listing") ? "listing" : "selling";
        }

        // Place amount in appropriate column based on end type
        let obListing = "0.00";
        let obSelling = "0.00";

        if (endType === "listing") {
          obListing = brokerSellingAmount;
          obSelling = "0.00";
        } else {
          obListing = "0.00";
          obSelling = brokerSellingAmount;
        }

        const obSubTotal = brokerSellingAmount;
        const obTax = outsideBrokerInfo.tax || "0.00";
        const obTotal = outsideBrokerInfo.total || "0.00";

        // Add to totals
        totalObListing += parseFloat(obListing);
        totalObSelling += parseFloat(obSelling);
        totalObSubTotal += parseFloat(obSubTotal);
        totalObTax += parseFloat(obTax);
        totalObTotal += parseFloat(obTotal);

        // Add to list
        outsideBrokersList.push({
          obName,
          obListing,
          obSelling,
          obSubTotal,
          obTax,
          obTotal,
        });
      });

      if (tradeClassification === "AGENT DOUBLE ENDER") {
        outsideBrokersList.length = 0;
        totalObListing = 0;
        totalObSelling = 0;
        totalObSubTotal = 0;
        totalObTax = 0;
        totalObTotal = 0;
      }

      const obListing = totalObListing.toFixed(2);
      const obSelling = totalObSelling.toFixed(2);
      const obSubTotal = totalObSubTotal.toFixed(2);
      const obTax = totalObTax.toFixed(2);
      const obTotal = totalObTotal.toFixed(2);
      const obName =
        outsideBrokersList.length > 0 ? outsideBrokersList[0].obName : "";

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

      const expensesRowsForPrint = [];
      outsideBrokersList.forEach((b) => {
        expensesRowsForPrint.push({
          name: b.obName,
          listing: b.obListing,
          selling: b.obSelling,
          subTotal: b.obSubTotal,
          tax: b.obTax,
          total: b.obTotal,
        });
      });
      referralForExpenses.forEach((a) => {
        expensesRowsForPrint.push({
          name: `${a.agentName || ""} - Referral`,
          listing: "0.00",
          selling: a.amount || "0",
          subTotal: a.amount || "0",
          tax: a.tax || "0",
          total: a.total || "0",
        });
      });

      let baseOfficeCommissionListing,
        baseOfficeCommissionSelling,
        baseOfficeCommissionSubTotal,
        baseOfficeCommissionHST,
        baseOfficeCommissionTotal;

      if (isCoOperatingSide) {
        if (referralForExpenses.length === 0) {
          baseOfficeCommissionListing = listingAmount;
          baseOfficeCommissionSelling = sellingAmount;
          baseOfficeCommissionSubTotal = subTotal;
          baseOfficeCommissionHST = hst;
          baseOfficeCommissionTotal = total;
        } else {
          baseOfficeCommissionListing = listingAmount;
          baseOfficeCommissionSelling = (
            parseFloat(sellingAmount) - referralAmountSum
          ).toFixed(2);
          baseOfficeCommissionSubTotal = (
            parseFloat(subTotal) - referralAmountSum
          ).toFixed(2);
          baseOfficeCommissionHST = (parseFloat(hst) - referralTaxSum).toFixed(
            2,
          );
          baseOfficeCommissionTotal = (
            parseFloat(total) - referralTotalSum
          ).toFixed(2);
        }
      } else {
        baseOfficeCommissionListing = (
          parseFloat(listingAmount) - parseFloat(obListing)
        ).toFixed(2);
        baseOfficeCommissionSelling = (
          parseFloat(sellingAmount) -
          parseFloat(obSelling) -
          referralAmountSum
        ).toFixed(2);
        baseOfficeCommissionSubTotal = (
          parseFloat(subTotal) -
          parseFloat(obSubTotal) -
          referralAmountSum
        ).toFixed(2);
        baseOfficeCommissionHST = (
          parseFloat(hst) -
          parseFloat(obTax) -
          referralTaxSum
        ).toFixed(2);
        baseOfficeCommissionTotal = (
          parseFloat(total) -
          parseFloat(obTotal) -
          referralTotalSum
        ).toFixed(2);
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

      // Prefer per-line office expenses on the agent; else applied-on-trade /
      // remaining / posted AE lines; else Other fee inferred from totalFees.
      let agentsForFinancial = trade.agentCommissionList || [];
      try {
        const tradeNumber = String(
          trade.tradeNumber || trade.keyInfo?.tradeNumber || "",
        ).trim();
        const taxPct = Math.round(taxRate * 100);
        const needsLineLookup = agentsForFinancial.some(
          (a) =>
            (a.classification || "").toUpperCase() !== "REFERRAL" &&
            Object.keys(resolveOfficeExpenseAmounts(a)).length === 0,
        );

        let appliedByEmployeeNo = {};
        if (needsLineLookup && tradeNumber) {
          try {
            const appliedRes = await axiosInstance.get(
              `/agent-expenses/applied-on-trade/${encodeURIComponent(tradeNumber)}`,
            );
            appliedByEmployeeNo = appliedRes.data?.byEmployeeNo || {};
          } catch {
            appliedByEmployeeNo = {};
          }
        }

        if (needsLineLookup) {
          let masterAgents = [];
          try {
            const agentsRes = await axiosInstance.get("/agents");
            masterAgents = agentsRes.data || [];
          } catch {
            masterAgents = [];
          }

          agentsForFinancial = await Promise.all(
            agentsForFinancial.map(async (a) => {
              if ((a.classification || "").toUpperCase() === "REFERRAL") {
                return a;
              }
              if (Object.keys(resolveOfficeExpenseAmounts(a)).length > 0) {
                return a;
              }

              const empKey = String(a.agentId || "");
              const dbAgent = masterAgents.find(
                (x) => String(x.employeeNo) === String(a.agentId),
              );
              const candidates = [];
              const appliedEntry =
                appliedByEmployeeNo[empKey] ||
                (dbAgent?._id
                  ? appliedByEmployeeNo[String(dbAgent._id)]
                  : null);
              if (appliedEntry?.appliedIncl) {
                candidates.push(appliedEntry.appliedIncl);
              }

              if (dbAgent?._id) {
                try {
                  const balRes = await axiosInstance.get(
                    `/agent-expenses/balances/${dbAgent._id}`,
                  );
                  if (balRes.data?.remaining) {
                    candidates.push(balRes.data.remaining);
                  }
                  if (balRes.data?.posted) {
                    candidates.push(balRes.data.posted);
                  }
                } catch {
                  /* ignore */
                }
              }

              const bases = resolveOfficeExpenseAmountsForSheet(
                a,
                taxRate,
                candidates,
              );
              const patch = officeExpensePatchFromBases(
                bases,
                a.officeExpenseTaxRate ?? taxPct,
              );
              return patch ? { ...a, ...patch } : a;
            }),
          );
        }
      } catch {
        agentsForFinancial = trade.agentCommissionList || [];
      }

      const agentCalculations = agentsForFinancial.map((agent, agentIndex) => {
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
            agentListing = displaySubForSheet.toFixed(2);
            agentSelling = "0.00";
          } else if (transactionType === "SELLING") {
            agentListing = "0.00";
            agentSelling = displaySubForSheet.toFixed(2);
          }
        } else if (isCoOperatingSide) {
          agentListing = "0.00";
          agentSelling = displaySubForSheet.toFixed(2);
        } else {
          agentListing = displaySubForSheet.toFixed(2);
          agentSelling = "0.00";
        }

        const agentSubTotal = (
          parseFloat(agentListing) + parseFloat(agentSelling)
        ).toFixed(2);
        const defaultAgentHST = roundTo2(hstBaseForAgent * taxRate);
        const isTaxOverridden =
          agent.taxOverridden === true || agent.taxOverridden === "true";
        const officeExpenseRows = buildOfficeExpenseFinancialRows(agent, {
          listingAmount: agentListing,
          sellingAmount: agentSelling,
          taxRate,
        });
        const hasOfficeExpenses = officeExpenseRows.length > 0;
        // Prefer persisted net when present so Financial sheet matches Agent Info table,
        // unless office expenses are shown separately (then agent line is share after plan only).
        const hasPersistedNet =
          !hasOfficeExpenses &&
          agent.netCommission !== undefined &&
          agent.netCommission !== null &&
          agent.netCommission !== "";
        const persistedNet = hasPersistedNet
          ? roundTo2(parseFloat(agent.netCommission || 0))
          : null;
        const agentHSTNumeric = hasPersistedNet
          ? roundTo2(persistedNet - parseFloat(agentSubTotal || 0))
          : isTaxOverridden
            ? roundTo2(parseFloat(agent.tax || 0) || 0)
            : defaultAgentHST;
        const agentHST = agentHSTNumeric.toFixed(2);
        const agentTotal = hasPersistedNet
          ? persistedNet.toFixed(2)
          : (parseFloat(agentSubTotal) + parseFloat(agentHST)).toFixed(2);

        return {
          ...agent,
          agentListing,
          agentSelling,
          agentSubTotal,
          agentHST,
          agentTotal,
          officeExpenseRows,
        };
      });

      const showBaseOfficeAndNetToOffice =
        selectedAgentIndex === null || selectedAgentIndex === undefined;
      const nonReferralAgents = agentCalculations.filter(
        (a) => (a.classification || "").toUpperCase() !== "REFERRAL",
      );
      let agentCalculationsFiltered = agentCalculations;
      if (!showBaseOfficeAndNetToOffice && selectedAgentIndex != null) {
        const indices = Array.isArray(selectedAgentIndex)
          ? selectedAgentIndex
          : [selectedAgentIndex];
        const selected = indices
          .filter((i) => Number.isInteger(i) && nonReferralAgents[i])
          .map((i) => nonReferralAgents[i]);
        if (selected.length > 0) {
          agentCalculationsFiltered = selected;
        }
      }
      const agentsForNetToOffice = agentCalculationsFiltered.filter(
        (a) => (a.classification || "").toUpperCase() !== "REFERRAL",
      );

      const officeExpenseSheetRows = agentsForNetToOffice.flatMap(
        (a) => a.officeExpenseRows || [],
      );
      const totalOfficeExpenseListing = officeExpenseSheetRows.reduce(
        (s, r) => s + (parseFloat(r.listing) || 0),
        0,
      );
      const totalOfficeExpenseSelling = officeExpenseSheetRows.reduce(
        (s, r) => s + (parseFloat(r.selling) || 0),
        0,
      );
      const totalOfficeExpenseSubTotal = officeExpenseSheetRows.reduce(
        (s, r) => s + (parseFloat(r.subTotal) || 0),
        0,
      );
      const totalOfficeExpenseHST = officeExpenseSheetRows.reduce(
        (s, r) => s + (parseFloat(r.tax) || 0),
        0,
      );
      const totalOfficeExpenseTotal = officeExpenseSheetRows.reduce(
        (s, r) => s + (parseFloat(r.total) || 0),
        0,
      );

      const agentKeysForBuyerRebateSheet = showBaseOfficeAndNetToOffice
        ? null
        : new Set(
            agentsForNetToOffice.map((a) =>
              String(a.agentId ?? a.agentName ?? ""),
            ),
          );
      const buyerRebateCols = getBuyerRebateListingSellingForSheet(trade, {
        agentKeys: agentKeysForBuyerRebateSheet,
      });
      const buyerRebateListing = buyerRebateCols.listing.toFixed(2);
      const buyerRebateSelling = buyerRebateCols.selling.toFixed(2);
      const totalBuyerRebate = parseFloat(
        (buyerRebateCols.listing + buyerRebateCols.selling).toFixed(2),
      );

      let netToOfficeListing,
        netToOfficeSelling,
        netToOfficeSubTotal,
        netToOfficeHST,
        netToOfficeTotal;

      let totalAgentListing,
        totalAgentSelling,
        totalAgentSubTotal,
        totalAgentHST,
        totalAgentTotal;

      if (!isCoOperatingSide && agentsForNetToOffice.length === 2) {
        const agent1 = agentsForNetToOffice[0] || {};
        const agent2 = agentsForNetToOffice[1] || {};
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
          parseFloat(agent1.agentTotal || 0) -
          parseFloat(agent2.agentTotal || 0);
      } else {
        totalAgentListing = agentsForNetToOffice.reduce(
          (sum, agent) => sum + parseFloat(agent.agentListing || 0),
          0,
        );
        totalAgentSelling = agentsForNetToOffice.reduce(
          (sum, agent) => sum + parseFloat(agent.agentSelling || 0),
          0,
        );
        totalAgentSubTotal = agentsForNetToOffice.reduce(
          (sum, agent) => sum + parseFloat(agent.agentSubTotal || 0),
          0,
        );
        totalAgentHST = agentsForNetToOffice.reduce(
          (sum, agent) => sum + parseFloat(agent.agentHST || 0),
          0,
        );
        totalAgentTotal = agentsForNetToOffice.reduce(
          (sum, agent) => sum + parseFloat(agent.agentTotal || 0),
          0,
        );
      }

      if (tradeClassification === "AGENT DOUBLE ENDER") {
        const sumAgentListing = agentsForNetToOffice.reduce(
          (s, a) => s + parseFloat(a.agentListing || 0),
          0,
        );
        const sumAgentSelling = agentsForNetToOffice.reduce(
          (s, a) => s + parseFloat(a.agentSelling || 0),
          0,
        );
        const sumAgentSubTotal = agentsForNetToOffice.reduce(
          (s, a) => s + parseFloat(a.agentSubTotal || 0),
          0,
        );
        const sumAgentHST = agentsForNetToOffice.reduce(
          (s, a) => s + parseFloat(a.agentHST || 0),
          0,
        );
        const sumAgentTotal = agentsForNetToOffice.reduce(
          (s, a) => s + parseFloat(a.agentTotal || 0),
          0,
        );
        const incomeSub = parseFloat(subTotal);
        const incomeHst = parseFloat(hst);
        const incomeTtl = parseFloat(total);
        netToOfficeListing = roundTo2(
          parseFloat(listingAmount) -
            sumAgentListing -
            totalOfficeExpenseListing,
        ).toFixed(2);
        netToOfficeSelling = roundTo2(
          parseFloat(sellingAmount) -
            sumAgentSelling -
            totalOfficeExpenseSelling,
        ).toFixed(2);
        netToOfficeSubTotal = roundTo2(
          incomeSub - sumAgentSubTotal - totalOfficeExpenseSubTotal,
        ).toFixed(2);
        netToOfficeHST = roundTo2(
          incomeHst - sumAgentHST - totalOfficeExpenseHST,
        ).toFixed(2);
        netToOfficeTotal = roundTo2(
          incomeTtl - sumAgentTotal - totalOfficeExpenseTotal,
        ).toFixed(2);
      } else if (!isCoOperatingSide && agentsForNetToOffice.length === 2) {
        const totalPlanFees = agentsForNetToOffice.reduce(
          (tot, agent) => tot + parseFloat(agent.feesDeducted || 0),
          0,
        );
        const overriddenHSTToOffice = agentsForNetToOffice.reduce(
          (tot, agent) => {
            const rowOverride =
              agent.taxOverridden === true || agent.taxOverridden === "true";
            return (
              tot +
              (rowOverride
                ? roundTo2(parseFloat(agent.amount || 0) * taxRate)
                : 0)
            );
          },
          0,
        );
        netToOfficeSubTotal = roundTo2(
          totalPlanFees - totalOfficeExpenseSubTotal,
        ).toFixed(2);
        netToOfficeHST = roundTo2(
          overriddenHSTToOffice - totalOfficeExpenseHST,
        ).toFixed(2);
        netToOfficeTotal = roundTo2(
          parseFloat(netToOfficeSubTotal) + parseFloat(netToOfficeHST),
        ).toFixed(2);
        netToOfficeListing = netToOfficeSubTotal;
        netToOfficeSelling = "0.00";
      } else if (isCoOperatingSide) {
        // Co-operating side net to office should be computed by column subtraction:
        // Base Office Commission minus Agents (and minus buyer rebate liabilities where applicable).
        const rebateSubTotal =
          buyerRebateCols.listing + buyerRebateCols.selling;
        netToOfficeListing = "0.00";
        netToOfficeSelling = roundTo2(
          parseFloat(baseOfficeCommissionSelling) -
            totalAgentSelling -
            buyerRebateCols.selling -
            totalOfficeExpenseSelling,
        ).toFixed(2);
        netToOfficeSubTotal = roundTo2(
          parseFloat(baseOfficeCommissionSubTotal) -
            totalAgentSubTotal -
            rebateSubTotal -
            totalOfficeExpenseSubTotal,
        ).toFixed(2);
        netToOfficeHST = roundTo2(
          parseFloat(baseOfficeCommissionHST) -
            totalAgentHST -
            totalOfficeExpenseHST,
        ).toFixed(2);
        netToOfficeTotal = roundTo2(
          parseFloat(baseOfficeCommissionTotal) -
            totalAgentTotal -
            rebateSubTotal -
            totalOfficeExpenseTotal,
        ).toFixed(2);
      } else {
        netToOfficeListing = roundTo2(
          parseFloat(baseOfficeCommissionListing) -
            totalAgentListing -
            buyerRebateCols.listing -
            totalOfficeExpenseListing,
        ).toFixed(2);
        netToOfficeSelling = roundTo2(
          parseFloat(baseOfficeCommissionSelling) -
            totalAgentSelling -
            buyerRebateCols.selling -
            totalOfficeExpenseSelling,
        ).toFixed(2);
        netToOfficeSubTotal = roundTo2(
          parseFloat(netToOfficeListing) + parseFloat(netToOfficeSelling),
        ).toFixed(2);
        netToOfficeHST = roundTo2(
          parseFloat(netToOfficeSubTotal) * taxRate,
        ).toFixed(2);
        netToOfficeTotal = roundTo2(
          parseFloat(netToOfficeSubTotal) + parseFloat(netToOfficeHST),
        ).toFixed(2);
      }

      const getEndValueForPrintBroker = (b) => {
        const matchingBroker1 = trade.outsideBrokers?.find((ob) => {
          const outsideBrokerName = `${ob.firstName} ${ob.lastName}`.trim();
          return (
            outsideBrokerName === b.agentName || ob.company === b.brokerage
          );
        });
        if (matchingBroker1) {
          if (
            matchingBroker1.end?.toLowerCase().includes("listing") ||
            matchingBroker1.type?.toLowerCase().includes("listing")
          )
            return "Listing";
        }
        if (
          b.end?.toLowerCase().includes("listing") ||
          b.type?.toLowerCase().includes("listing")
        )
          return "Listing";
        return "Selling";
      };

      const formattedOutsideBrokersBase =
        trade.commission?.outsideBrokersRows?.map((broker) => ({
          agentName: broker.agentName || "-",
          brokerage: broker.brokerage || "-",
          end: getEndValueForPrintBroker(broker),
          sellingAmount: broker.sellingAmount || "0.00",
          tax: broker.tax || "0.00",
          total: broker.total || "0.00",
          isReferral: false,
        })) || [];

      const referralAgentsForPrint = (trade.agentCommissionList || []).filter(
        (a) => (a.classification || "").toUpperCase() === "REFERRAL",
      );
      const referralCommissionRowsForPrint = referralAgentsForPrint.map(
        (a) => ({
          agentName: a.agentName || "-",
          brokerage: a.agentName || "Referral",
          end: "Selling",
          sellingAmount: a.amount || "0.00",
          tax: a.tax || "0.00",
          total: a.total || "0.00",
          isReferral: true,
        }),
      );
      const formattedOutsideBrokers = [
        ...formattedOutsideBrokersBase,
        ...referralCommissionRowsForPrint,
      ];

      const hasReferralBrokerForOutsidePct = referralAgentsForPrint.length > 0;
      const formatOutsideBrokerSharePercent = (broker) => {
        if (!hasReferralBrokerForOutsidePct) return "";
        if (!broker.isReferral) return "-";
        const endStr = String(broker.end || "").toLowerCase();
        const denom = endStr.includes("listing")
          ? listingAmount
          : sellingAmount;
        const num =
          parseFloat(String(broker.sellingAmount ?? "0").replace(/,/g, "")) ||
          0;
        if (!(denom > 0)) return "-";
        return `${roundTo2((num / denom) * 100)}%`;
      };

      const referralAsBrokersForPrint = referralAgentsForPrint.map((a) => ({
        type: "Referral",
        firstName: "-",
        lastName: "-",
        company: a.agentName || "Referral",
        end: "Selling End",
        primaryPhone: "-",
      }));
      const allOutsideBrokersForPrint = [
        ...(trade.outsideBrokers || []),
        ...referralAsBrokersForPrint,
      ];

      const agentDetailsForPrint = (agentCalculationsFiltered || []).filter(
        (a) => (a.classification || "").toUpperCase() !== "REFERRAL",
      );
      // Trust Agreement signatures: one line per person (ADE listing+selling collapse to one)
      const agentSignaturesForPrint = dedupeAgentDoubleEnderForTrustSignatures(
        agentDetailsForPrint,
        tradeClassification,
      );
      const financialAgentRowsForPrint = agentDetailsForPrint;

      const agentDetailsPercentForPrint = (agent) => {
        const base = parseFloat(agent.amount || 0);
        const fees = parseFloat(agent.feesDeducted || 0);
        const rebate =
          isBuyerRebateIncludedYes(agent) && agent.buyerRebateAmount
            ? parseFloat(agent.buyerRebateAmount || 0)
            : 0;
        const net = base - fees - rebate;
        return getAgentPlanSplitPercentLabel(agent.feeInfo, agent.percentage, {
          agentBase: base,
          netTotal: net,
        });
      };

      // Get address information from keyInfo

      const streetNumber = get(trade, "keyInfo.streetNumber") || "";

      const streetName = get(trade, "keyInfo.streetName") || "";

      const unit = get(trade, "keyInfo.unit") || "";

      const city = get(trade, "keyInfo.city") || "";

      const province = get(trade, "keyInfo.province") || "";

      const postalCode = get(trade, "keyInfo.postalCode") || "";

      // Format address for display

      const addressLine1 =
        streetNumber && streetName ? `${streetNumber} ${streetName}` : "";

      const addressLine2 = unit || "";

      const addressLine3 = city && province ? `${city}, ${province}` : "";

      const addressLine4 = postalCode || "";

      const builderRepaymentEFTs = allCommissionTrustEFTs.filter(
        (eft) => eft.type === "BuilderRepayment",
      );

      const generalToCommissionEFTs = allCommissionTrustEFTs.filter(
        (eft) => eft.type === "GeneralToCommissionTransfer",
      );

      const printContent = `

      <!DOCTYPE html>

      <html>

      <head>

        <title>Trade Record Sheet - ${trade.tradeNumber}</title>

        <style>

          body { font-family: Arial, sans-serif; margin: 15px; font-size: 11px; }

          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }

          .logo { width: 80px; height: auto; }

          .title { font-size: 18px; font-weight: bold; text-align: center; flex-grow: 1; }

          .date-address { text-align: right; font-size: 10px; }

          .date { font-weight: bold; margin-bottom: 5px; }

          .address { line-height: 1.2; }

          .section { margin-bottom: 15px; }

          .section-title { font-size: 14px; font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid #333; padding-bottom: 3px; }

          .property-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }

          .property-item { display: flex; justify-content: space-between; font-size: 10px; }

          .property-label { font-weight: bold; }

          table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9px; }

          .eft-activity-table,
          .commission-recall-table { table-layout: fixed; }

          .eft-activity-table td:nth-child(2),
          .commission-recall-table td:nth-child(1) { white-space: nowrap; }

          .eft-activity-table td:last-child,
          .commission-recall-table td:last-child { word-break: break-word; overflow-wrap: anywhere; }

          th, td { border: 1px solid #ddd; padding: 4px; text-align: left; }

          th { background-color: #f2f2f2; font-weight: bold; }

          .financial-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }

          .financial-item { text-align: center; }

          .financial-label { font-weight: bold; margin-bottom: 3px; font-size: 10px; }

          .financial-value { font-size: 14px; }

          @media print {

            body { margin: 0; }

            .no-print { display: none !important; }

            button { display: none !important; }

            .no-print button { display: none !important; }

          }

        </style>

      </head>

      <body>

        <div class="header">

          <div style="display: flex; flex-direction: column; align-items: flex-start;">

            <img src="${logo2}" alt="Logo" class="logo">

            <div style="font-size: 9px; line-height: 1.2; margin-top: 5px;">

                      365 Realty Brokerage<br>

     66 Antibes Dr, Brampton Ontario L6X 5H5<br>

        Phone: 416-365-0100

            </div>

          </div>

          <div class="title">Trade Record Sheet</div>

          <div class="date-address">

            <div class="date">${currentDate}</div>

            <div class="address">

              ${addressLine1}<br>

              ${addressLine2}<br>

              ${addressLine3}<br>

              ${addressLine4}

            </div>

            <div style="font-size: 10px; font-weight: bold; margin-top: 5px;">

              Trade Number - ${
                get(trade, "keyInfo.tradeNumber") || trade.tradeNumber || "-"
              }

            </div>

          </div>

        </div>



        <div class="section">

          <div class="section-title">Property</div>

          <div class="property-grid">

            <div class="property-item">

              <span class="property-label">Type:</span>

              <span>${get(trade, "keyInfo.propertyType")}</span>

            </div>

            <div class="property-item">

              <span class="property-label">Classification:</span>

              <span>${get(trade, "keyInfo.classification")}</span>

            </div>

            <div class="property-item">

              <span class="property-label">Status:</span>

              <span>${get(trade, "keyInfo.status")}</span>

            </div>

            <div class="property-item">

              <span class="property-label">MLS Number:</span>

              <span>${get(trade, "keyInfo.mlsNumber")}</span>

            </div>

            <div class="property-item">

              <span class="property-label">Offer Date:</span>

              <span>${get(trade, "keyInfo.offerDate")}</span>

            </div>

            <div class="property-item">

              <span class="property-label">Entry Date:</span>

              <span>${get(trade, "keyInfo.entryDate")}</span>

            </div>

            <div class="property-item">

              <span class="property-label">Firm Date:</span>

              <span>${get(trade, "keyInfo.firmDate")}</span>

            </div>

            <div class="property-item">

              <span class="property-label">Close Date:</span>

              <span>${get(trade, "keyInfo.closeDate")}</span>

            </div>

          </div>

        </div>



        <div class="section">

          <div class="section-title">Conditions</div>

          ${
            trade.conditions && trade.conditions.length > 0
              ? `

          <table>

            <thead>

              <tr>

                <th>Condition</th>

                <th>Due Date</th>

                <th>Condition Met Date</th>

              </tr>

            </thead>

            <tbody>

              ${trade.conditions

                .map(
                  (condition) => `

                <tr>

                  <td>${condition.conditionText || "-"}</td>

                  <td>${condition.dueDate || "-"}</td>

                  <td>${condition.conditionMetDate || "Not met"}</td>

                </tr>

              `,
                )

                .join("")}

            </tbody>

          </table>

          `
              : "<p>No conditions available.</p>"
          }

        </div>



        <div class="section">

          <div class="section-title">Contacts</div>

          ${
            trade.people && trade.people.length > 0
              ? `

          <table>

            <thead>

              <tr>

                <th>Type</th>

                <th>First Name</th>

                <th>Last Name</th>

                <th>Primary Phone</th>

                <th>Secondary Phone</th>

                <th>Email</th>

                <th>Company Name</th>

              </tr>

            </thead>

            <tbody>

              ${trade.people

                .map(
                  (person) => `

                <tr>

                  <td>${person.type || "-"}</td>

                  <td>${person.firstName || "-"}</td>

                  <td>${person.lastName || "-"}</td>

                  <td>${person.primaryPhone || "-"}</td>

                  <td>${person.secondaryPhone || "-"}</td>

                  <td>${person.email || "-"}</td>

                  <td>${person.companyName || "-"}</td>

                </tr>

              `,
                )

                .join("")}

            </tbody>

          </table>

          `
              : "<p>No contacts available.</p>"
          }

        </div>



        <div class="section">

          <div class="section-title">Outside Brokers</div>

          ${
            allOutsideBrokersForPrint && allOutsideBrokersForPrint.length > 0
              ? `

          <table>

            <thead>

              <tr>

                <th>Type</th>

                <th>End</th>

                <th>First Name</th>

                <th>Last Name</th>

                <th>Company</th>

                <th>Phone Number</th>

              </tr>

            </thead>

            <tbody>

              ${allOutsideBrokersForPrint

                .map(
                  (broker) => `

                <tr>

                  <td>${broker.type || "-"}</td>

                  <td>${broker.end || "-"}</td>

                  <td>${broker.firstName || "-"}</td>

                  <td>${broker.lastName || "-"}</td>

                  <td>${broker.company || "-"}</td>

                  <td>${broker.primaryPhone || "-"}</td>

                </tr>

              `,
                )

                .join("")}

            </tbody>

          </table>

          `
              : "<p>No outside brokers available.</p>"
          }

        </div>



        <div class="section">

          <div class="section-title">Outside Brokers Commission Details</div>

          ${
            formattedOutsideBrokers.length > 0
              ? `

          <table>

            <thead>

              <tr>

                <th>Agent Name</th>

                <th>Brokerage</th>

                <th>End</th>

                <th>Selling Amount</th>

                ${hasReferralBrokerForOutsidePct ? `<th>Percentage</th>` : ""}

                <th>Tax</th>

                <th>Total</th>

              </tr>

            </thead>

            <tbody>

              ${formattedOutsideBrokers

                .map(
                  (broker) => `

                <tr>

                  <td>${broker.agentName}</td>

                  <td>${broker.brokerage}</td>

                  <td>${broker.end}</td>

                  <td>${formatCurrency(broker.sellingAmount)}</td>

                  ${
                    hasReferralBrokerForOutsidePct
                      ? `<td>${formatOutsideBrokerSharePercent(broker)}</td>`
                      : ""
                  }

                  <td>${formatCurrency(broker.tax)}</td>

                  <td>${formatCurrency(broker.total)}</td>

                </tr>

              `,
                )

                .join("")}

            </tbody>

          </table>

          `
              : "<p>No outside brokers commission details available.</p>"
          }

        </div>



        <div class="section">

          <div class="section-title">Deposit</div>

          ${
            trade.trustRecords && trade.trustRecords.length > 0
              ? `

          <table>

            <thead>

              <tr>

                <th>We Hold</th>

                <th>Received</th>

                <th>Received From</th>

                <th>Held By</th>

                <th>Deposit Date</th>

                <th>Reference</th>

                <th>Amount</th>

                <th>Payment Type</th>

              </tr>

            </thead>

            <tbody>

              ${trade.trustRecords

                .map(
                  (record) => `

                <tr>

                  <td>${record.weHold || "-"}</td>

                  <td>${record.received || "-"}</td>

                  <td>${record.receivedFrom || "-"}</td>

                  <td>${record.heldBy || "-"}</td>

                  <td>${record.depositDate || record.date || "-"}</td>

                  <td>${record.reference || "-"}</td>

                  <td>${formatCurrency(record.amount || 0)}</td>

                  <td>${record.paymentType || "-"}</td>

                </tr>

              `,
                )

                .join("")}

            </tbody>

          </table>

          `
              : "<p>No deposit records available.</p>"
          }

        </div>



        <div class="section">

          <div class="section-title">Financial</div>

          <div style="font-weight:bold; font-size:12px; margin-bottom:4px;">Financial:</div>

          <div style="margin-bottom:4px; font-size:10px;">

            <div>Selling Price: <span style="font-weight:bold;">${formatCurrency(
              commissionIncome.sellPrice || trade.keyInfo?.sellPrice || 0,
            )}</span></div>

          </div>

          <div style="margin-bottom:4px; font-size:10px;">

            <div>Listing Commission: <span style="font-weight:bold;">${parseFloat(
              trade.keyInfo?.listCommission || 0,
            )}%</span></div>

          </div>

          <div style="margin-bottom:4px; font-size:10px;">

            <div>Selling Commission: <span style="font-weight:bold;">${parseFloat(
              trade.keyInfo?.sellCommission || 0,
            )}%</span></div>

          </div>

          <div style="display:flex; font-weight:bold; border-bottom:1px solid #ccc; padding:3px 0; border-top:1px solid #ccc; font-size:9px;">

            <div style="width:25%"></div>

            <div style="width:12%; text-align:center;">Listing</div>

            <div style="width:12%; text-align:center;">Selling</div>

            <div style="width:12%; text-align:center;">Sub-Total</div>

            <div style="width:12%; text-align:center;">HST</div>

            <div style="width:12%; text-align:center;">Total</div>

          </div>

          <div style="font-weight:bold; margin-top:6px; margin-bottom:0; font-size:10px;">Income</div>

          <div style="display:flex; border-bottom:1px solid #ccc; padding:3px 0; font-size:9px;">

            <div style="width:25%">Commission</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              listingAmount,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              sellingAmount,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              subTotal,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              hst,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              total,
            )}</div>

          </div>

          ${
            isCoOperatingSide && referralForExpenses.length === 0
              ? showBaseOfficeAndNetToOffice
                ? `

          <div style="display:flex; padding:3px 0; font-size:9px;">

            <div style="width:25%">Base Office Commission</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionListing,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionSelling,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionSubTotal,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionHST,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionTotal,
            )}</div>

          </div>

          `
                : ""
              : isCoOperatingSide && referralForExpenses.length > 0
                ? showBaseOfficeAndNetToOffice
                  ? `

          <div style="font-weight:bold; margin-top:6px; font-size:10px;">Expenses</div>

          ${expensesRowsForPrint
            .filter((row) => (row.name || "").includes("Referral"))
            .map(
              (row) => `
          <div style="display:flex; border-bottom:1px solid #ccc; padding:3px 0; font-size:9px;">
            <div style="width:25%">Ref. ${(row.name || "").replace(/\s*-\s*Referral\s*$/i, "")}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(row.listing)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(row.selling)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(row.subTotal)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(row.tax)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(row.total)}</div>
          </div>
          `,
            )
            .join("")}

          <div style="display:flex; border-bottom:1px solid #ccc; padding:3px 0; font-size:9px;">

            <div style="width:25%">Base Office Commission</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionListing,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionSelling,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionSubTotal,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionHST,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionTotal,
            )}</div>

          </div>

          `
                  : ""
                : `

          <div style="font-weight:bold; margin-top:6px; font-size:10px;">Expenses</div>

          ${expensesRowsForPrint
            .map(
              (row) => `
          <div style="display:flex; border-bottom:1px solid #ccc; padding:3px 0; font-size:9px;">
            <div style="width:25%">${row.name}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(row.listing)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(row.selling)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(row.subTotal)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(row.tax)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(row.total)}</div>
          </div>
          `,
            )
            .join("")}

          ${
            showBaseOfficeAndNetToOffice
              ? `

          <div style="display:flex; border-bottom:1px solid #ccc; padding:3px 0; font-size:9px;">

            <div style="width:25%">Base Office Commission</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionListing,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionSelling,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionSubTotal,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionHST,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              baseOfficeCommissionTotal,
            )}</div>

          </div>

          `
              : ""
          }

          `
          }

          <div style="font-weight:bold; margin-top:6px; font-size:10px;">Agents</div>

          ${financialAgentRowsForPrint
            .map(
              (agent) => `

          <div style="display:flex; border-bottom:1px solid #ccc; padding:3px 0; font-size:9px;">

            <div style="width:25%">(${agent.agentId || ""}) ${
              agent.agentName || ""
            }</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              agent.agentListing || "0.00",
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              agent.agentSelling || "0.00",
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              agent.agentSubTotal || "0.00",
            )}</div>

            <div style="width:12%; text-align:center;">$${Number(
              agent.agentHST || 0,
            ).toLocaleString("en-CA", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              agent.agentTotal || "0.00",
            )}</div>

          </div>

          ${(agent.officeExpenseRows || [])
            .map(
              (oe) => `
          <div style="display:flex; border-bottom:1px solid #ccc; padding:3px 0; font-size:9px;">
            <div style="width:25%">${oe.name}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(oe.listing)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(oe.selling)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(oe.subTotal)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(oe.tax)}</div>
            <div style="width:12%; text-align:center;">${formatCurrency(oe.total)}</div>
          </div>
          `,
            )
            .join("")}

          `,
            )

            .join("")}

          <!-- Liabilities Section -->

          ${
            totalBuyerRebate > 0
              ? `

          <div style="font-weight:bold; margin-top:6px; font-size:10px;">Liabilities</div>

          <div style="display:flex; border-bottom:1px solid #ccc; padding:3px 0; font-size:9px;">

            <div style="width:25%">Buyer Rebate</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              buyerRebateListing,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              buyerRebateSelling,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              (
                parseFloat(buyerRebateListing) + parseFloat(buyerRebateSelling)
              ).toFixed(2),
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              "0.00",
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              (
                parseFloat(buyerRebateListing) + parseFloat(buyerRebateSelling)
              ).toFixed(2),
            )}</div>

          </div>

          `
              : ""
          }

          ${
            showBaseOfficeAndNetToOffice
              ? `

          <div style="font-weight:bold; margin-top:6px; font-size:10px;">Net to Office</div>

          <div style="display:flex; border-bottom:3px double #000; padding:3px 0; font-size:9px;">

            <div style="width:25%"></div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              netToOfficeListing,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              netToOfficeSelling,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              netToOfficeSubTotal,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              netToOfficeHST,
            )}</div>

            <div style="width:12%; text-align:center;">${formatCurrency(
              netToOfficeTotal,
            )}</div>

          </div>

          `
              : ""
          }

        </div>



        <div class="section">

          <div class="section-title">Agent Details</div>

          ${
            tradeClassification !== "AGENT DOUBLE ENDER"
              ? `
          ${
            agentDetailsForPrint && agentDetailsForPrint.length > 0
              ? `
          <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">

            <thead>

              <tr style="background-color:#f2f2f2;">

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Agent Name</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Agent Number</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Payment Plan</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Agent Base</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Percentage</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Plan Amount</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Buyer Rebate</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Total</th>

              </tr>

            </thead>

            <tbody>

              ${agentDetailsForPrint
                .map(
                  (agent) => `
                <tr>
                  <td style="border:1px solid #ddd; padding:4px;">${agent.agentName || "-"}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${agent.agentId || "-"}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${getPaymentPlanDisplayName(agent.feeInfo) || "-"}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${formatCurrency(parseFloat(agent.amount || 0))}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${agentDetailsPercentForPrint(agent)}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${formatCurrency(agent.feesDeducted || 0)}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${
                    isBuyerRebateIncludedYes(agent) && agent.buyerRebateAmount
                      ? formatCurrency(agent.buyerRebateAmount)
                      : "-"
                  }</td>
                  <td style="border:1px solid #ddd; padding:4px;">${formatCurrency(
                    parseFloat(agent.amount || 0) -
                      parseFloat(agent.feesDeducted || 0) -
                      (isBuyerRebateIncludedYes(agent) &&
                      agent.buyerRebateAmount
                        ? parseFloat(agent.buyerRebateAmount || 0)
                        : 0),
                  )}</td>
                </tr>
              `,
                )
                .join("")}

            </tbody>

          </table>
          `
              : "<p>No agent payment details available.</p>"
          }
          `
              : `
          ${
            agentDetailsForPrint && agentDetailsForPrint.length > 0
              ? `
          <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">

            <thead>

              <tr style="background-color:#f2f2f2;">

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Agent Name</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Agent Number</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Side</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Payment Plan</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Agent Base</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Percentage</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Plan Amount</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Buyer Rebate</th>

                <th style="border:1px solid #ddd; padding:4px; text-align:left;">Total</th>

              </tr>

            </thead>

            <tbody>

              ${agentDetailsForPrint
                .filter(
                  (agent) => agent.classification === "AGENT DOUBLE ENDER",
                )
                .map(
                  (agent) => `
                <tr>
                  <td style="border:1px solid #ddd; padding:4px;">${agent.agentName || "-"}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${agent.agentId || "-"}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${
                    (agent.transactionType || "").toUpperCase() === "SELLING"
                      ? "Selling"
                      : (agent.transactionType || "").toUpperCase() ===
                          "LISTING"
                        ? "Listing"
                        : agent.transactionType || "-"
                  }</td>
                  <td style="border:1px solid #ddd; padding:4px;">${getPaymentPlanDisplayName(agent.feeInfo) || "-"}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${formatCurrency(parseFloat(agent.amount || 0))}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${agentDetailsPercentForPrint(agent)}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${formatCurrency(agent.feesDeducted || 0)}</td>
                  <td style="border:1px solid #ddd; padding:4px;">${
                    isBuyerRebateIncludedYes(agent) && agent.buyerRebateAmount
                      ? formatCurrency(agent.buyerRebateAmount)
                      : "-"
                  }</td>
                  <td style="border:1px solid #ddd; padding:4px;">${formatCurrency(
                    parseFloat(agent.amount || 0) -
                      parseFloat(agent.feesDeducted || 0) -
                      (isBuyerRebateIncludedYes(agent) &&
                      agent.buyerRebateAmount
                        ? parseFloat(agent.buyerRebateAmount || 0)
                        : 0),
                  )}</td>
                </tr>
              `,
                )
                .join("")}

            </tbody>

          </table>
          `
              : "<p>No agent payment details available.</p>"
          }
          `
          }

        </div>



        <div class="section">

          <div class="section-title">Trust Activity</div>

          ${
            trade.trustRecords && trade.trustRecords.length > 0
              ? `<table><thead><tr>

                  <th>Received From</th><th>Deposit Date</th><th>Reference</th><th>Amount</th>

                </tr></thead><tbody>

                ${trade.trustRecords

                  .map(
                    (record) => `<tr>

                      <td>${record.receivedFrom || "-"}</td>

                      <td>${record.depositDate || record.date || "-"}</td>

                      <td>${record.reference || "-"}</td>

                      <td>${formatCurrency(record.amount || 0)}</td>

                    </tr>`,
                  )

                  .join("")}

                </tbody></table>`
              : `<div class="text-gray-500">No trust records available.</div>`
          }

        </div>



        <div class="section">

          <div class="section-title">Real Estate Trust Payments</div>

          ${
            realEstateTrustEFTs.length > 0
              ? `<table><thead><tr>

                  <th>EFT #</th><th>Date</th><th>Amount</th><th>Recipient</th><th>Type</th><th>Description</th>

                </tr></thead><tbody>

                ${realEstateTrustEFTs

                  .map(
                    (eft) => `<tr>

                      <td>${eft.eftNumber || ""}</td>

                      <td>${
                        eft.chequeDate || eft.date
                          ? formatDate(eft.chequeDate || eft.date)
                          : "-"
                      }</td>

                      <td>${formatCurrency(eft.amount || "")}</td>

                      <td>${eft.recipient || ""}</td>

                      <td>${getEFTTypeDisplayName(eft.type) || ""}</td>

                      <td>${eft.description || ""}</td>

                    </tr>`,
                  )

                  .join("")}

                </tbody></table>`
              : `<div class="text-gray-500">No Real Estate Trust Payments found for this trade.</div>`
          }

        </div>



        <div class="section">

          <div class="section-title">Commission Trust Activity</div>

          ${(() => {
            let displayCommissionTrustEFTs = buildDisplayCommissionTrustEfts(
              trade,
              realEstateTrustEFTs,
              commissionTrustEFTs,
              ledgerEntries,
            );

            if (
              !showBaseOfficeAndNetToOffice &&
              agentCalculationsFiltered &&
              agentCalculationsFiltered.length > 0
            ) {
              const selectedAgents = agentCalculationsFiltered;
              displayCommissionTrustEFTs = displayCommissionTrustEFTs.filter(
                (eft) => {
                  if (eft.type !== "AgentCommissionTransfer") return false;
                  return selectedAgents.some((selectedAgent) => {
                    const selectedAgentId =
                      selectedAgent?.agentId != null
                        ? selectedAgent.agentId.toString()
                        : "";
                    const selectedAgentName = (selectedAgent?.agentName || "")
                      .trim()
                      .toLowerCase();
                    const matchId =
                      selectedAgentId &&
                      eft.agentId != null &&
                      eft.agentId.toString() === selectedAgentId;
                    const matchName =
                      selectedAgentName &&
                      eft.agentName &&
                      (eft.agentName || "").trim().toLowerCase() ===
                        selectedAgentName;
                    const matchRecipient =
                      selectedAgentName &&
                      eft.recipient &&
                      (eft.recipient || "")
                        .trim()
                        .toLowerCase()
                        .includes(selectedAgentName);
                    return matchId || matchName || matchRecipient;
                  });
                },
              );
            }

            return displayCommissionTrustEFTs.length > 0
              ? `<table><thead><tr>

                    <th>EFT #</th><th>Date</th><th>Amount</th><th>Recipient</th><th>Type</th><th>Description</th>

                  </tr></thead><tbody>

                  ${displayCommissionTrustEFTs

                    .map(
                      (eft) => `<tr>

                        <td>${eft.eftNumber || ""}</td>

                        <td>${
                          eft.chequeDate || eft.date
                            ? formatDate(eft.chequeDate || eft.date)
                            : "-"
                        }</td>

                        <td>${formatCurrency(eft.amount || "")}</td>

                        <td>${eft.recipient || ""}</td>

                        <td>${getEFTTypeDisplayName(eft.type) || ""}</td>

                        <td>${eft.description || ""}</td>

                      </tr>`,
                    )

                    .join("")}

                  </tbody></table>`
              : `<div class="text-gray-500">No Commission Trust Activity found for this trade.</div>`;
          })()}

        </div>



        <div class="section">

          <div class="section-title">Commission Recalled</div>

          ${buildCommissionRecallTableHtml(
            commissionRecalls,
            "No commission recalls recorded for this trade.",
          )}

        </div>



        <div class="section">

          <div class="section-title">Builder Repayment (Payment to Builder)</div>

          ${buildEftActivityTableHtml(
            builderRepaymentEFTs,
            "No builder repayments recorded for this trade.",
          )}

        </div>



        <div class="section">

          <div class="section-title">General to Commission Transfer</div>

          ${buildEftActivityTableHtml(
            generalToCommissionEFTs,
            "No general to commission transfers recorded for this trade.",
          )}

        </div>



        <div class="section">

          <div class="section-title">Commission Trust Agreement</div>

          <div style="margin-bottom: 15px; font-size: 10px; line-height: 1.4;">

            It is understood between all parties that this agreement shall constitute a Commission Trust Agreement as set out in the contract.

          </div>

          <div style="margin-bottom: 15px; font-size: 10px; line-height: 1.4;">

            To the best of my knowledge the above information is correct. Dated at Brampton on ${currentDate}

          </div>

          ${(agentSignaturesForPrint && agentSignaturesForPrint.length > 0
            ? agentSignaturesForPrint
            : []
          )
            .map(
              (agent) => `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div style="font-size: 10px;">
              ${agent.agentName || "Agent Name"}, ${agent.agentId ?? "Agent Number"}
            </div>
            <div style="border-bottom: 1px solid #000; width: 200px; height: 20px;"></div>
          </div>
`,
            )
            .join("")}
          ${
            !agentSignaturesForPrint || agentSignaturesForPrint.length === 0
              ? `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div style="font-size: 10px;">Agent Name, Agent Number</div>
            <div style="border-bottom: 1px solid #000; width: 200px; height: 20px;"></div>
          </div>
`
              : ""
          }

          <div style="display: flex; justify-content: space-between; align-items: center;">

            <div style="font-size: 10px;">

              Broker of Record: 365 Realty Brokerage

            </div>

            <div style="border-bottom: 1px solid #000; width: 200px; height: 20px;"></div>

          </div>

        </div>

        <div class="no-print" style="position: fixed; top: 20px; right: 20px;">

          <button onclick="window.print()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">Print</button>

          ${
            useCurrentWindow
              ? ""
              : '<button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer; margin-left: 10px;">Close</button>'
          }

        </div>

      </body>

      </html>

    `;

      printWindow.document.write(printContent);

      printWindow.document.close();

      // Wait for content to load then automatically print

      setTimeout(() => {
        try {
          printWindow.print();

          // Close the window after a delay to allow printing to complete

          if (!useCurrentWindow) {
            setTimeout(() => {
              printWindow.close();
            }, 1000);
          }

          // Show success message

          if (!useCurrentWindow) {
            setTimeout(() => {
              alert("Print dialog opened successfully!");
            }, 100);
          }
        } catch (printError) {
          console.error("Print error:", printError);

          // If automatic print fails, keep the window open for manual printing

          if (!useCurrentWindow) {
            printWindow.focus();
          }

          alert(
            "Print dialog failed to open. The report is ready for manual printing.",
          );
        }
      }, 500);
    } catch (error) {
      console.error("Error generating print report:", error);

      alert("Error generating print report. Please try again.");
    } finally {
      setIsPrinting(false);
    }
  };

  // Helper to generate transaction details for this trade

  const getTransactionDetails = () => {
    // You may want to adjust these values to match your backend logic

    const commissionIncome = trade.commission?.commissionIncomeRows?.[0] || {};

    const firstAgent = trade.agentCommissionList?.[0] || {};

    const address = `${get(trade, "keyInfo.streetNumber") || ""} ${
      get(trade, "keyInfo.streetName") || ""
    }`.trim();

    const commissionDescription = `Trade #${trade.tradeNumber} - ${address}`;

    const commissionDate = get(trade, "keyInfo.closeDate") || "-";

    const totalFees = parseFloat(firstAgent.feesDeducted || 0);

    const hstInputTaxCredit =
      parseFloat(commissionIncome.sellingAmount || 0) * 0.13;

    const agentAmount = parseFloat(firstAgent.amount || 0);

    const agentNetCommission = parseFloat(firstAgent.netCommission || 0);

    const feesDeducted = parseFloat(firstAgent.feesDeducted || 0);

    const feeTaxCredits = buildFeeTaxCreditEntries({
      agent: firstAgent,
      taxRate: getTradeTaxRate(trade),
      description: commissionDescription,
      date: commissionDate,
    }).map((e) => ({
      date: commissionDate,
      accountNumber: e.accountNumber,
      accountName: e.accountName,
      debit: e.debit || "",
      credit: e.credit || "",
      description: commissionDescription,
    }));

    // Main 8 transactions

    const mainTxns = [
      {
        date: commissionDate,

        accountNumber: "40100",

        accountName: "Commission Income",

        debit: "",

        credit: commissionIncome.listingAmount,

        description: commissionDescription,
      },

      {
        date: commissionDate,

        accountNumber: "23001",

        accountName: "HST Input Tax Credit",

        debit: commissionIncome.sellingAmount * 0.13,

        credit: "",

        description: commissionDescription,
      },

      {
        date: commissionDate,

        accountNumber: "23000",

        accountName: "HST Collected",

        debit: "",

        credit: commissionIncome.sellingAmount * 0.13,

        description: commissionDescription,
      },

      {
        date: commissionDate,

        accountNumber: "50100",

        accountName: "Agent's Commission",

        debit: agentAmount,

        credit: "",

        description: commissionDescription,
      },

      {
        date: commissionDate,

        accountNumber: "21500",

        accountName: "Commission Payable",

        debit: "",

        credit: agentNetCommission,

        description: commissionDescription,
      },

      {
        date: commissionDate,

        accountNumber: "44100",

        accountName: "Fee Deducted Income",

        debit: "",

        credit: feesDeducted,

        description: commissionDescription,
      },

      ...feeTaxCredits,

      {
        date: commissionDate,

        accountNumber: "12200",

        accountName: "A/R - Commission From Deals",

        debit: commissionIncome.listingAmount
          ? (
              parseFloat(commissionIncome.listingAmount) + hstInputTaxCredit
            ).toFixed(2)
          : "",

        credit: "",

        description: commissionDescription,
      },
    ];

    // Next 2 transactions (Payment Received)

    const paymentTxns = [
      {
        date: commissionDate,

        accountNumber: "10004",

        accountName: "CASH - COMMISSION TRUST ACCOUNT",

        debit: agentNetCommission,

        credit: "",

        description: `Trade #${trade.tradeNumber}, Paid to: Agent`,
      },

      {
        date: commissionDate,

        accountNumber: "21500",

        accountName: "Commission Payable",

        debit: agentNetCommission,

        credit: "",

        description: `Trade #${trade.tradeNumber}, Paid to: Agent`,
      },

      {
        date: commissionDate,

        accountNumber: "10004",

        accountName: "CASH - COMMISSION TRUST ACCOUNT",

        debit: feesDeducted,

        credit: "",

        description: `Trade #${trade.tradeNumber}, Paid to: 365 Realty Brokerage`,
      },

      {
        date: commissionDate,

        accountNumber: "10001",

        accountName: "CASH - CURRENT ACCOUNT",

        debit: "",

        credit: feesDeducted,

        description: `Trade #${trade.tradeNumber}, Paid to: 365 Realty Brokerage`,
      },
    ];

    return { mainTxns, paymentTxns };
  };

  // EFTPaymentTables component for displaying EFT tables

  const EFTPaymentTables = ({ trade }) => {
    const [realEstateTrustEFTs, setRealEstateTrustEFTs] = useState([]);

    const [commissionTrustEFTs, setCommissionTrustEFTs] = useState([]);

    const [allCommissionTrustEFTs, setAllCommissionTrustEFTs] = useState([]);

    const [commissionRecalls, setCommissionRecalls] = useState([]);

    const [ledgerEntries, setLedgerEntries] = useState([]);

    const [generalAccountEFTs, setGeneralAccountEFTs] = useState([]);

    const [loading, setLoading] = useState(false);

    const [error, setError] = useState("");

    useEffect(() => {
      if (!trade || !trade._id) return;

      setLoading(true);

      setError("");

      // Fetch Real Estate Trust EFTs

      axiosInstance

        .get(`/real-estate-trust-eft/trade/${trade._id}`)

        .then((res) => setRealEstateTrustEFTs(res.data))

        .catch(() => setRealEstateTrustEFTs([]));

      // Fetch Commission Trust EFTs

      axiosInstance

        .get(`/commission-trust-eft/trade/${trade._id}`)

        .then((res) => {
          const all = res.data || [];
          setAllCommissionTrustEFTs(all);
          setCommissionTrustEFTs(excludeSeparateTrustActivityEfts(all));
        })

        .catch(() => {
          setAllCommissionTrustEFTs([]);
          setCommissionTrustEFTs([]);
        });

      axiosInstance

        .get(`/commission-recalls?tradeId=${trade._id}`)

        .then((res) => setCommissionRecalls(res.data || []))

        .catch(() => setCommissionRecalls([]));

      // Fetch ledger entries and filter for this trade

      axiosInstance

        .get("/ledger")

        .then((res) => {
          const allLedgerEntries = res.data || [];

          const tradeNumber = trade.tradeNumber || trade.keyInfo?.tradeNumber;

          const filteredEntries = allLedgerEntries.filter(
            (entry) =>
              entry.tradeNumber === tradeNumber ||
              (entry.description &&
                entry.description.includes(`Trade #: ${tradeNumber}`)),
          );

          setLedgerEntries(filteredEntries);
        })

        .catch(() => setLedgerEntries([]));

      // For General Account EFTs, we need a vendorId (not directly available from trade)

      // If you have a way to relate trade to vendor, add logic here. For now, leave empty.

      setLoading(false);
    }, [trade]);

    return (
      <div className="mb-8">
        {/* Real Estate Trust Payments Table */}

        <div className="mb-6">
          <h3 className="font-semibold text-lg mb-2">
            Real Estate Trust Payments
          </h3>

          {realEstateTrustEFTs.length > 0 ? (
            <table className="min-w-full border border-gray-300 mb-2 text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left bg-gray-100 border">
                    EFT #
                  </th>

                  <th className="px-2 py-1 text-left bg-gray-100 border">
                    Date
                  </th>

                  <th className="px-2 py-1 text-left bg-gray-100 border">
                    Amount
                  </th>

                  <th className="px-2 py-1 text-left bg-gray-100 border">
                    Recipient
                  </th>

                  <th className="px-2 py-1 text-left bg-gray-100 border">
                    Type
                  </th>

                  <th className="px-2 py-1 text-left bg-gray-100 border">
                    Description
                  </th>
                </tr>
              </thead>

              <tbody>
                {realEstateTrustEFTs.map((eft) => (
                  <tr key={eft._id}>
                    <td className="border px-2 py-1">{eft.eftNumber}</td>

                    <td className="border px-2 py-1">
                      {eft.chequeDate || eft.date
                        ? new Date(
                            eft.chequeDate || eft.date,
                          ).toLocaleDateString()
                        : "-"}
                    </td>

                    <td className="border px-2 py-1">
                      {formatCurrency(eft.amount)}
                    </td>

                    <td className="border px-2 py-1">{eft.recipient}</td>

                    <td className="border px-2 py-1">
                      {getEFTTypeDisplayName(eft.type)}
                    </td>

                    <td className="border px-2 py-1">{eft.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-gray-500">
              No Real Estate Trust Payments found for this trade.
            </div>
          )}
        </div>

        {/* Commission Trust Activity Table */}

        <div className="mb-6">
          <h3 className="font-semibold text-lg mb-2">
            Commission Trust Activity
          </h3>

          {(() => {
            const displayCommissionTrustEFTs = buildDisplayCommissionTrustEfts(
              trade,
              realEstateTrustEFTs,
              commissionTrustEFTs,
              ledgerEntries,
            );

            return displayCommissionTrustEFTs.length > 0 ? (
              <table className="min-w-full border border-gray-300 mb-2 text-sm">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left bg-gray-100 border">
                      EFT #
                    </th>

                    <th className="px-2 py-1 text-left bg-gray-100 border">
                      Date
                    </th>

                    <th className="px-2 py-1 text-left bg-gray-100 border">
                      Amount
                    </th>

                    <th className="px-2 py-1 text-left bg-gray-100 border">
                      Recipient
                    </th>

                    <th className="px-2 py-1 text-left bg-gray-100 border">
                      Type
                    </th>

                    <th className="px-2 py-1 text-left bg-gray-100 border">
                      Description
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {displayCommissionTrustEFTs.map((eft) => (
                    <tr key={eft._id || eft.eftNumber}>
                      <td className="border px-2 py-1">{eft.eftNumber}</td>

                      <td className="border px-2 py-1">
                        {eft.chequeDate || eft.date
                          ? new Date(
                              eft.chequeDate || eft.date,
                            ).toLocaleDateString()
                          : "-"}
                      </td>

                      <td className="border px-2 py-1">
                        {formatCurrency(eft.amount)}
                      </td>

                      <td className="border px-2 py-1">{eft.recipient}</td>

                      <td className="border px-2 py-1">
                        {getEFTTypeDisplayName(eft.type)}
                      </td>

                      <td className="border px-2 py-1">{eft.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-gray-500">
                No Commission Trust Activity found for this trade.
              </div>
            );
          })()}
        </div>

        <div className="mb-6">
          <h3 className="font-semibold text-lg mb-2">Commission Recalled</h3>
          <CommissionRecallTable
            recalls={commissionRecalls}
            emptyMessage="No commission recalls recorded for this trade."
          />
        </div>

        <div className="mb-6">
          <h3 className="font-semibold text-lg mb-2">
            Builder Repayment (Payment to Builder)
          </h3>
          <EftActivityTable
            efts={allCommissionTrustEFTs.filter(
              (eft) => eft.type === "BuilderRepayment",
            )}
            emptyMessage="No builder repayments recorded for this trade."
          />
        </div>

        <div className="mb-6">
          <h3 className="font-semibold text-lg mb-2">
            General to Commission Transfer
          </h3>
          <EftActivityTable
            efts={allCommissionTrustEFTs.filter(
              (eft) => eft.type === "GeneralToCommissionTransfer",
            )}
            emptyMessage="No general to commission transfers recorded for this trade."
          />
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-4xl w-full relative overflow-y-auto max-h-[90vh]">
        {/* Top-right action buttons */}

        <div className="flex gap-3 absolute top-4 right-6 z-10">
          <button
            type="button"
            onClick={() => {
              setShowNotesModal(true);
              setNoteSaveStatus("");
            }}
            className="bg-amber-700 text-white px-4 py-2 rounded hover:bg-amber-800 transition-colors"
          >
            Note
          </button>

          <button
            onClick={() => {
              const agents = (trade?.agentCommissionList || []).filter(
                (a) => (a.classification || "").toUpperCase() !== "REFERRAL",
              );
              if (agents.length > 1) {
                setShowPrintAgentModal(true);
              } else {
                handlePrint(null);
              }
            }}
            disabled={isPrinting}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPrinting ? "Generating..." : "Print"}
          </button>

          <button
            onClick={() => setShowEditModal(true)}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors"
          >
            Edit
          </button>

          <button
            className="text-2xl text-gray-500 hover:text-gray-700 px-2"
            onClick={onClose}
            style={{ lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        {showEditModal ? (
          <TradeEditModal
            trade={trade}
            onClose={() => setShowEditModal(false)}
            onUpdate={onUpdate}
          />
        ) : (
          <>
            <h2 className="text-2xl font-bold mb-6 text-yellow-700 mt-8">
              Trade Details: #{trade.tradeNumber}
            </h2>

            {/* Address Section */}

            <div className="mb-4">
              <h3 className="font-semibold text-lg mb-2">Address</h3>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div>
                  <span className="text-gray-500 font-normal">Street #</span>

                  <br />

                  {get(trade, "keyInfo.streetNumber")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Street Name</span>

                  <br />

                  {get(trade, "keyInfo.streetName")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Unit</span>

                  <br />

                  {get(trade, "keyInfo.unit")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">City</span>

                  <br />

                  {get(trade, "keyInfo.city")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Province</span>

                  <br />

                  {get(trade, "keyInfo.province")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Postal Code</span>

                  <br />

                  {get(trade, "keyInfo.postalCode")}
                </div>
              </div>
            </div>

            {/* Dates Section */}

            <div className="mb-4">
              <h3 className="font-semibold text-lg mb-2">Important Dates</h3>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div>
                  <span className="text-gray-500 font-normal">Offer Date</span>

                  <br />

                  {get(trade, "keyInfo.offerDate")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Firm Date</span>

                  <br />

                  {get(trade, "keyInfo.firmDate")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Close Date</span>

                  <br />

                  {get(trade, "keyInfo.closeDate")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Entry Date</span>

                  <br />

                  {get(trade, "keyInfo.entryDate")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">
                    Finalized Date
                  </span>

                  <br />

                  {get(trade, "keyInfo.finalizedDate")}
                </div>
              </div>
            </div>

            {/* Key Information Section */}

            <div className="mb-4">
              <h3 className="font-semibold text-lg mb-2">Key Information</h3>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div>
                  <span className="text-gray-500 font-normal">
                    Listing Number
                  </span>

                  <br />

                  {get(trade, "keyInfo.listingNumber")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Sell Price</span>

                  <br />

                  {get(trade, "keyInfo.sellPrice")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">
                    Classification
                  </span>

                  <br />

                  {get(trade, "keyInfo.classification")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Firm</span>

                  <br />

                  {get(trade, "keyInfo.firm")}
                </div>
              </div>
            </div>

            {/* Commission */}

            <div className="mb-4">
              <h3 className="font-semibold text-lg mb-2">Commission</h3>

              <div className="grid grid-cols-2 md:grid-cols-2 gap-2">
                <div>
                  <span className="text-gray-500 font-normal">List %</span>

                  <br />

                  {get(trade, "keyInfo.listCommission")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Sell %</span>

                  <br />

                  {get(trade, "keyInfo.sellCommission")}
                </div>
              </div>
            </div>

            {/* Property Details */}

            <div className="mb-4">
              <h3 className="font-semibold text-lg mb-2">Property Details</h3>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div>
                  <span className="text-gray-500 font-normal">
                    Property Type
                  </span>

                  <br />

                  {get(trade, "keyInfo.propertyType")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">Status</span>

                  <br />

                  {get(trade, "keyInfo.status")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">MLS #</span>

                  <br />

                  {get(trade, "keyInfo.mlsNumber")}
                </div>

                <div>
                  <span className="text-gray-500 font-normal">We Manage</span>

                  <br />

                  {get(trade, "keyInfo.weManage")}
                </div>
              </div>
            </div>

            {/* People Information Section */}

            <div className="mb-6">
              <h3 className="font-semibold text-lg mb-2">People Information</h3>

              {trade.people && trade.people.length > 0 ? (
                <table className="min-w-full border border-gray-300 mb-2 text-sm">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Type
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        First Name
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Last Name
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Primary Phone
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Secondary Phone
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Email
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Company Name
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {trade.people.map((person, idx) => (
                      <tr key={idx}>
                        <td className="border px-2 py-1">{person.type}</td>

                        <td className="border px-2 py-1">
                          {person.firstName || "-"}
                        </td>

                        <td className="border px-2 py-1">
                          {person.lastName || "-"}
                        </td>

                        <td className="border px-2 py-1">
                          {person.primaryPhone || "-"}
                        </td>

                        <td className="border px-2 py-1">
                          {person.secondaryPhone || "-"}
                        </td>

                        <td className="border px-2 py-1">
                          {person.email || "-"}
                        </td>

                        <td className="border px-2 py-1">
                          {person.companyName || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-gray-500">
                  No people information available.
                </div>
              )}
            </div>

            {/* Outside Brokers Section — includes referral agents from Agent Info */}

            <div className="mb-6">
              <h3 className="font-semibold text-lg mb-2">Outside Brokers</h3>

              {(() => {
                const referralAgents = (trade.agentCommissionList || []).filter(
                  (a) => (a.classification || "").toUpperCase() === "REFERRAL",
                );
                const referralAsBrokers = referralAgents.map((a) => ({
                  type: "Referral",
                  firstName: "-",
                  lastName: "-",
                  company: a.agentName || "Referral",
                  end: "Selling End",
                  primaryPhone: "-",
                }));
                const allOutsideBrokers = [
                  ...(trade.outsideBrokers || []),
                  ...referralAsBrokers,
                ];
                return allOutsideBrokers.length > 0 ? (
                  <table className="min-w-full border border-gray-300 mb-2 text-sm">
                    <thead>
                      <tr>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Type
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          End
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          First Name
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Last Name
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Company
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Phone Number
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {allOutsideBrokers.map((broker, idx) => (
                        <tr key={idx}>
                          <td className="border px-2 py-1">
                            {broker.type || "-"}
                          </td>
                          <td className="border px-2 py-1">
                            {broker.end || "-"}
                          </td>
                          <td className="border px-2 py-1">
                            {broker.firstName || "-"}
                          </td>
                          <td className="border px-2 py-1">
                            {broker.lastName || "-"}
                          </td>
                          <td className="border px-2 py-1">
                            {broker.company || "-"}
                          </td>
                          <td className="border px-2 py-1">
                            {broker.primaryPhone || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-gray-500">
                    No outside brokers information available.
                  </div>
                );
              })()}
            </div>

            {/* Outside Brokers Commission Details — includes referral agents */}

            <div className="mb-6">
              <h3 className="font-semibold text-lg mb-2">
                Outside Brokers Commission Details
              </h3>

              {(() => {
                const referralAgentsForCommission = (
                  trade.agentCommissionList || []
                ).filter(
                  (a) => (a.classification || "").toUpperCase() === "REFERRAL",
                );
                const referralCommissionRows = referralAgentsForCommission.map(
                  (a) => ({
                    agentName: a.agentName || "",
                    brokerage: a.agentName || "Referral",
                    end: "Selling End",
                    sellingAmount: a.amount || "0",
                    tax: a.tax || "0",
                    total: a.total || "0",
                    isReferral: true,
                  }),
                );
                const allCommissionRows = [
                  ...(trade.commission?.outsideBrokersRows || []).map(
                    (row) => ({
                      ...row,
                      isReferral: false,
                    }),
                  ),
                  ...referralCommissionRows,
                ];
                const getEndValueForPrint = (b) => {
                  const matchingBroker1 = trade.outsideBrokers?.find((ob) => {
                    const outsideBrokerName =
                      `${ob.firstName} ${ob.lastName}`.trim();
                    return (
                      outsideBrokerName === b.agentName ||
                      ob.company === b.brokerage
                    );
                  });
                  if (matchingBroker1) {
                    if (
                      matchingBroker1.end?.toLowerCase().includes("listing") ||
                      matchingBroker1.type?.toLowerCase().includes("listing")
                    )
                      return "Listing";
                  }
                  if (
                    b.end?.toLowerCase().includes("listing") ||
                    b.type?.toLowerCase().includes("listing")
                  )
                    return "Listing";
                  return "Selling";
                };
                const commissionIncomeUi =
                  trade.commission?.commissionIncomeRows?.[0] || {};
                const listingAmtUi =
                  commissionIncomeUi.listingAmount &&
                  commissionIncomeUi.listingAmount !== ""
                    ? parseFloat(commissionIncomeUi.listingAmount)
                    : 0;
                const sellingAmtUi =
                  commissionIncomeUi.sellingAmount &&
                  commissionIncomeUi.sellingAmount !== ""
                    ? parseFloat(commissionIncomeUi.sellingAmount)
                    : 0;
                const showReferralOutsidePctCol =
                  referralAgentsForCommission.length > 0;
                const outsideBrokerSharePctUi = (b) => {
                  if (!showReferralOutsidePctCol) return "";
                  if (!b.isReferral) return "-";
                  const endLabel = getEndValueForPrint(b);
                  const denom =
                    endLabel === "Listing" ? listingAmtUi : sellingAmtUi;
                  const num =
                    parseFloat(
                      String(b.sellingAmount ?? "0").replace(/,/g, ""),
                    ) || 0;
                  if (!(denom > 0)) return "-";
                  return `${roundTo2((num / denom) * 100)}%`;
                };
                return allCommissionRows.length > 0 ? (
                  <table className="min-w-full border border-gray-300 mb-2 text-sm">
                    <thead>
                      <tr>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Name
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Brokerage
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          End
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Selling Amount
                        </th>
                        {showReferralOutsidePctCol ? (
                          <th className="px-2 py-1 text-left bg-gray-100 border">
                            Percentage
                          </th>
                        ) : null}
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Tax
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {allCommissionRows.map((broker, idx) => (
                        <tr key={idx}>
                          <td className="border px-2 py-1">
                            {broker.agentName || "-"}
                          </td>
                          <td className="border px-2 py-1">
                            {broker.brokerage || "-"}
                          </td>
                          <td className="border px-2 py-1">
                            {getEndValueForPrint(broker)}
                          </td>
                          <td className="border px-2 py-1">
                            {formatCurrency(broker.sellingAmount)}
                          </td>
                          {showReferralOutsidePctCol ? (
                            <td className="border px-2 py-1">
                              {outsideBrokerSharePctUi(broker)}
                            </td>
                          ) : null}
                          <td className="border px-2 py-1">
                            {formatCurrency(broker.tax)}
                          </td>
                          <td className="border px-2 py-1">
                            {formatCurrency(broker.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-gray-500">
                    No outside brokers commission details available.
                  </div>
                );
              })()}
            </div>

            {/* Trust Records Section */}

            <div className="mb-6">
              <h3 className="font-semibold text-lg mb-2">Trust Records</h3>

              {trade.trustRecords && trade.trustRecords.length > 0 ? (
                <table className="min-w-full border border-gray-300 mb-2 text-sm">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        We Hold
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Received
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Received From
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Held By
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Deposit Date
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Reference
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Amount
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Payment Type
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {trade.trustRecords.map((t, idx) => (
                      <tr key={idx}>
                        <td className="border px-2 py-1">{t.weHold || "-"}</td>

                        <td className="border px-2 py-1">
                          {t.received || "-"}
                        </td>

                        <td className="border px-2 py-1">
                          {t.receivedFrom || "-"}
                        </td>

                        <td className="border px-2 py-1">{t.heldBy || "-"}</td>

                        <td className="border px-2 py-1">
                          {t.depositDate || t.date || "-"}
                        </td>

                        <td className="border px-2 py-1">
                          {t.reference || "-"}
                        </td>

                        <td className="border px-2 py-1">
                          {formatCurrency(t.amount || "-")}
                        </td>

                        <td className="border px-2 py-1">
                          {t.paymentType || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-gray-500">No trust records.</div>
              )}
            </div>

            {/* Conditions Section */}

            <div className="mb-6">
              <h3 className="font-semibold text-lg mb-2">Conditions</h3>

              {trade.conditions && trade.conditions.length > 0 ? (
                <table className="min-w-full border border-gray-300 mb-2 text-sm">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Condition
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Due Date
                      </th>

                      <th className="px-2 py-1 text-left bg-gray-100 border">
                        Condition Met Date
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {trade.conditions.map((condition, idx) => (
                      <tr key={idx}>
                        <td className="border px-2 py-1">
                          {condition.conditionText || "-"}
                        </td>

                        <td className="border px-2 py-1">
                          {condition.dueDate || "-"}
                        </td>

                        <td className="border px-2 py-1">
                          {condition.conditionMetDate || "Not met"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-gray-500">No conditions available.</div>
              )}
            </div>

            {/* Commission Section */}

            <div className="mb-6">
              <h3 className="font-semibold text-lg mb-2">Commission Details</h3>

              {trade.commission && (
                <>
                  <div className="mb-4">
                    <h4 className="text-gray-700 mb-1">Sale Closing Rows</h4>

                    {renderTable(trade.commission.saleClosingRows)}
                  </div>

                  <div className="mb-4">
                    <h4 className="text-gray-700 mb-1">
                      Commission Income Rows
                    </h4>

                    {renderTable(trade.commission.commissionIncomeRows)}
                  </div>

                  <div className="mb-4">
                    <h4 className="text-gray-700 mb-1">Outside Brokers Rows</h4>

                    {renderTable(trade.commission.outsideBrokersRows)}
                  </div>
                </>
              )}
            </div>

            {/* Agent Commission Info — excludes referral agents (shown under Outside Brokers) */}

            <div className="mb-6">
              <h3 className="font-semibold text-lg mb-2">
                Agent Commission Info
              </h3>

              {(() => {
                const agentListForTable = (
                  trade.agentCommissionList || []
                ).filter(
                  (a) => (a.classification || "").toUpperCase() !== "REFERRAL",
                );
                return agentListForTable.length > 0 ? (
                  <table className="min-w-full border border-gray-300 mb-2 text-sm">
                    <thead>
                      <tr>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Agent Name
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Classification
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Amount
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Net Commission
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Lead
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Fee Info
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Total Fees
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Tax
                        </th>
                        <th className="px-2 py-1 text-left bg-gray-100 border">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentListForTable.map((a, idx) => (
                        <tr key={idx}>
                          <td className="border px-2 py-1">{a.agentName}</td>
                          <td className="border px-2 py-1">
                            {a.classification}
                          </td>
                          <td className="border px-2 py-1">
                            {formatCurrency(a.amount)}
                          </td>
                          <td className="border px-2 py-1">
                            {formatCurrency(a.netCommission)}
                          </td>
                          <td className="border px-2 py-1">{a.lead}</td>
                          <td className="border px-2 py-1">
                            {getPaymentPlanDisplayName(a.feeInfo)}
                          </td>
                          <td className="border px-2 py-1">
                            {formatCurrency(a.totalFees)}
                          </td>
                          <td className="border px-2 py-1">
                            {formatCurrency(a.tax)}
                          </td>
                          <td className="border px-2 py-1">
                            {formatCurrency(a.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-gray-500">No agent commission data.</div>
                );
              })()}
            </div>

            {/* EFT Payment Tables Section */}

            <EFTPaymentTables trade={trade} />

            {/* Transaction Details Section */}

            {/* Removed Trade Finalize and Payment Received tables as requested */}
          </>
        )}
      </div>

      {showPrintAgentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">
              Select agent for Trade Record Sheet
            </h3>

            <div className="space-y-2 mb-4">
              {tradeRecordSheetAgentPickerEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => {
                    setShowPrintAgentModal(false);
                    handlePrint(entry.printIndex);
                  }}
                  className="w-full text-left px-4 py-2 rounded border border-gray-300 hover:bg-gray-100 transition-colors"
                >
                  {entry.label}
                </button>
              ))}

              <button
                type="button"
                onClick={() => {
                  setShowPrintAgentModal(false);
                  handlePrint(null);
                }}
                className="w-full text-left px-4 py-2 rounded border border-gray-300 hover:bg-gray-100 transition-colors font-medium"
              >
                All agents
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowPrintAgentModal(false)}
              className="w-full px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showNotesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">
                Trade Notes #{trade.tradeNumber}
              </h3>
              <button
                type="button"
                onClick={() => setShowNotesModal(false)}
                className="text-2xl text-gray-500 hover:text-gray-700 leading-none px-1"
                aria-label="Close notes"
              >
                &times;
              </button>
            </div>

            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
              {tradeNotes.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {tradeNotes.map((n, idx) => {
                    const when = n.createdAt
                      ? new Date(n.createdAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "";
                    return (
                      <div
                        key={n._id || `${n.createdAt}-${idx}`}
                        className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2 text-sm"
                      >
                        <div className="text-gray-700 font-medium">
                          {n.authorName || "Unknown"}{" "}
                          <span className="font-normal text-gray-500">
                            {when}
                          </span>
                        </div>
                        <div className="text-gray-800 whitespace-pre-wrap mt-1">
                          {n.text}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-gray-500">No notes yet.</div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Note
                </label>
                <textarea
                  value={noteDraft}
                  onChange={(e) => {
                    setNoteDraft(e.target.value);
                    if (noteSaveStatus) setNoteSaveStatus("");
                  }}
                  rows={4}
                  placeholder="Type your note..."
                  className="w-full border border-amber-400 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your name
                </label>
                <input
                  type="text"
                  value={noteAuthor}
                  onChange={(e) => {
                    setNoteAuthor(e.target.value);
                    if (noteSaveStatus) setNoteSaveStatus("");
                  }}
                  placeholder="Enter your name..."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="px-5 py-3 border-t flex items-center justify-between gap-3">
              <span className="text-sm text-gray-500">
                {noteSaving ? "Saving…" : noteSaveStatus}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowNotesModal(false)}
                  className="px-4 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleSaveTradeNote}
                  disabled={noteSaving}
                  className="px-4 py-2 text-sm rounded-md bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {noteSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradeDetailsModal;
