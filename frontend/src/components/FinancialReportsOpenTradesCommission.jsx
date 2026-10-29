import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import FinanceSidebar from "./FinanceSidebar";
import { FaPrint, FaArrowLeft, FaDownload } from "react-icons/fa";
import axiosInstance from "../config/axios";
import { buildCsv, downloadCsvFile } from "../utils/csvDownload";
import {
  buildOpenTradeCommissionReportRows,
  filterOpenTradesForCommissionReport,
} from "../utils/tradeFinancialUtils";
import {
  groupCommissionTrustEftsByTradeId,
  isTradeCommissionFullyPaidOut,
} from "../utils/progressReportEftDates";
import logo from "../Assets/logo3.jpg";

const COMPANY = "365 Realty Brokerage";
const REPORT_TITLE = "Open Trades Commission Report";
const countUniqueTrades = (reportRows) =>
  new Set(reportRows.map((r) => r.tradeId || r.tradeNumber)).size;

const sumReportRows = (reportRows) =>
  reportRows.reduce(
    (acc, row) => {
      // Trade-level columns repeat per agent row; count each trade once.
      if ((row.agentIndex || 0) === 0) {
        acc.grossCommission += row.grossCommission || 0;
        acc.totalHst += row.totalHst || 0;
        acc.totalCommission += row.totalCommission || 0;
        acc.officeShareWithoutHst += row.officeShareWithoutHst || 0;
      }
      acc.agentNetExclHst += row.agentNetExclHst || 0;
      acc.agentHstAmount += row.agentHstAmount || 0;
      acc.totalAgentCommissionWithHst += row.totalAgentCommissionWithHst || 0;
      return acc;
    },
    {
      grossCommission: 0,
      totalHst: 0,
      totalCommission: 0,
      agentNetExclHst: 0,
      agentHstAmount: 0,
      totalAgentCommissionWithHst: 0,
      officeShareWithoutHst: 0,
    },
  );

const formatReportAmount = (value, formatCurrency) =>
  value == null ? "" : formatCurrency(value);

