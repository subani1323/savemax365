import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaPrint } from "react-icons/fa";
import Navbar from "./Navbar";
import FinanceSidebar from "./FinanceSidebar";
import axiosInstance from "../config/axios";
import { getPartyNamesByDealType } from "../utils/eftUtils";

const TrustJournal = () => {
  const navigate = useNavigate();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);

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

    try {
      setLoading(true);
      console.log("Fetching trades for date range:", fromDate, "to", toDate);

      // Fetch all trades data (we'll filter by transaction dates, not trade dates)
      const tradesResponse = await axiosInstance.get("/trades");
      const allTrades = tradesResponse.data || [];
      console.log("Fetched all trades:", allTrades);

      // Process all trades - we'll filter by transaction dates within each trade
      const tradesToProcess = allTrades;

      const reportData = [];

      // Process each trade
      for (const trade of tradesToProcess) {
        try {
          const tradeNumber = trade.tradeNumber || trade.id;
          const keyInfo = trade.keyInfo || {};
          const address =
            `${keyInfo.streetNumber || ""} ${keyInfo.streetName || ""} ${
              keyInfo.unit || ""
            }`.trim() || "N/A";

          console.log(
            `Processing Trade ${tradeNumber} - Address: ${address}, Classification: ${keyInfo.classification}`,
          );
          console.log("Full trade object:", trade);
          console.log(
            `Trade ${tradeNumber} - Trust records:`,
            trade.trustRecords,
          );
          console.log(`Trade ${tradeNumber} - Key info:`, trade.keyInfo);

          let openingBalance = 0;
          let runningBalance = 0;

          // Get trust records early for mapping
          const trustRecords = trade.trustRecords || trade.trust_records || [];

          // Helper function to convert paymentType to transaction type
          // Returns the full payment type (EFT, Cheque, etc.) from trust records
          // or "C" for Credit if no payment type is available
          const getTypeFromPaymentType = (paymentType) => {
            if (!paymentType) return "C";
            // Return full payment type (EFT, Cheque, etc.)
            return paymentType.toUpperCase();
          };

          // Create a map of eftNumber to trust record for quick lookup
          const trustRecordMap = {};
          trustRecords.forEach((record) => {
            if (record.eftNumber) {
              trustRecordMap[record.eftNumber] = record;
            }
          });

          // Fetch Real Estate Trust EFTs for this trade
          let realEstateTrustPayments = [];
          try {
            const eftResponse = await axiosInstance.get(
              `/real-estate-trust-eft/trade/${trade._id}`,
            );
            realEstateTrustPayments = eftResponse.data || [];
            console.log(
              `Trade ${tradeNumber} - Fetched EFTs:`,
              realEstateTrustPayments,
            );
          } catch (eftError) {
            console.log(
              `Trade ${tradeNumber} - No EFTs found or error fetching:`,
              eftError.message,
            );
          }

          // Filter EFT payments by date range
          const filteredPayments = realEstateTrustPayments.filter((payment) => {
            if (!payment.chequeDate) return false; // Exclude if no cheque date

            const paymentDate = new Date(payment.chequeDate);
            const fromDateObj = new Date(fromDate);
            const toDateObj = new Date(toDate);

            fromDateObj.setHours(0, 0, 0, 0);
            toDateObj.setHours(23, 59, 59, 999);

            const inRange =
              paymentDate >= fromDateObj && paymentDate <= toDateObj;
            console.log(
              `Trade ${tradeNumber} - Payment cheque date: ${payment.chequeDate}, In range: ${inRange}`,
            );
            return inRange;
          });

          console.log(
            `Trade ${tradeNumber} - Total payments: ${realEstateTrustPayments.length}, Filtered: ${filteredPayments.length}`,
          );

          // Only process this trade if it has transactions in the date range
          if (filteredPayments.length === 0) {
            console.log(
              `Trade ${tradeNumber} - No transactions in date range, skipping`,
            );
            continue;
          }

          // Get opening balance from Trust Records (only for trades with transactions in date range)
          console.log(
            `Trade ${tradeNumber} - Classification: ${keyInfo.classification}`,
          );

          if (keyInfo.classification === "Listing Side" || true) {
            // Try for all trades for debugging
            console.log(
              `Trade ${tradeNumber} - Trust records found:`,
              trustRecords,
            );

            if (trustRecords.length > 0) {
              // Look for any record with an amount (not just the first one with amount)
              const depositRecord = trustRecords.find((record) => {
                const amount =
                  record.amount ||
                  record.depositAmount ||
                  record.deposit_amount ||
                  record.value ||
                  record.total;
                return amount && parseFloat(amount) > 0;
              });

              if (depositRecord) {
                const amountStr =
                  depositRecord.amount ||
                  depositRecord.depositAmount ||
                  depositRecord.deposit_amount ||
                  depositRecord.value ||
                  depositRecord.total;
                openingBalance = parseFloat(amountStr) || 0;
                runningBalance = openingBalance;
                console.log(
                  `Trade ${tradeNumber} - Found deposit record:`,
                  depositRecord,
                );
                console.log(
                  `Trade ${tradeNumber} - Amount string: ${amountStr}, Parsed: ${openingBalance}`,
                );
              } else {
                console.log(
                  `Trade ${tradeNumber} - No valid deposit record found in trust records`,
                );
              }
            } else {
              console.log(`Trade ${tradeNumber} - No trust records found`);
            }
          } else {
            console.log(
              `Trade ${tradeNumber} - Not listing side, classification: ${keyInfo.classification}`,
            );
          }

          // Add opening balance entry if there's a deposit
          if (openingBalance > 0) {
            // Find the trust record that has the opening balance
            const openingTrustRecord = trustRecords.find((record) => {
              const amount =
                record.amount ||
                record.depositAmount ||
                record.deposit_amount ||
                record.value ||
                record.total;
              return amount && parseFloat(amount) > 0;
            });

            // Format deposit date if available
            let formattedDepDate = "";
            if (openingTrustRecord?.depositDate) {
              try {
                formattedDepDate = formatDate(
                  openingTrustRecord.depositDate,
                ).toLocaleDateString("en-CA");
              } catch (e) {
                formattedDepDate = openingTrustRecord.depositDate;
              }
            }

            reportData.push({
              tradeNumber: tradeNumber,
              address: address,
              description: address, // Show address in description column
              type: openingTrustRecord?.paymentType
                ? getTypeFromPaymentType(openingTrustRecord.paymentType)
                : "",
              reference: openingTrustRecord?.reference || "",
              depDate: formattedDepDate,
              amount: "Opening", // Show "Opening" in amount column
              balance: openingBalance, // Show actual balance amount
              isOpening: true,
            });
            runningBalance = openingBalance; // Set running balance to opening balance
          } else {
            // Add trade header even without opening balance to show address
            reportData.push({
              tradeNumber: tradeNumber,
              address: address,
              description: address, // Show address in description column
              type: "",
              reference: "",
              depDate: "",
              amount: "Opening", // Show "Opening" in amount column
              balance: 0, // Show 0 balance
              isOpening: true,
            });
            runningBalance = 0; // Set running balance to 0
          }

          if (filteredPayments.length > 0) {
            filteredPayments.forEach((payment) => {
              const amount = parseFloat(payment.amount || 0);
              // For credits, subtract from balance; for debits, add to balance
              // Since we're treating all as credits, subtract the amount
              runningBalance -= amount;

              console.log(
                `Trade ${tradeNumber} - Processing payment:`,
                payment,
              );
              console.log(
                `Trade ${tradeNumber} - Payment type: ${payment.type}, Amount: ${amount}`,
              );

              // Try to find matching trust record by eftNumber
              const matchingTrustRecord =
                payment.eftNumber && trustRecordMap[payment.eftNumber]
                  ? trustRecordMap[payment.eftNumber]
                  : null;

              // Determine transaction type - prefer trust record paymentType, then EFT type
              let transactionType = "C"; // Default to Credit

              if (matchingTrustRecord?.paymentType) {
                // Use paymentType from trust record
                transactionType = getTypeFromPaymentType(
                  matchingTrustRecord.paymentType,
                );
                console.log(
                  `Trade ${tradeNumber} - Using trust record paymentType: ${matchingTrustRecord.paymentType} -> ${transactionType}`,
                );
              } else {
                // Fallback to EFT payment type logic
                if (
                  payment.type === "CommissionTransfer" ||
                  payment.type === "BalanceOfDeposit"
                ) {
                  transactionType = "C";
                  console.log(
                    `Trade ${tradeNumber} - CommissionTransfer/BalanceOfDeposit -> Credit`,
                  );
                } else if (
                  payment.type === "RefundOfDeposit" ||
                  payment.type === "TrustDeposit"
                ) {
                  transactionType = "C";
                  console.log(
                    `Trade ${tradeNumber} - RefundOfDeposit/TrustDeposit -> Credit`,
                  );
                } else {
                  transactionType = amount > 0 ? "C" : "D";
                  console.log(
                    `Trade ${tradeNumber} - Fallback: amount ${amount} > 0 ? C : D = ${transactionType}`,
                  );
                }
              }

              console.log(
                `Trade ${tradeNumber} - Determined transaction type: ${transactionType}`,
              );
              console.log(
                `Trade ${tradeNumber} - Balance calculation: ${
                  runningBalance + amount
                } - ${amount} = ${runningBalance}`,
              );

              // For credits, display as negative amount
              const displayAmount =
                transactionType === "C" ? -Math.abs(amount) : amount;
              console.log(
                `Trade ${tradeNumber} - Display amount: ${amount} -> ${displayAmount} (Type: ${transactionType})`,
              );

              // Use recipient name instead of generic description
              // First, always try to extract from description if it contains "Paid to:" (highest priority)
              let recipientName = "";
              if (payment.description) {
                const paidToMatch =
                  payment.description.match(/Paid to:\s*([^,\n]+)/i);
                if (paidToMatch && paidToMatch[1].trim() !== "") {
                  recipientName = paidToMatch[1].trim();
                  console.log(
                    `Trade ${tradeNumber} - Extracted name from description: "${recipientName}"`,
                  );
                }
              }

              // If extraction didn't work, check trust record's receivedFrom field
              if (
                !recipientName ||
                recipientName === "N/A" ||
                recipientName.trim() === ""
              ) {
                const trustReceivedFrom = matchingTrustRecord?.receivedFrom;
                const eftRecipient = payment.recipient;

                // Use trust record's receivedFrom if available and not "N/A"
                if (
                  trustReceivedFrom &&
                  trustReceivedFrom !== "N/A" &&
                  trustReceivedFrom.trim() !== ""
                ) {
                  recipientName = trustReceivedFrom.trim();
                }
                // Otherwise use EFT recipient if available and not "N/A"
                else if (
                  eftRecipient &&
                  eftRecipient !== "N/A" &&
                  eftRecipient.trim() !== ""
                ) {
                  recipientName = eftRecipient.trim();
                }
              }

              // Remove "Commission Trust" from recipient names
              recipientName = recipientName
                .replace(/ - Commission Trust$/i, "")
                .replace(/, Commission Trust$/i, "");

              // If extraction from "Paid to:" didn't work, try other patterns in description
              if (
                (!recipientName ||
                  recipientName === "N/A" ||
                  recipientName.trim() === "") &&
                payment.description
              ) {
                // Try alternative patterns to extract name
                const namePatterns = [
                  /to:\s*([^,\n]+)/i, // Matches "to: Name" without "Paid"
                  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/, // Matches capitalized names (e.g., "Wealthpro Holdings Inc")
                ];

                for (const pattern of namePatterns) {
                  const match = payment.description.match(pattern);
                  if (
                    match &&
                    match[1] &&
                    match[1].trim() !== "" &&
                    match[1].trim() !== "N/A" &&
                    !match[1].trim().includes("Trade #") // Exclude "Trade #" from matches
                  ) {
                    recipientName = match[1].trim();
                    console.log(
                      `Trade ${tradeNumber} - Extracted name using alternative pattern: "${recipientName}"`,
                    );
                    break;
                  }
                }
              }

              // If recipient name is still empty or "N/A", especially for BalanceOfDeposit transactions,
              // try to get the seller names from the trade
              if (
                (!recipientName ||
                  recipientName === "N/A" ||
                  recipientName.trim() === "") &&
                payment.type === "BalanceOfDeposit"
              ) {
                const partyNames = getPartyNamesByDealType(trade);
                // Only use partyNames if it's not "N/A"
                if (partyNames.firstParty && partyNames.firstParty !== "N/A") {
                  recipientName = partyNames.firstParty;
                  console.log(
                    `Trade ${tradeNumber} - BalanceOfDeposit: Extracted seller name from trade: "${recipientName}"`,
                  );
                } else {
                  // If partyNames is also "N/A", try to extract from description one more time with a different pattern
                  if (payment.description) {
                    // Try to match any name pattern in the description
                    const namePatterns = [
                      /Paid to:\s*([^,\n]+)/i,
                      /to:\s*([^,\n]+)/i,
                      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/, // Matches capitalized names
                    ];

                    for (const pattern of namePatterns) {
                      const match = payment.description.match(pattern);
                      if (
                        match &&
                        match[1] &&
                        match[1].trim() !== "" &&
                        match[1].trim() !== "N/A"
                      ) {
                        recipientName = match[1].trim();
                        console.log(
                          `Trade ${tradeNumber} - BalanceOfDeposit: Extracted name using pattern: "${recipientName}"`,
                        );
                        break;
                      }
                    }
                  }

                  // If still "N/A", keep it as is
                  if (
                    !recipientName ||
                    recipientName === "N/A" ||
                    recipientName.trim() === ""
                  ) {
                    recipientName = "N/A";
                  }
                }
              }

              console.log(
                `Trade ${tradeNumber} - Payment recipient: "${payment.recipient}", cleaned: "${recipientName}"`,
              );

              // Use trust record fields if available, otherwise fallback to EFT fields
              let formattedDepDate = "";
              if (matchingTrustRecord?.depositDate) {
                try {
                  formattedDepDate = formatDate(
                    matchingTrustRecord.depositDate,
                  ).toLocaleDateString("en-CA");
                } catch (e) {
                  formattedDepDate = matchingTrustRecord.depositDate;
                }
              } else if (payment.chequeDate) {
                formattedDepDate = formatDate(
                  payment.chequeDate,
                ).toLocaleDateString("en-CA");
              }

              const reference = matchingTrustRecord?.reference
                ? matchingTrustRecord.reference
                : payment.eftNumber
                  ? payment.eftNumber.toString()
                  : "";

              reportData.push({
                tradeNumber: tradeNumber,
                address: address,
                description: recipientName,
                type: transactionType,
                reference: reference,
                depDate: formattedDepDate,
                amount: displayAmount,
                balance: runningBalance,
                isOpening: false,
              });
            });
          } else if (openingBalance > 0) {
            // If no trust payments but we have an opening balance, add a note
            reportData.push({
              tradeNumber: tradeNumber,
              address: address,
              description: "No transactions recorded",
              type: "",
              reference: "",
              depDate: "",
              amount: 0,
              balance: runningBalance,
              isOpening: false,
            });
          }
        } catch (tradeError) {
          console.warn(
            `Error processing trade ${trade.tradeNumber || trade.id}:`,
            tradeError,
          );
        }
      }

      console.log("Final report data:", reportData);
      setReportData(reportData);
      setShowReport(true);
    } catch (error) {
      console.error("Error generating report:", error);
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
    const deposits = reportData.filter(
      (item) => !item.isOpening && item.amount > 0,
    );
    const cheques = reportData.filter(
      (item) => !item.isOpening && item.amount < 0,
    );
    const adjustments = reportData.filter(
      (item) => !item.isOpening && item.amount === 0,
    );

    return {
      deposits: deposits.reduce((sum, item) => sum + item.amount, 0),
      cheques: Math.abs(cheques.reduce((sum, item) => sum + item.amount, 0)),
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
              Trust Journal
            </h2>

            {/* Date Range Selection */}
            <div className="bg-gray-50 p-4 rounded-lg mb-6 no-print">
              <h3 className="text-lg font-semibold mb-4 text-gray-700">
                Generate Trust Journal Report
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
                {/* Report Header */}
                <div className="p-4 border-b bg-gray-50">
                  <div className="text-center">
                    <img
                      src="/logo2.jpg"
                      alt="Savemax 365 Realty Logo"
                      className="mx-auto mb-2 h-12 w-auto"
                    />
                    <h3 className="text-lg font-bold text-gray-800">
                      Savemax 365 Realty, Brokerage
                    </h3>
                    <h4 className="text-md font-semibold text-gray-700">
                      TRUST JOURNAL (G/L #10002) - BY TRADE
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
                            {formatCurrency(totals.deposits - totals.cheques)}
                          </td>
                          <td className="px-2 py-1 text-right text-xs font-medium text-gray-700">
                            {formatCurrency(totals.deposits - totals.cheques)}
                          </td>
                        </tr>
                        <tr>
                          <td
                            colSpan="5"
                            className="px-2 py-1 text-right text-xs text-gray-600"
                          >
                            {totals.deposits > 0
                              ? `${Math.ceil(
                                  totals.deposits / 1000,
                                )} DEPOSITS: ${formatCurrency(totals.deposits)}`
                              : "0 DEPOSITS: $0.00"}
                          </td>
                          <td className="px-2 py-1 text-right text-xs text-gray-600">
                            {formatCurrency(totals.deposits)}
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
                            {totals.cheques > 0
                              ? `${Math.ceil(
                                  totals.cheques / 1000,
                                )} CHEQUES: -${formatCurrency(totals.cheques)}`
                              : "0 CHEQUES: $0.00"}
                          </td>
                          <td className="px-2 py-1 text-right text-xs text-gray-600">
                            -{formatCurrency(totals.cheques)}
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

export default TrustJournal;
