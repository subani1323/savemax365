import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaPrint } from "react-icons/fa";
import Navbar from "./Navbar";
import FinanceSidebar from "./FinanceSidebar";
import axiosInstance from "../config/axios";

const TradeARJournal = () => {
  const navigate = useNavigate();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Helper to format date without timezone conversion issues
  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    try {
      // Handle date strings in YYYY-MM-DD format without timezone conversion
      if (typeof dateStr === "string" && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const [year, month, day] = dateStr.split("-");
        return new Date(year, month - 1, day);
      }
      return new Date(dateStr);
    } catch (error) {
      console.error("Error formatting date:", dateStr, error);
      return new Date();
    }
  };

  const handleGenerateReport = async () => {
    if (!fromDate || !toDate) {
      alert("Please select both from and to dates");
      return;
    }

    setLoading(true);
    setError("");
    try {
      // Fetch ledger data from backend
      const response = await axiosInstance.get("/ledger");
      const ledgerData = response.data || [];

      // Get cash receipt transactions from localStorage (same as Trial Balance)
      const cashReceiptTransactions = JSON.parse(
        localStorage.getItem("trialBalanceTransactions") || "[]"
      );

      // Filter localStorage transactions by date range
      const startDate = new Date(fromDate);
      startDate.setUTCHours(0, 0, 0, 0);
      const endDate = new Date(toDate);
      endDate.setUTCHours(23, 59, 59, 999);

      const filteredLocalStorageTransactions = cashReceiptTransactions.filter(
        (entry) => {
          const entryDate = entry.date
            ? new Date(entry.date)
            : new Date(entry.createdAt || 0);
          return entryDate >= startDate && entryDate <= endDate;
        }
      );

      // Combine backend data with localStorage transactions
      const allLedgerData = [
        ...filteredLocalStorageTransactions,
        ...ledgerData,
      ];

      // Filter for A/R Commission account (12200) and date range
      const filteredTransactions = allLedgerData.filter((entry) => {
        const entryDate = new Date(
          entry.date || entry.transactionDate || entry.createdAt
        );
        return (
          entry.accountNumber === "12200" && // A/R - Commission From Deals
          entryDate >= startDate &&
          entryDate <= endDate
        );
      });

      // Helper function to extract trade number from transaction
      const extractTradeNumber = (transaction) => {
        let tradeNumber = "";
        const cleanDescription = transaction.description || "";

        // Try to extract trade number from description (e.g., "Trade #: 203 - ...")
        const tradeMatch = cleanDescription.match(/Trade #: (\d+)/i);
        if (tradeMatch) {
          tradeNumber = tradeMatch[1];
        } else {
          // Fallback to other fields
          tradeNumber =
            transaction.tradeNumber ||
            transaction.reference ||
            transaction.tradeId ||
            "";
        }

        // If still no trade number, try to extract from reference
        if (!tradeNumber && transaction.reference) {
          const refMatch = transaction.reference.match(/(\d+)/);
          if (refMatch) {
            tradeNumber = refMatch[1];
          }
        }

        return tradeNumber;
      };

      // Sort transactions by trade number (ascending), then by date within same trade number
      filteredTransactions.sort((a, b) => {
        const tradeNumA = extractTradeNumber(a);
        const tradeNumB = extractTradeNumber(b);

        // Convert to numbers for proper numeric sorting
        // Empty or invalid trade numbers go to the end (treated as very large number)
        const numA =
          tradeNumA && !isNaN(parseInt(tradeNumA, 10))
            ? parseInt(tradeNumA, 10)
            : Number.MAX_SAFE_INTEGER;
        const numB =
          tradeNumB && !isNaN(parseInt(tradeNumB, 10))
            ? parseInt(tradeNumB, 10)
            : Number.MAX_SAFE_INTEGER;

        // First sort by trade number
        if (numA !== numB) {
          return numA - numB;
        }

        // If trade numbers are equal, sort by date
        const dateA = new Date(a.date || a.transactionDate || a.createdAt);
        const dateB = new Date(b.date || b.transactionDate || b.createdAt);
        return dateA - dateB;
      });

      // First pass: Collect all transactions with their trade numbers and determine which to exclude
      const transactionsByTrade = {};

      for (const transaction of filteredTransactions) {
        const debit = parseFloat(transaction.debit || 0);
        const credit = parseFloat(transaction.credit || 0);

        // Extract trade number from description or other fields
        let tradeNumber = "";
        let cleanDescription = transaction.description || "";

        // Try to extract trade number from description (e.g., "Trade #: 203 - ...")
        const tradeMatch = cleanDescription.match(/Trade #: (\d+)/i);
        if (tradeMatch) {
          tradeNumber = tradeMatch[1];
        } else {
          // Fallback to other fields
          tradeNumber =
            transaction.tradeNumber ||
            transaction.reference ||
            transaction.tradeId ||
            "";
        }

        // If still no trade number, try to extract from reference
        if (!tradeNumber && transaction.reference) {
          const refMatch = transaction.reference.match(/(\d+)/);
          if (refMatch) {
            tradeNumber = refMatch[1];
          }
        }

        // Use empty string for trades without a number
        const tradeKey = tradeNumber || "";

        if (!transactionsByTrade[tradeKey]) {
          transactionsByTrade[tradeKey] = [];
        }

        transactionsByTrade[tradeKey].push({
          transaction,
          debit,
          credit,
          tradeNumber,
          cleanDescription,
        });
      }

      // Filter out trades that have only one credit transaction
      const tradesToExclude = new Set();
      for (const [tradeKey, transactions] of Object.entries(
        transactionsByTrade
      )) {
        // Only exclude if there's exactly one transaction and it's a credit
        if (transactions.length === 1) {
          const singleTransaction = transactions[0];
          // Check if it's a credit transaction (credit > 0 and debit = 0)
          if (singleTransaction.credit > 0 && singleTransaction.debit === 0) {
            tradesToExclude.add(tradeKey);
          }
        }
      }

      // Second pass: Process transactions, excluding filtered trades
      const reportData = [];
      let runningBalance = 0;

      // Add opening balance entry
      reportData.push({
        tradeNumber: "",
        description: "Opening Balance",
        type: "",
        reference: "",
        depDate: "",
        amount: "Opening",
        balance: runningBalance,
        isOpening: true,
      });

      // Process each transaction sorted by trade number
      for (const transaction of filteredTransactions) {
        const debit = parseFloat(transaction.debit || 0);
        const credit = parseFloat(transaction.credit || 0);

        // Extract trade number from description or other fields
        let tradeNumber = "";
        let cleanDescription = transaction.description || "";

        // Try to extract trade number from description (e.g., "Trade #: 203 - ...")
        const tradeMatch = cleanDescription.match(/Trade #: (\d+)/i);
        if (tradeMatch) {
          tradeNumber = tradeMatch[1];
          // Remove the trade number prefix from description
          cleanDescription = cleanDescription.replace(
            /^Trade #: \d+\s*-\s*/i,
            ""
          );
        } else {
          // Fallback to other fields
          tradeNumber =
            transaction.tradeNumber ||
            transaction.reference ||
            transaction.tradeId ||
            "";
        }

        // If still no trade number, try to extract from reference
        if (!tradeNumber && transaction.reference) {
          const refMatch = transaction.reference.match(/(\d+)/);
          if (refMatch) {
            tradeNumber = refMatch[1];
          }
        }

        // Check if this trade should be excluded
        const tradeKey = tradeNumber || "";
        if (tradesToExclude.has(tradeKey)) {
          continue; // Skip this transaction
        }

        // Determine if this is a receivable (debit) or payment (credit)
        // Based on the first image pattern: positive amounts decrease balance, negative amounts increase balance
        if (debit > 0) {
          // This is a receivable (commission earned) - positive amount decreases balance
          runningBalance -= debit;

          reportData.push({
            tradeNumber: tradeNumber,
            description: cleanDescription || "Commission Receivable",
            type: "AR",
            reference:
              transaction.eftNumber ||
              transaction.reference ||
              `EFT${tradeNumber}`,
            depDate: new Date(transaction.date || transaction.transactionDate)
              .toISOString()
              .split("T")[0],
            amount: debit,
            balance: runningBalance,
            isOpening: false,
          });
        } else if (credit > 0) {
          // This is a payment (commission paid out) - negative amount increases balance
          runningBalance += credit;

          reportData.push({
            tradeNumber: tradeNumber,
            description: cleanDescription || "Commission Payment",
            type: "AR",
            reference:
              transaction.eftNumber ||
              transaction.reference ||
              `EFT${tradeNumber}`,
            depDate: new Date(transaction.date || transaction.transactionDate)
              .toISOString()
              .split("T")[0],
            amount: -credit,
            balance: runningBalance,
            isOpening: false,
          });
        }
      }

      setReportData(reportData);
      setShowReport(true);
    } catch (err) {
      setError("Failed to fetch trade A/R journal data");
      setReportData([]);
      console.error("Error fetching trade A/R journal data:", err);
      alert("Error generating report. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(amount);
  };

  const calculateTotals = () => {
    const receivables = reportData.filter(
      (item) => !item.isOpening && item.amount > 0
    );
    const cashRec = reportData.filter(
      (item) => !item.isOpening && item.amount < 0
    );
    const adjustments = reportData.filter(
      (item) => !item.isOpening && item.amount === 0
    );

    return {
      receivables: receivables.reduce((sum, item) => sum + item.amount, 0),
      cashRec: Math.abs(cashRec.reduce((sum, item) => sum + item.amount, 0)),
      adjustments: adjustments.length,
    };
  };

  const totals = calculateTotals();

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="no-print">
        <Navbar />
      </div>
      <div className="flex">
        {/* Left Sidebar */}
        <div className="no-print">
          <FinanceSidebar />
        </div>
        {/* Main Content */}
        <div className="flex-1 p-6">
          {/* Print Styles */}
          <style jsx>{`
            @media print {
              body * {
                visibility: hidden;
              }
              .print-report,
              .print-report * {
                visibility: visible;
              }
              .print-report {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                font-size: 10px;
              }
              .print-report h3 {
                font-size: 14px;
              }
              .print-report h4 {
                font-size: 12px;
              }
              .print-report p {
                font-size: 10px;
              }
              .print-report table {
                font-size: 9px;
              }
              .print-report th {
                font-size: 8px;
                padding: 2px 4px;
              }
              .print-report td {
                font-size: 8px;
                padding: 2px 4px;
              }
              .no-print {
                display: none !important;
              }
            }
          `}</style>
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4 text-gray-800 no-print">
              Trade A/R Journal
            </h2>

            {/* Date Range Selection */}
            <div className="bg-gray-50 p-4 rounded-lg mb-6 no-print">
              <h3 className="text-lg font-semibold mb-4 text-gray-700">
                Generate Trade A/R Journal Report
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-end space-x-2">
                  <button
                    onClick={handleGenerateReport}
                    disabled={loading}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Generating..." : "Generate Report"}
                  </button>
                  {showReport && (
                    <button
                      onClick={handlePrint}
                      className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                    >
                      <FaPrint className="mr-2" />
                      Print
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Report Display */}
            {showReport && (
              <div className="bg-white border rounded-lg shadow-sm print-report">
                {error && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 no-print">
                    {error}
                  </div>
                )}
                {/* Report Header */}
                <div className="p-4 border-b bg-gray-50">
                  <div className="text-center">
                    <img
                      src="/logo2.jpg"
                      alt="365 Realty Brokerage Logo"
                      className="mx-auto mb-2 h-12 w-auto"
                    />
                    <h3 className="text-lg font-bold text-gray-800">
                      365 Realty Brokerage
                    </h3>
                    <h4 className="text-md font-semibold text-gray-700">
                      TRADE A/R JOURNAL (G/L #12200) - BY DATE
                    </h4>
                    <p className="text-sm text-gray-600">
                      FROM{" "}
                      {formatDate(fromDate)
                        .toLocaleDateString("en-CA", {
                          month: "long",
                          day: "2-digit",
                          year: "numeric",
                        })
                        .toUpperCase()}{" "}
                      TO{" "}
                      {formatDate(toDate)
                        .toLocaleDateString("en-CA", {
                          month: "long",
                          day: "2-digit",
                          year: "numeric",
                        })
                        .toUpperCase()}
                    </p>
                  </div>
                </div>

                {/* Report Table */}
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Trade
                        </th>
                        <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Description
                        </th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Type
                        </th>
                        <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Reference
                        </th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Dep. Date
                        </th>
                        <th className="px-2 py-1 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Amount
                        </th>
                        <th className="px-2 py-1 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Balance
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {reportData.length > 0 ? (
                        reportData.map((item, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-2 py-1 text-xs text-gray-900">
                              {item.isOpening ? (
                                <span className="font-bold">
                                  {item.tradeNumber}
                                </span>
                              ) : (
                                item.tradeNumber
                              )}
                            </td>
                            <td className="px-2 py-1 text-xs text-gray-900">
                              {item.isOpening ? (
                                <span className="font-bold">
                                  {item.description}
                                </span>
                              ) : (
                                item.description
                              )}
                            </td>
                            <td className="px-2 py-1 text-center text-xs text-gray-900">
                              {item.type}
                            </td>
                            <td className="px-2 py-1 text-xs text-gray-900">
                              {item.reference}
                            </td>
                            <td className="px-2 py-1 text-center text-xs text-gray-900">
                              {item.depDate}
                            </td>
                            <td className="px-2 py-1 text-right text-xs text-gray-900">
                              {item.isOpening ? (
                                <span className="font-bold">Opening</span>
                              ) : item.amount !== 0 ? (
                                formatCurrency(item.amount)
                              ) : (
                                "0.00"
                              )}
                            </td>
                            <td className="px-2 py-1 text-right text-xs text-gray-900">
                              {item.isOpening ? (
                                <span className="font-bold">
                                  {formatCurrency(item.balance)}
                                </span>
                              ) : (
                                formatCurrency(item.balance)
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan="7"
                            className="px-2 py-2 text-center text-xs text-gray-500"
                          >
                            No data found for the selected period
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {reportData.length > 0 && (
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td
                            colSpan="5"
                            className="px-2 py-1 text-right text-xs font-medium text-gray-700"
                          >
                            Report Totals:
                          </td>
                          <td className="px-2 py-1 text-right text-xs font-medium text-gray-700">
                            {formatCurrency(
                              totals.receivables - totals.cashRec
                            )}
                          </td>
                          <td className="px-2 py-1 text-right text-xs font-medium text-gray-700">
                            {formatCurrency(
                              totals.receivables - totals.cashRec
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td
                            colSpan="5"
                            className="px-2 py-1 text-right text-xs text-gray-600"
                          >
                            {totals.receivables > 0
                              ? `${Math.ceil(
                                  totals.receivables / 1000
                                )} RECEIVABLES: ${formatCurrency(
                                  totals.receivables
                                )}`
                              : "0 RECEIVABLES: $0.00"}
                          </td>
                          <td className="px-2 py-1 text-right text-xs text-gray-600">
                            {formatCurrency(totals.receivables)}
                          </td>
                          <td className="px-2 py-1 text-right text-xs text-gray-600">
                            -
                          </td>
                        </tr>
                        <tr>
                          <td
                            colSpan="5"
                            className="px-2 py-1 text-right text-xs text-gray-600"
                          >
                            {totals.cashRec > 0
                              ? `${Math.ceil(
                                  totals.cashRec / 1000
                                )} CASH REC.: -${formatCurrency(
                                  totals.cashRec
                                )}`
                              : "0 CASH REC.: $0.00"}
                          </td>
                          <td className="px-2 py-1 text-right text-xs text-gray-600">
                            -{formatCurrency(totals.cashRec)}
                          </td>
                          <td className="px-2 py-1 text-right text-xs text-gray-600">
                            -
                          </td>
                        </tr>
                        <tr>
                          <td
                            colSpan="5"
                            className="px-2 py-1 text-right text-xs text-gray-600"
                          >
                            {totals.adjustments} ADJUSTMENTS: $0.00
                          </td>
                          <td className="px-2 py-1 text-right text-xs text-gray-600">
                            $0.00
                          </td>
                          <td className="px-2 py-1 text-right text-xs text-gray-600">
                            -
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TradeARJournal;