const collectAgentOptions = (reportRows) => {
  const seen = new Map();
  for (const row of reportRows) {
    const label = String(row.agentNames || "").trim();
    if (label && label !== "—" && !seen.has(label)) {
      seen.set(label, label);
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
};

const rowMatchesAgent = (row, agentLabel) => {
  if (!agentLabel) return false;
  return String(row.agentNames || "").trim() === agentLabel;
};

const FinancialReportsOpenTradesCommission = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isFinancePage = pathname === "/finance-open-trades-commission";
  const printRef = useRef();

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printAgent, setPrintAgent] = useState("");

  const backPath = isFinancePage ? "/finance" : "/financial-reports";
  const backLabel = isFinancePage ? "Back to Finance" : "Back to Reports";

  // Reports should be available to all signed-in users.

  const formatCurrency = (n) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: 2,
    }).format(Number(n) || 0);

  const handleGenerate = async () => {
    if (!fromDate || !toDate) {
      setError("Please select both From and To dates.");
      return;
    }
    if (fromDate > toDate) {
      setError("From date must be on or before To date.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [tradesRes, eftRes] = await Promise.all([
        axiosInstance.get("/trades"),
        axiosInstance.get("/commission-trust-eft"),
      ]);
      const trades = tradesRes.data || [];
      const eftsByTradeId = groupCommissionTrustEftsByTradeId(
        eftRes.data || [],
      );

      const openTrades = filterOpenTradesForCommissionReport(
        trades,
        fromDate,
        toDate,
      ).filter((trade) => {
        const tid = String(trade?._id || "").trim();
        if (!tid) return true;
        // Exclude trades where commission was received and fully paid out
        return !isTradeCommissionFullyPaidOut(eftsByTradeId.get(tid) || []);
      });

      const reportRows = openTrades
        .flatMap((trade) => buildOpenTradeCommissionReportRows(trade))
        .sort((a, b) => {
          const na =
            parseInt(String(a.tradeNumber).replace(/\D/g, ""), 10) || 0;
          const nb =
            parseInt(String(b.tradeNumber).replace(/\D/g, ""), 10) || 0;
          if (nb !== na) return nb - na;
          return (a.agentIndex || 0) - (b.agentIndex || 0);
        });

      const sum = sumReportRows(reportRows);

      setRows(reportRows);
      setTotals({
        grossCommission: Math.round(sum.grossCommission * 100) / 100,
        totalHst: Math.round(sum.totalHst * 100) / 100,
        totalCommission: Math.round(sum.totalCommission * 100) / 100,
        agentNetExclHst: Math.round(sum.agentNetExclHst * 100) / 100,
        agentHstAmount: Math.round(sum.agentHstAmount * 100) / 100,
        totalAgentCommissionWithHst:
          Math.round(sum.totalAgentCommissionWithHst * 100) / 100,
        officeShareWithoutHst:
          Math.round(sum.officeShareWithoutHst * 100) / 100,
        tradeCount: countUniqueTrades(reportRows),
        rowCount: reportRows.length,
      });
      setShowReport(true);
    } catch (err) {
      console.error(err);
      setError("Failed to load trades.");
      setRows([]);
      setTotals(null);
      setShowReport(false);
    } finally {
      setLoading(false);
    }
  };

  const openPrintWindow = (printRows, agentLabel) => {
    const printTotals = sumReportRows(printRows);
    const tradeCount = countUniqueTrades(printRows);
    const rowCount = printRows.length;

    const formatCurrencyText = (n) =>
      new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
        minimumFractionDigits: 2,
      }).format(Number(n) || 0);

    const safe = (v) =>
      String(v ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");

    const agentLine = agentLabel
      ? `<div class="meta">Agent: ${safe(agentLabel)}</div>`
      : "";

    const rowsHtml =
      printRows.length > 0
        ? printRows
            .map(
              (r) => `
            <tr>
              <td class="col-trade">${safe(r.tradeNumber)}</td>
              <td class="col-address">${safe(r.address)}</td>
              <td class="num col-money">${formatCurrencyText(r.grossCommission)}</td>
              <td class="num col-money">${formatCurrencyText(r.totalHst)}</td>
              <td class="num col-money">${formatCurrencyText(r.totalCommission)}</td>
              <td class="num col-money">${formatCurrencyText(r.agentNetExclHst)}</td>
              <td class="num col-money">${formatCurrencyText(r.agentHstAmount)}</td>
              <td class="num col-money">${formatCurrencyText(r.totalAgentCommissionWithHst)}</td>
              <td class="num col-money">${formatCurrencyText(r.officeShareWithoutHst)}</td>
              <td class="col-agents">${safe(r.agentNames || "—")}</td>
            </tr>
          `,
            )
            .join("")
        : `<tr><td colspan="10" style="text-align:center;padding:8px;">No trades for this selection.</td></tr>`;

    const totalsHtml =
      rowCount > 0
        ? `
        <tr class="totals">
          <td colspan="2">Total (${rowCount} row${rowCount === 1 ? "" : "s"})</td>
          <td class="num">${formatCurrencyText(printTotals.grossCommission)}</td>
          <td class="num">${formatCurrencyText(printTotals.totalHst)}</td>
          <td class="num">${formatCurrencyText(printTotals.totalCommission)}</td>
          <td class="num">${formatCurrencyText(printTotals.agentNetExclHst)}</td>
          <td class="num">${formatCurrencyText(printTotals.agentHstAmount)}</td>
          <td class="num">${formatCurrencyText(printTotals.totalAgentCommissionWithHst)}</td>
          <td class="num">${formatCurrencyText(printTotals.officeShareWithoutHst)}</td>
          <td></td>
        </tr>
      `
        : "";

    const w = window.open("", "_blank", "width=1200,height=800");
    if (!w) return;

    w.document.write(`
      <html>
        <head>
          <title>${REPORT_TITLE}</title>
          <style>
            @page { size: portrait; margin: 10mm; }
            body { font-family: Arial, sans-serif; font-size: 9px; color: #111; }
            .header { text-align:center; margin-bottom: 10px; }
            .header .company { font-weight: 700; font-size: 12px; margin-top: 4px; }
            .header .title { font-weight: 700; font-size: 13px; margin-top: 4px; }
            .header .meta { font-size: 9px; margin-top: 4px; }
            table { width: 100%; border-collapse: collapse; font-size: 8.5px; table-layout: fixed; }
            th, td { border: 1px solid #999; padding: 3px 4px; vertical-align: top; overflow-wrap: break-word; }
            th { background: #f2f2f2; text-align: left; font-size: 8px; }
            td.num, th.col-money { text-align: right; }
            td.num { white-space: nowrap; padding-left: 2px; padding-right: 3px; }
            th.col-trade, td.col-trade { width: 4%; }
            th.col-address, td.col-address { width: 22%; }
            th.col-money, td.col-money { width: 6%; }
            th.col-agents, td.col-agents { width: 10%; font-size: 7px; }
            th.col-money { font-size: 7px; line-height: 1.15; }
            tr.totals td { font-weight: 700; background: #fafafa; }
            .logo { max-height: 40px; display:block; margin: 0 auto 4px; }
            .print-btn { margin-top: 12px; }
            @media print { .print-btn { display:none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <img class="logo" src="${logo}" alt="" />
            <div class="company">${safe(COMPANY)}</div>
            <div class="title">${safe(REPORT_TITLE)}</div>
            <div class="meta">Period: ${safe(fromDate)} to ${safe(toDate)}${tradeCount ? ` · ${tradeCount} trade(s)` : ""}</div>
            ${agentLine}
          </div>

          <table>
            <colgroup>
              <col style="width:4%" />
              <col style="width:22%" />
              <col style="width:6%" />
              <col style="width:6%" />
              <col style="width:6%" />
              <col style="width:6%" />
              <col style="width:6%" />
              <col style="width:6%" />
              <col style="width:6%" />
              <col style="width:10%" />
            </colgroup>
            <thead>
              <tr>
                <th class="col-trade">Trade #</th>
                <th class="col-address">Address</th>
                <th class="col-money">Gross<br />Comm.</th>
                <th class="col-money">Total<br />HST</th>
                <th class="col-money">Total Comm.<br />(incl. HST)</th>
                <th class="col-money">Agent Net<br />(excl. HST)</th>
                <th class="col-money">Agent<br />HST</th>
                <th class="col-money">Agent Comm.<br />(incl. HST)</th>
                <th class="col-money">Office<br />(excl. HST)</th>
                <th class="col-agents">Agent</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
            <tfoot>
              ${totalsHtml}
            </tfoot>
          </table>

          <button class="print-btn" onclick="window.print()">Print</button>
        </body>
      </html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  const handlePrintClick = () => {
    if (!showReport || rows.length === 0) return;
    const options = collectAgentOptions(rows);
    setPrintAgent(options[0] || "");
    setShowPrintModal(true);
  };

  const handleConfirmPrint = () => {
    if (!printAgent) {
      return;
    }
    const filtered = rows.filter((row) => rowMatchesAgent(row, printAgent));
    setShowPrintModal(false);
    openPrintWindow(filtered, printAgent);
  };

  const handleDownloadCsv = () => {
    if (!rows.length) return;
    const csv = buildCsv(
      [
        "Trade #",
        "Address",
        "Gross Commission",
        "Total HST",
        "Total Commission (incl. HST)",
        "Agent Net (excl. HST)",
        "Agent HST",
        "Agent Commission (incl. HST)",
        "Office Share (excl. HST)",
        "Agent",
      ],
      rows.map((r) => [
        r.tradeNumber,
        r.address,
        (Number(r.grossCommission) || 0).toFixed(2),
        (Number(r.totalHst) || 0).toFixed(2),
        (Number(r.totalCommission) || 0).toFixed(2),
        (Number(r.agentNetExclHst) || 0).toFixed(2),
        (Number(r.agentHstAmount) || 0).toFixed(2),
        (Number(r.totalAgentCommissionWithHst) || 0).toFixed(2),
        (Number(r.officeShareWithoutHst) || 0).toFixed(2),
        r.agentNames,
      ]),
    );
    downloadCsvFile(`open-trades-commission-${fromDate}-to-${toDate}.csv`, csv);
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Navbar />
      <div className="flex flex-1">
        {isFinancePage && <FinanceSidebar />}
        <div className="flex-1 p-6">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center mb-6 no-print">
              <button
                type="button"
                onClick={() => navigate(backPath)}
                className="flex items-center text-gray-600 hover:text-gray-800 mr-4"
              >
                <FaArrowLeft className="mr-2" />
                {backLabel}
              </button>
              <h1 className="text-2xl font-bold text-gray-900">
                {REPORT_TITLE}
              </h1>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md mb-6 no-print">
              <p className="text-sm text-gray-600 mb-4">
                Shows <strong>open deals</strong> only (Available, Sold, or
                Leased — not Closed or finalized) that were active during the
                selected period — including deals opened before the period that
                are still open. Trades where commission was received and fully
                paid out (agent + office / outside broker EFTs cover the amount
                received) are excluded. Amounts match the trade Financial sheet
                (Commission, Agents + referral, Net to Office).
              </p>
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    From
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    To
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
                >
                  {loading ? "Loading…" : "Generate Report"}
                </button>
                {showReport && rows.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handlePrintClick}
                      className="flex items-center gap-2 bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
                    >
                      <FaPrint /> Print
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadCsv}
                      className="flex items-center gap-2 bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
                    >
                      <FaDownload /> CSV
                    </button>
                  </>
                )}
              </div>
              {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
            </div>

            {showReport && (
              <div ref={printRef} className="bg-white p-6 rounded-lg shadow-md">
                <div className="hidden print:block mb-4 text-center">
                  <img src={logo} alt="" className="h-12 mx-auto mb-2" />
                  <div className="font-bold">{COMPANY}</div>
                  <div className="text-lg font-semibold mt-2">
                    {REPORT_TITLE}
                  </div>
                  <div className="text-sm text-gray-700">
                    Period: {fromDate} to {toDate}
                    {totals
                      ? ` · ${totals.tradeCount} trade(s)${totals.rowCount !== totals.tradeCount ? `, ${totals.rowCount} agent line(s)` : ""}`
                      : ""}
                  </div>
                </div>

                {rows.length === 0 ? (
                  <p className="text-gray-600">
                    No open deals in this date range.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border border-gray-300 text-xs">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border px-1.5 py-1.5 text-left whitespace-nowrap">
                            Trade #
                          </th>
                          <th className="border px-1.5 py-1.5 text-left min-w-[140px]">
                            Address
                          </th>
                          <th className="border px-1 py-1.5 text-right text-[10px] leading-tight whitespace-nowrap">
                            Gross Comm.
                          </th>
                          <th className="border px-1 py-1.5 text-right text-[10px] leading-tight whitespace-nowrap">
                            Total HST
                          </th>
                          <th className="border px-1 py-1.5 text-right text-[10px] leading-tight whitespace-nowrap">
                            Total Comm.
                            <span className="block font-normal">
                              (incl. HST)
                            </span>
                          </th>
                          <th className="border px-1 py-1.5 text-right text-[10px] leading-tight whitespace-nowrap">
                            Agent Net
                            <span className="block font-normal">
                              (excl. HST)
                            </span>
                          </th>
                          <th className="border px-1 py-1.5 text-right text-[10px] leading-tight whitespace-nowrap">
                            Agent HST
                          </th>
                          <th className="border px-1 py-1.5 text-right text-[10px] leading-tight whitespace-nowrap">
                            Agent Comm.
                            <span className="block font-normal">
                              (incl. HST)
                            </span>
                          </th>
                          <th className="border px-1 py-1.5 text-right text-[10px] leading-tight whitespace-nowrap">
                            Office Share
                            <span className="block font-normal">
                              (excl. HST)
                            </span>
                          </th>
                          <th className="border px-1.5 py-1.5 text-left text-[10px] whitespace-nowrap">
                            Agent
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={
                              row.rowKey || `${row.tradeId}-${row.agentIndex}`
                            }
                          >
                            <td className="border px-1.5 py-1.5 whitespace-nowrap">
                              {row.tradeNumber}
                            </td>
                            <td className="border px-1.5 py-1.5 break-words">
                              {row.address}
                            </td>
                            <td className="border px-1 py-1.5 text-right whitespace-nowrap">
                              {formatReportAmount(
                                row.grossCommission,
                                formatCurrency,
                              )}
                            </td>
                            <td className="border px-1 py-1.5 text-right whitespace-nowrap">
                              {formatReportAmount(row.totalHst, formatCurrency)}
                            </td>
                            <td className="border px-1 py-1.5 text-right whitespace-nowrap">
                              {formatReportAmount(
                                row.totalCommission,
                                formatCurrency,
                              )}
                            </td>
                            <td className="border px-1 py-1.5 text-right whitespace-nowrap">
                              {formatCurrency(row.agentNetExclHst)}
                            </td>
                            <td className="border px-1 py-1.5 text-right whitespace-nowrap">
                              {formatCurrency(row.agentHstAmount)}
                            </td>
                            <td className="border px-1 py-1.5 text-right whitespace-nowrap">
                              {formatCurrency(row.totalAgentCommissionWithHst)}
                            </td>
                            <td className="border px-1 py-1.5 text-right whitespace-nowrap">
                              {formatReportAmount(
                                row.officeShareWithoutHst,
                                formatCurrency,
                              )}
                            </td>
                            <td className="border px-1.5 py-1.5 text-[10px] whitespace-nowrap">
                              {row.agentNames || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {totals && (
                        <tfoot>
                          <tr className="bg-gray-50 font-semibold">
                            <td className="border px-2 py-1.5" colSpan={2}>
                              Total ({totals.rowCount} row
                              {totals.rowCount === 1 ? "" : "s"})
                            </td>
                            <td className="border px-2 py-1.5 text-right">
                              {formatCurrency(totals.grossCommission)}
                            </td>
                            <td className="border px-2 py-1.5 text-right">
                              {formatCurrency(totals.totalHst)}
                            </td>
                            <td className="border px-2 py-1.5 text-right">
                              {formatCurrency(totals.totalCommission)}
                            </td>
                            <td className="border px-2 py-1.5 text-right">
                              {formatCurrency(totals.agentNetExclHst)}
                            </td>
                            <td className="border px-2 py-1.5 text-right">
                              {formatCurrency(totals.agentHstAmount)}
                            </td>
                            <td className="border px-2 py-1.5 text-right">
                              {formatCurrency(
                                totals.totalAgentCommissionWithHst,
                              )}
                            </td>
                            <td className="border px-2 py-1.5 text-right">
                              {formatCurrency(totals.officeShareWithoutHst)}
                            </td>
                            <td className="border px-2 py-1.5" />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print, nav, .FinanceSidebar { display: none !important; }
          body { background: white; }
        }
      `}</style>

      {showPrintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              Print report
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Select an agent to print only trades that include that agent.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Agent
            </label>
            <select
              className="w-full border border-gray-300 rounded px-3 py-2 mb-4"
              value={printAgent}
              onChange={(e) => setPrintAgent(e.target.value)}
            >
              {collectAgentOptions(rows).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mb-4">
              {printAgent
                ? `${rows.filter((r) => rowMatchesAgent(r, printAgent)).length} line(s) for this agent (${countUniqueTrades(rows.filter((r) => rowMatchesAgent(r, printAgent)))} trade(s)).`
                : "No agents found in this report."}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPrint}
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                Print report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialReportsOpenTradesCommission;
