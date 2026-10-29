import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "./Navbar";
import FinanceSidebar from "./FinanceSidebar";
import { FaPrint, FaArrowLeft, FaDownload } from "react-icons/fa";
import axiosInstance from "../config/axios";
import { buildCsv, downloadCsvFile } from "../utils/csvDownload";
import { getTradeTaxRate, hstFromInclusive } from "../constants/tax";
import { roundTo2 } from "../utils/numberUtils";
import { FINANCIAL_REPORT_MIN_DATE } from "../constants/financialReportMinDate";
import { excludeVoidedCommissionTrustEfts } from "../utils/disbursementVoidReplacement";

function isEftDateInRange(eft, fromDate, toDate) {
  if (!fromDate || !toDate) return true;
  const eftDate = new Date(eft?.date);
  if (Number.isNaN(eftDate.getTime())) return false;
  const from = new Date(fromDate + "T00:00:00");
  const to = new Date(toDate + "T23:59:59");
  const eftDateOnly = new Date(
    eftDate.getFullYear(),
    eftDate.getMonth(),
    eftDate.getDate(),
  );
  const fromDateOnly = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
  );
  const toDateOnly = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return eftDateOnly >= fromDateOnly && eftDateOnly <= toDateOnly;
}

function isReferralRow(ac) {
  return (ac.classification || "").toUpperCase() === "REFERRAL";
}

/** Populated trade on EFT, or match from full trades list when `tradeId` is only an id. */
function resolveTradeFromEft(eft, trades) {
  const embedded = eft.tradeId;
  if (
    embedded &&
    typeof embedded === "object" &&
    embedded.agentCommissionList
  ) {
    return embedded;
  }
  const tid = embedded?._id ?? embedded;
  if (tid == null || tid === "") return null;
  return trades.find((t) => String(t._id) === String(tid)) ?? null;
}

/** Match agent from commission row / EFT whether agentId is employee # or Mongo _id. */
function findAgentForReport(agents, rawAgentId) {
  if (rawAgentId == null || rawAgentId === "") return null;
  const s = String(rawAgentId).trim();
  return (
    agents.find(
      (a) => a.employeeNo != null && String(a.employeeNo).trim() === s,
    ) ||
    agents.find((a) => String(a._id) === s) ||
    agents.find((a) => a._id === rawAgentId) ||
    null
  );
}

/** Single canonical key per agent so commission rows and EFTs always match (e.g. "155" not two different id strings). */
function getAgentKeyForReport(agents, rawAgentId, rawAgentName) {
  const agent = findAgentForReport(agents, rawAgentId);
  if (
    agent &&
    agent.employeeNo != null &&
    String(agent.employeeNo).trim() !== ""
  ) {
    return String(agent.employeeNo).trim();
  }
  if (rawAgentId != null && String(rawAgentId).trim() !== "") {
    return String(rawAgentId).trim();
  }
  return String(rawAgentName ?? "").trim();
}

/**
 * Aggregate by agent for the selected period using the same window as
 * "Agent Commission Summary by Agent" (FinancialReportsAgentSummary): each
 * AgentCommissionTransfer EFT whose issue date (chequeDate, else date) falls in range
 * contributes one row to totals and increments Total Trades by one.
 */
const AgentSummaryReport = ({ showFinanceSidebar = true }) => {
  const navigate = useNavigate();
  const authKey = showFinanceSidebar ? "isFinanceAdmin" : "isReportsAdmin";

  useEffect(() => {
    if (sessionStorage.getItem(authKey) !== "true") {
      navigate("/");
    }
  }, [navigate, authKey]);

  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showTable, setShowTable] = useState(false);

  const handleGenerateReport = () => {
    if (!fromDate || !toDate) {
      alert("Please select both From and To dates.");
      return;
    }
    setShowTable(true);
    fetchData();
  };

  const fetchData = async () => {
    try {
      setIsLoading(true);
      if (fromDate && fromDate < FINANCIAL_REPORT_MIN_DATE) {
        alert(
          `Dates must be on or after January 30, 2026. Earlier dates are not available for this report.`,
        );
        setIsLoading(false);
        return;
      }
      if (toDate && toDate < FINANCIAL_REPORT_MIN_DATE) {
        alert(
          `Dates must be on or after January 30, 2026. Earlier dates are not available for this report.`,
        );
        setIsLoading(false);
        return;
      }

      const [tradesRes, agentsRes, eftsRes, reversalsRes] = await Promise.all([
        axiosInstance.get("/trades"),
        axiosInstance.get("/agents"),
        axiosInstance.get("/commission-trust-eft"),
        axiosInstance
          .get("/eft-reversals", { params: { section: "commission" } })
          .catch(() => ({ data: [] })),
      ]);
      const trades = tradesRes.data || [];
      const agents = agentsRes.data || [];
      const commissionTrustEfts = excludeVoidedCommissionTrustEfts(
        eftsRes.data || [],
        reversalsRes.data || [],
      );

      let filteredEfts = commissionTrustEfts.filter(
        (eft) => eft.type === "AgentCommissionTransfer",
      );
      if (fromDate && toDate) {
        filteredEfts = filteredEfts.filter((eft) =>
          isEftDateInRange(eft, fromDate, toDate),
        );
      }
      // Do not block any agents from reports.

      const byAgent = new Map();

      for (const eft of filteredEfts) {
        const agent = findAgentForReport(agents, eft.agentId);
        const agentId = agent?.employeeNo ?? eft.agentId;
        if (agentId == null || String(agentId).trim() === "") continue;
        const agentKey = String(agentId).trim();

        const trade = resolveTradeFromEft(eft, trades);
        if (!trade) continue;

        let ac = null;
        if (trade.agentCommissionList?.length) {
          ac = trade.agentCommissionList.find(
            (row) => row.agentId === eft.agentId,
          );
          if (!ac) {
            ac = trade.agentCommissionList.find(
              (row) => row.agentName === eft.agentName,
            );
          }
          if (!ac && agent?.employeeNo) {
            ac = trade.agentCommissionList.find(
              (row) => row.agentId === agent.employeeNo.toString(),
            );
          }
          if (!ac && trade.agentCommissionList.length === 1) {
            ac = trade.agentCommissionList[0];
          }
        }
        // Do not exclude referral rows here; match Agent Payment Summary Report behavior.

        const agentName =
          (eft.agentName || "").trim() ||
          (agent
            ? `${agent.firstName || ""} ${agent.lastName || ""}`.trim()
            : "");

        if (!byAgent.has(agentKey)) {
          byAgent.set(agentKey, {
            agentId,
            agentName: agentName || String(agentId),
            totalTrades: 0,
            awardAmount: 0,
            /** Same basis as Agent Payment Report: sum(net), sum(hstFromInclusive(net)), then ex-HST = net − HST (avoids per-line penny drift). */
            sumNetIncl: 0,
            sumHstOnNet: 0,
            officeShareExHST: 0,
            hstOffice: 0,
            totalPaidOffice: 0,
          });
        }
        const agg = byAgent.get(agentKey);
        agg.totalTrades += 1;

        const taxRate = getTradeTaxRate(trade);
        const row = ac || {};
        // Match Agent Payment Summary Report: net commission is the EFT amount (HST included).
        const netIncl = roundTo2(parseFloat(eft.amount || 0));

        let calculatedFees = "0.00";
        if (!row.totalFees && agent?.feeInfo) {
          const feePlan = agent.feeInfo;
          let baseFee = 0;
          switch (feePlan) {
            case "plan250":
              baseFee = 250;
              break;
            case "plan500":
              baseFee = 500;
              break;
            case "plan9010":
              baseFee = roundTo2(netIncl * 0.1);
              break;
            case "plan955":
              baseFee = roundTo2(netIncl * 0.05);
              break;
            case "plan8515":
              // Match Agent Payment Summary Report behavior.
              baseFee = roundTo2(netIncl * 0.15);
              break;
            case "plan5050":
              baseFee = roundTo2(netIncl * 0.5);
              break;
            case "plan8020":
              baseFee = roundTo2(netIncl * 0.2);
              break;
            case "plan150":
              baseFee = 150;
              break;
            default:
              baseFee = 0;
          }
          const taxOnFees = roundTo2(baseFee * taxRate);
          calculatedFees = roundTo2(baseFee + taxOnFees).toFixed(2);
        }

        const award = roundTo2(parseFloat(row.awardAmount || 0));
        agg.sumNetIncl += netIncl;
        agg.sumHstOnNet += hstFromInclusive(netIncl, taxRate);

        // Match Agent Payment Summary Report: office share is total fees (HST included).
        let totalO = roundTo2(parseFloat(row.totalFees || calculatedFees || 0));
        let taxO = roundTo2(hstFromInclusive(totalO, taxRate));
        let officeEx = roundTo2(totalO - taxO);
        if (!totalO || totalO === 0) {
          totalO = 0;
          taxO = 0;
          officeEx = 0;
        }

        agg.awardAmount += award;
        agg.officeShareExHST += officeEx;
        agg.hstOffice += taxO;
        agg.totalPaidOffice += totalO;
      }

      const list = Array.from(byAgent.values()).map((a) => {
        const net = Number(a.sumNetIncl) || 0;
        const hstSum = Number(a.sumHstOnNet) || 0;
        const { sumNetIncl, sumHstOnNet, ...rest } = a;
        return {
          ...rest,
          agentCommissionExHST: roundTo2(net - hstSum),
          hstAgent: roundTo2(hstSum),
          totalPaidAgent: roundTo2(net),
        };
      });
      list.sort((a, b) =>
        String(a.agentId).localeCompare(String(b.agentId), undefined, {
          numeric: true,
        }),
      );

      setRows(list);

      const t = list.reduce(
        (acc, r) => ({
          totalTrades: acc.totalTrades + r.totalTrades,
          awardAmount: acc.awardAmount + r.awardAmount,
          agentCommissionExHST:
            acc.agentCommissionExHST + r.agentCommissionExHST,
          hstAgent: acc.hstAgent + r.hstAgent,
          totalPaidAgent: acc.totalPaidAgent + r.totalPaidAgent,
          officeShareExHST: acc.officeShareExHST + r.officeShareExHST,
          hstOffice: acc.hstOffice + r.hstOffice,
          totalPaidOffice: acc.totalPaidOffice + r.totalPaidOffice,
        }),
        {
          totalTrades: 0,
          awardAmount: 0,
          agentCommissionExHST: 0,
          hstAgent: 0,
          totalPaidAgent: 0,
          officeShareExHST: 0,
          hstOffice: 0,
          totalPaidOffice: 0,
        },
      );
      t.totalAgents = list.length;
      setTotals(t);
      setIsLoading(false);
    } catch (e) {
      console.error(e);
      setIsLoading(false);
      alert("Error loading report.");
    }
  };

  const formatCurrency = (n) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(Number(n) || 0);

  const formatDate = (dateString) => {
    if (!dateString) return "";
    if (
      typeof dateString === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(dateString)
    ) {
      return dateString;
    }
    const d = new Date(dateString);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA");
  };

  const handlePrint = () => {
    const w = window.open("", "_blank");
    const gen = new Date().toLocaleDateString("en-CA");
    const period =
      fromDate && toDate
        ? `Period: ${formatDate(fromDate)} to ${formatDate(toDate)} | Generated: ${gen}`
        : `Generated: ${gen}`;

    w.document
      .write(`<!DOCTYPE html><html><head><title>Agent Summary Report</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; margin: 24px; font-size: 11px; color: #111; }
        .header { text-align: center; padding-bottom: 16px; margin-bottom: 0; border-bottom: 3px solid #000; }
        .company { font-size: 20px; font-weight: bold; }
        .title { font-size: 16px; font-weight: bold; margin-top: 8px; }
        .sub { font-size: 12px; color: #444; margin-top: 6px; }
        .meta { font-size: 11px; color: #555; margin-top: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; table-layout: fixed; }
        th, td { border: 1px solid #ccc; padding: 4px 3px; vertical-align: top; }
        th:nth-child(1), td:nth-child(1) { text-align: center; }
        th:nth-child(2), td:nth-child(2) { text-align: left; }
        th:nth-child(3), td:nth-child(3) { text-align: center; }
        th:nth-child(n+4), td:nth-child(n+4) { text-align: right; }
        th { background: #f0f0f0; font-size: 7.5px; line-height: 1.15; font-weight: bold; word-wrap: break-word; overflow-wrap: break-word; }
        td { font-variant-numeric: tabular-nums; font-size: 9px; line-height: 1.2; }
        .footer { margin-top: 22px; font-size: 10px; }
        .footer-row { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; margin: 5px 0; }
        .footer-row .label { text-align: left; }
        .footer-row .val { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .footer-row.final { border-top: 3px solid #000; border-bottom: 3px solid #000; padding: 10px 0; margin-top: 10px; font-weight: bold; }
        .footer-row.final .label, .footer-row.final .val { font-weight: bold; }
      </style></head><body>
      <div class="header">
        <div class="company">365 Realty Brokerage</div>
        <div class="title">Agent Summary Report</div>
        <div class="sub">Commission trust payments by agent</div>
        <div class="meta">${period}</div>
      </div>
      <table>
        <colgroup>
          <col style="width:5%"><col style="width:12%"><col style="width:5%">
          <col style="width:11%"><col style="width:11%"><col style="width:9%">
          <col style="width:11%"><col style="width:10%"><col style="width:9%"><col style="width:17%">
        </colgroup>
        <thead>
          <tr>
            <th>Agent #</th>
            <th>Agent Name</th>
            <th>Total Trades</th>
            <th>Award (EXC HST)</th>
            <th>Agent Commission Portion (HST Excluded)</th>
            <th>HST Paid to Agent</th>
            <th>Total Paid to Agent (including HST)</th>
            <th>Office Share (HST excluded)</th>
            <th>HST Paid to Office</th>
            <th>Total Paid to office (HST included)</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
            <td>${String(r.agentId ?? "")}</td>
            <td>${(r.agentName || "").replace(/</g, "&lt;")}</td>
            <td>${r.totalTrades}</td>
            <td>${formatCurrency(r.awardAmount)}</td>
            <td>${formatCurrency(r.agentCommissionExHST)}</td>
            <td>${formatCurrency(r.hstAgent)}</td>
            <td>${formatCurrency(r.totalPaidAgent)}</td>
            <td>${formatCurrency(r.officeShareExHST)}</td>
            <td>${formatCurrency(r.hstOffice)}</td>
            <td>${formatCurrency(r.totalPaidOffice)}</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
      <div class="footer">
        <div class="footer-row"><span class="label">Total Agents:</span><span class="val">${totals?.totalAgents ?? 0}</span></div>
        <div class="footer-row"><span class="label">Total Trades:</span><span class="val">${totals?.totalTrades ?? 0}</span></div>
        <div class="footer-row"><span class="label">Total Award Amount:</span><span class="val">${formatCurrency(totals?.awardAmount)}</span></div>
        <div class="footer-row"><span class="label">Agent Commission (HST Excluded):</span><span class="val">${formatCurrency(totals?.agentCommissionExHST)}</span></div>
        <div class="footer-row"><span class="label">HST Paid to Agent:</span><span class="val">${formatCurrency(totals?.hstAgent)}</span></div>
        <div class="footer-row"><span class="label">Total Paid to Agent (including HST):</span><span class="val">${formatCurrency(totals?.totalPaidAgent)}</span></div>
        <div class="footer-row"><span class="label">Office Share (HST excluded):</span><span class="val">${formatCurrency(totals?.officeShareExHST)}</span></div>
        <div class="footer-row"><span class="label">HST Paid to Office:</span><span class="val">${formatCurrency(totals?.hstOffice)}</span></div>
        <div class="footer-row final"><span class="label">Total Paid to office (HST included):</span><span class="val">${formatCurrency(totals?.totalPaidOffice)}</span></div>
      </div>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const formatCsvAmount = (n) => String(roundTo2(Number(n) || 0));

  const handleDownloadCsv = () => {
    if (!rows.length || !totals || !fromDate || !toDate) {
      alert("Generate the report first.");
      return;
    }
    const header = [
      "Agent #",
      "Agent Name",
      "Total Trades",
      "Award (EXC HST)",
      "Agent portion (ex HST)",
      "HST to agent",
      "Total to agent",
      "Office (ex HST)",
      "HST to office",
      "Total to office",
    ];
    const dataRows = rows.map((r) => [
      String(r.agentId ?? ""),
      r.agentName ?? "",
      String(r.totalTrades),
      formatCsvAmount(r.awardAmount),
      formatCsvAmount(r.agentCommissionExHST),
      formatCsvAmount(r.hstAgent),
      formatCsvAmount(r.totalPaidAgent),
      formatCsvAmount(r.officeShareExHST),
      formatCsvAmount(r.hstOffice),
      formatCsvAmount(r.totalPaidOffice),
    ]);
    const summaryRows = [
      [],
      ["Summary"],
      ["Period", `${fromDate} to ${toDate}`],
      ["Total Agents", String(totals.totalAgents)],
      ["Total Trades", String(totals.totalTrades)],
      ["Total Award Amount", formatCsvAmount(totals.awardAmount)],
      [
        "Agent Commission (HST Excluded)",
        formatCsvAmount(totals.agentCommissionExHST),
      ],
      ["HST Paid to Agent", formatCsvAmount(totals.hstAgent)],
      [
        "Total Paid to Agent (including HST)",
        formatCsvAmount(totals.totalPaidAgent),
      ],
      ["Office Share (HST excluded)", formatCsvAmount(totals.officeShareExHST)],
      ["HST Paid to Office", formatCsvAmount(totals.hstOffice)],
      [
        "Total Paid to office (HST included)",
        formatCsvAmount(totals.totalPaidOffice),
      ],
    ];
    const csv =
      buildCsv([header, ...dataRows]) + "\r\n" + buildCsv(summaryRows);
    const safeFrom = fromDate.replace(/[^\d-]/g, "");
    const safeTo = toDate.replace(/[^\d-]/g, "");
    downloadCsvFile(`agent-summary-report_${safeFrom}_${safeTo}.csv`, csv);
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <Navbar />
      {!showFinanceSidebar && (
        <div className="w-full flex justify-start pl-3 sm:pl-4 pt-3">
          <button
            type="button"
            onClick={() => navigate("/financial-reports")}
            className="flex items-center text-gray-600 hover:text-gray-800 text-left"
          >
            <FaArrowLeft className="mr-2 shrink-0" />
            Back to Reports
          </button>
        </div>
      )}
      <div className="flex">
        {showFinanceSidebar ? <FinanceSidebar /> : null}
        <div className="flex-1 p-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">
                Agent Summary Report
              </h2>
              {showTable && !isLoading && rows.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  {!showFinanceSidebar && (
                    <button
                      type="button"
                      onClick={handleDownloadCsv}
                      className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                    >
                      <FaDownload />
                      Download CSV
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                  >
                    <FaPrint />
                    Print Report
                  </button>
                </div>
              )}
            </div>

            <div className="bg-gray-50 p-4 rounded-lg mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                Filter by Date Range
              </h3>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleGenerateReport}
                    className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Generate Report
                  </button>
                </div>
              </div>
              {fromDate && toDate && (
                <div className="mt-3 text-sm text-gray-600">
                  Agent Commission Transfer EFTs with an issue date from{" "}
                  {formatDate(fromDate)} to {formatDate(toDate)} (same basis as
                  Agent Commission Summary by Agent).
                </div>
              )}
            </div>

            {showTable && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800">
                    Agent Summary Report
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Commission trust payments by agent
                  </p>
                </div>
                {isLoading ? (
                  <div className="p-12 text-center text-gray-600">Loading…</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[1100px] w-full table-fixed divide-y divide-gray-200 text-xs leading-snug">
                      <colgroup>
                        <col style={{ width: "4%" }} />
                        <col style={{ width: "13%" }} />
                        <col style={{ width: "5%" }} />
                        <col style={{ width: "10%" }} />
                        <col style={{ width: "11%" }} />
                        <col style={{ width: "10%" }} />
                        <col style={{ width: "11%" }} />
                        <col style={{ width: "11%" }} />
                        <col style={{ width: "10%" }} />
                        <col style={{ width: "15%" }} />
                      </colgroup>
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1.5 text-center text-[10px] font-medium text-gray-600 uppercase align-top leading-tight">
                            Agent #
                          </th>
                          <th className="px-2 py-1.5 text-left text-[10px] font-medium text-gray-600 uppercase align-top leading-tight">
                            Agent Name
                          </th>
                          <th className="px-2 py-1.5 text-center text-[10px] font-medium text-gray-600 uppercase align-top leading-tight">
                            Total Trades
                          </th>
                          <th className="px-2 py-1.5 text-right text-[10px] font-medium text-gray-600 uppercase align-top leading-tight">
                            Award (EXC HST)
                          </th>
                          <th className="px-2 py-1.5 text-right text-[10px] font-medium text-gray-600 uppercase align-top leading-tight">
                            Agent portion (ex HST)
                          </th>
                          <th className="px-2 py-1.5 text-right text-[10px] font-medium text-gray-600 uppercase align-top leading-tight">
                            HST to agent
                          </th>
                          <th className="px-2 py-1.5 text-right text-[10px] font-medium text-gray-600 uppercase align-top leading-tight">
                            Total to agent
                          </th>
                          <th className="px-2 py-1.5 text-right text-[10px] font-medium text-gray-600 uppercase align-top leading-tight">
                            Office (ex HST)
                          </th>
                          <th className="px-2 py-1.5 text-right text-[10px] font-medium text-gray-600 uppercase align-top leading-tight">
                            HST to office
                          </th>
                          <th className="px-2 py-1.5 text-right text-[10px] font-medium text-gray-600 uppercase align-top leading-tight">
                            Total to office
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rows.map((r, i) => (
                          <tr
                            key={`${r.agentId}-${i}`}
                            className="hover:bg-gray-50"
                          >
                            <td className="px-2 py-1.5 whitespace-nowrap text-center text-[11px]">
                              {r.agentId}
                            </td>
                            <td className="px-2 py-1.5 break-words min-w-0 text-[11px]">
                              {r.agentName}
                            </td>
                            <td className="px-2 py-1.5 text-center tabular-nums text-[11px]">
                              {r.totalTrades}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">
                              {formatCurrency(r.awardAmount)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">
                              {formatCurrency(r.agentCommissionExHST)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">
                              {formatCurrency(r.hstAgent)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">
                              {formatCurrency(r.totalPaidAgent)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">
                              {formatCurrency(r.officeShareExHST)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">
                              {formatCurrency(r.hstOffice)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">
                              {formatCurrency(r.totalPaidOffice)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length === 0 && (
                      <div className="p-8 text-center text-gray-500">
                        No data for this period (no Agent Commission Transfer
                        EFTs with an issue date in range).
                      </div>
                    )}
                    {totals && rows.length > 0 && (
                      <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 text-xs space-y-1">
                        <div className="flex justify-between gap-4 items-baseline">
                          <span className="text-left">Total Agents:</span>
                          <span className="text-right tabular-nums shrink-0">
                            {totals.totalAgents}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 items-baseline">
                          <span className="text-left">Total Trades:</span>
                          <span className="text-right tabular-nums shrink-0">
                            {totals.totalTrades}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 items-baseline">
                          <span className="text-left">Total Award Amount:</span>
                          <span className="text-right tabular-nums shrink-0">
                            {formatCurrency(totals.awardAmount)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 items-baseline">
                          <span className="text-left">
                            Agent Commission (HST Excluded):
                          </span>
                          <span className="text-right tabular-nums shrink-0">
                            {formatCurrency(totals.agentCommissionExHST)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 items-baseline">
                          <span className="text-left">HST Paid to Agent:</span>
                          <span className="text-right tabular-nums shrink-0">
                            {formatCurrency(totals.hstAgent)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 items-baseline">
                          <span className="text-left">
                            Total Paid to Agent (including HST):
                          </span>
                          <span className="text-right tabular-nums shrink-0">
                            {formatCurrency(totals.totalPaidAgent)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 items-baseline">
                          <span className="text-left">
                            Office Share (HST excluded):
                          </span>
                          <span className="text-right tabular-nums shrink-0">
                            {formatCurrency(totals.officeShareExHST)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 items-baseline">
                          <span className="text-left">HST Paid to Office:</span>
                          <span className="text-right tabular-nums shrink-0">
                            {formatCurrency(totals.hstOffice)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 items-baseline py-2 mt-2 border-t-2 border-b-2 border-gray-900 font-bold">
                          <span className="text-left">
                            Total Paid to office (HST included):
                          </span>
                          <span className="text-right tabular-nums shrink-0">
                            {formatCurrency(totals.totalPaidOffice)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentSummaryReport;
