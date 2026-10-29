import React, { useState } from "react";
import Navbar from "./Navbar";
import FinanceSidebar from "./FinanceSidebar";
import axiosInstance from "../config/axios";
import logo2 from "../Assets/logo2.jpg";
import { buildReconciliationLedgerSections } from "../utils/reconciliationLedgerReport";

const ReconcileRealEstateTrust = () => {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [showStatementModal, setShowStatementModal] = useState(false);
  const [statementAmount, setStatementAmount] = useState(() => {
    // Load statement amount from localStorage on component mount
    const saved = localStorage.getItem(
      "reconcileRealEstateTrust_statementAmount",
    );
    return saved || "";
  });
  const [clearedTransactions, setClearedTransactions] = useState(new Set());
  const [showClearModal, setShowClearModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [cumulativeTransactions, setCumulativeTransactions] = useState([]);
  const [showTrustJournal, setShowTrustJournal] = useState(false);
  const [trustLedgerSections, setTrustLedgerSections] = useState({
    section1: [],
    section2: [],
  });
  const [trustJournalLoading, setTrustJournalLoading] = useState(false);

  const generateTrustJournal = async () => {
    if (!fromDate || !toDate) {
      alert("Please select both From and To dates.");
      return;
    }
    if (!showTable || transactions.length === 0) {
      alert("Please Retrieve Data first.");
      return;
    }

    setTrustJournalLoading(true);
    try {
      const [tradesResp, eftResp] = await Promise.all([
        axiosInstance.get("/trades"),
        axiosInstance.get("/real-estate-trust-eft"),
      ]);
      const allTrades = tradesResp.data || [];
      const allEfts = eftResp.data || [];

      const { section1, section2 } = buildReconciliationLedgerSections(
        allTrades,
        allEfts,
        fromDate,
        toDate,
        { ledgerAccount: "10002" },
      );

      setTrustLedgerSections({ section1, section2 });
      setShowTrustJournal(true);
    } catch (e) {
      console.error("Error generating Trust Ledger:", e);
      alert("Error generating Trust Ledger. Please try again.");
    } finally {
      setTrustJournalLoading(false);
    }
  };

  const handleRetrieveData = async () => {
    if (!fromDate || !toDate) {
      alert("Please select both From and To dates");
      return;
    }

    setLoading(true);
    try {
      // Fetch ledger entries for account 10002 (Cash - Trust): selected period + prior uncleared
      const response = await axiosInstance.get(`/ledger/account/10002`, {
        params: {
          fromDate: fromDate,
          toDate: toDate,
          includePriorUncleared: true,
        },
      });

      setTransactions(response.data);
      setShowTable(true);

      // Fetch cumulative transactions from January 1st to toDate for closing balance calculation
      const toDateObj = new Date(toDate);
      const yearStart = new Date(toDateObj.getFullYear(), 0, 1); // January 1st of the year
      const yearStartStr = yearStart.toISOString().split("T")[0];

      try {
        const cumulativeResponse = await axiosInstance.get(
          `/ledger/account/10002`,
          {
            params: {
              fromDate: yearStartStr,
              toDate: toDate,
            },
          },
        );
        setCumulativeTransactions(cumulativeResponse.data);
      } catch (error) {
        console.error("Error fetching cumulative transactions:", error);
        // If cumulative fetch fails, use regular transactions as fallback
        setCumulativeTransactions(response.data);
      }

      // Load cleared transaction status from database
      await loadClearedTransactions(response.data);
    } catch (error) {
      console.error("Error fetching ledger entries:", error);
      alert("Error retrieving data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const loadClearedTransactions = async (transactionsData) => {
    try {
      const response = await axiosInstance.get(
        `/reconciliation-settings/10002`,
        {
          params: {
            fromDate: fromDate,
            toDate: toDate,
            mergeClearedForAccount: true,
          },
        },
      );

      // Use account-wide cleared IDs so prior-uncleared rows and refresh both show correct state
      const clearedIds = new Set(
        (response.data.allClearedLedgerIds || []).map((id) => String(id)),
      );
      if (
        !response.data.allClearedLedgerIds &&
        response.data.clearedTransactions
      ) {
        response.data.clearedTransactions.forEach((ct) => {
          if (ct.ledgerId) clearedIds.add(String(ct.ledgerId));
        });
      }
      setClearedTransactions(clearedIds);

      // Load statement amount if available (prioritize localStorage over database)
      const localStatementAmount = localStorage.getItem(
        "reconcileRealEstateTrust_statementAmount",
      );
      if (localStatementAmount) {
        setStatementAmount(localStatementAmount);
      } else if (
        response.data.statementAmount !== null &&
        response.data.statementAmount !== undefined
      ) {
        setStatementAmount(response.data.statementAmount.toString());
      }
    } catch (error) {
      console.error("Error loading cleared transactions:", error);
      // Don't show error to user as this is not critical
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const options = { year: "numeric", month: "short", day: "numeric" };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  const formatAmount = (amount) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(amount);
  };

  const isDebitTxn = (t) => {
    const type = String(t?.type || "").toLowerCase();
    if (type.includes("debit")) return true;
    if (type.includes("credit")) return false;
    return (t?.amount || 0) < 0;
  };

  const computeUnclearedOutstanding = (txnList = transactions) => {
    const unclearedTransactions = txnList.filter(
      (t) => !clearedTransactions.has(String(t._id)),
    );
    const totalOutstandingDebits = unclearedTransactions
      .filter((t) => isDebitTxn(t))
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    const totalOutstandingCredits = unclearedTransactions
      .filter((t) => !isDebitTxn(t))
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    const totalOutstanding = totalOutstandingDebits - totalOutstandingCredits;
    const bankBalance = parseFloat(statementAmount) || 0;
    const reconciledBalance = bankBalance + totalOutstanding;
    return {
      totalOutstandingDebits,
      totalOutstandingCredits,
      totalOutstanding,
      reconciledBalance,
    };
  };

  const formatTxnAmount = (transaction) => {
    const absAmount = Math.abs(transaction?.amount || 0);
    if (!absAmount) return "";
    return formatAmount(absAmount);
  };

  // Calculate reconciliation values
  const calculateReconciliationValues = () => {
    const stmt = parseFloat(statementAmount) || 0;
    if (transactions.length === 0) {
      return {
        book: 0,
        open: 0,
        misc: 0,
        chequesCleared: 0,
        depositsCleared: 0,
        totalOutstanding: 0,
        reconciledBalance: stmt,
      };
    }

    const unclearedTransactions = transactions.filter(
      (t) => !clearedTransactions.has(String(t._id)),
    );
    const {
      totalOutstanding,
      reconciledBalance,
    } = computeUnclearedOutstanding(transactions);

    const clearedOnly = transactions.filter((t) =>
      clearedTransactions.has(String(t._id)),
    );
    const chequesCleared = clearedOnly
      .filter((t) => t.type === "Credit" || (t.amount > 0 && !t.type))
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    const depositsCleared = clearedOnly
      .filter((t) => t.type === "Debit" || (t.amount < 0 && !t.type))
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const unclearedCheques = unclearedTransactions
      .filter((t) => t.type === "Credit")
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const unclearedDeposits = unclearedTransactions
      .filter((t) => t.type === "Debit")
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const transactionsForBalance =
      cumulativeTransactions.length > 0 ? cumulativeTransactions : transactions;
    const totalDebits = transactionsForBalance
      .filter((t) => t.type === "Debit")
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const totalCredits = transactionsForBalance
      .filter((t) => t.type === "Credit")
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const book = totalDebits - totalCredits;
    const open = unclearedCheques + unclearedDeposits;
    const misc = 0.0;

    return {
      book,
      open,
      misc,
      chequesCleared,
      depositsCleared,
      totalOutstanding,
      reconciledBalance,
    };
  };

  const handleStatementInput = () => {
    setShowStatementModal(true);
  };

  const handleStatementSubmit = async () => {
    try {
      // Save statement amount to database
      await axiosInstance.put(
        `/reconciliation-settings/10002/statement-amount`,
        {
          fromDate: fromDate,
          toDate: toDate,
          statementAmount: parseFloat(statementAmount) || null,
        },
      );

      // Save to localStorage for persistence across browser refresh
      localStorage.setItem(
        "reconcileRealEstateTrust_statementAmount",
        statementAmount,
      );

      setShowStatementModal(false);
    } catch (error) {
      console.error("Error saving statement amount:", error);
      alert("Error saving statement amount. Please try again.");
    }
  };

  const handleRowClick = (transaction) => {
    setSelectedTransaction(transaction);
    setShowClearModal(true);
  };

  const handleClearTransaction = async (shouldClear) => {
    if (selectedTransaction) {
      const ledgerId = selectedTransaction._id;
      const newClearedTransactions = new Set(clearedTransactions);

      if (shouldClear) {
        newClearedTransactions.add(String(ledgerId));
      } else {
        newClearedTransactions.delete(String(ledgerId));
      }

      setClearedTransactions(newClearedTransactions);

      // Save to database (persists across refresh)
      try {
        await axiosInstance.put(
          `/reconciliation-settings/10002/cleared-transactions`,
          {
            fromDate: fromDate,
            toDate: toDate,
            ledgerId: ledgerId != null ? String(ledgerId) : undefined,
            shouldClear: shouldClear,
          },
        );
      } catch (error) {
        console.error("Error saving cleared transaction status:", error);
        if (shouldClear) {
          newClearedTransactions.delete(String(ledgerId));
        } else {
          newClearedTransactions.add(String(ledgerId));
        }
        setClearedTransactions(new Set(newClearedTransactions));
        alert("Error saving transaction status. Please try again.");
      }
    }
    setShowClearModal(false);
    setSelectedTransaction(null);
  };

  const reconciliationValues = calculateReconciliationValues();

  const handlePrint = () => {
    if (!showTable || transactions.length === 0) {
      alert("Please retrieve data first before printing.");
      return;
    }

    const unclearedTransactions = transactions.filter(
      (t) => !clearedTransactions.has(String(t._id)),
    );
    const {
      totalOutstandingDebits,
      totalOutstandingCredits,
      totalOutstanding,
      reconciledBalance,
    } = computeUnclearedOutstanding(transactions);

    const printWindow = window.open("", "", "width=900,height=700");
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>365 Realty Brokerage Real Estate Trust Account Reconciliation</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.4; font-size: 11px; }
            .header { text-align: center; margin-bottom: 40px; position: relative; }
            /* ✅ Decrease logo size */
            .logo { max-width: 80px; margin-bottom: 8px; }
            .company-name { font-size: 16px; font-weight: bold; color: #333; margin-bottom: 5px; }
            .report-title { font-size: 14px; color: #666; margin-bottom: 5px; }
            .date-info { font-size: 12px; color: #666; }
            .section { margin-bottom: 30px; }
            .section-title { font-size: 14px; font-weight: bold; color: #333; margin-bottom: 15px; border-bottom: 2px solid #333; padding-bottom: 5px; }
            .balance-amount { font-size: 16px; font-weight: bold; color: #333; }
            .transactions-table { width: 100%; border-collapse: collapse; margin-top: 15px; table-layout: fixed; }
            .transactions-table th, .transactions-table td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 10px; vertical-align: top; overflow-wrap: anywhere; }
            .transactions-table th { background: #f5f5f5; font-weight: bold; }
            .transactions-table th:nth-child(1), .transactions-table td:nth-child(1) { width: 55px; min-width: 55px; white-space: nowrap; overflow: hidden; }
            .transactions-table th:nth-child(2), .transactions-table td:nth-child(2) { width: 260px; min-width: 260px; }
            .transactions-table th:nth-child(3), .transactions-table td:nth-child(3) { width: 170px; min-width: 170px; }
            .transactions-table th:nth-child(4), .transactions-table td:nth-child(4) { width: 90px; min-width: 90px; white-space: nowrap; }
            .transactions-table th:nth-child(5), .transactions-table td:nth-child(5) { width: 85px; min-width: 85px; white-space: nowrap; overflow: hidden; }
            .transactions-table th:nth-child(6), .transactions-table td:nth-child(6) { width: 75px; min-width: 75px; text-align: right; white-space: nowrap; }
            .transactions-table th:nth-child(7), .transactions-table td:nth-child(7) { width: 95px; min-width: 95px; text-align: right; white-space: nowrap; }

            .total-row { font-weight: bold; background: #f9f9f9; }
            .ledger-summary { background: #f9f9f5; padding: 15px; border-radius: 5px; margin-top: 20px; }
            .ledger-summary h4 { margin-top: 0; color: #333; font-size: 12px; }
            .ledger-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-top: 10px; }
            .ledger-item { display: flex; justify-content: space-between; font-size: 10px; }
            .note { font-style: italic; color: #666; margin-top: 15px; font-size: 10px; }
            .approval-section { margin-top: 40px; }
            .approval-line { margin: 20px 0; font-size: 10px; }
            .approval-label { display: inline-block; width: 120px; font-weight: bold; }
            .approval-underline { display: inline-block; width: 200px; border-bottom: 1px solid #333; margin-left: 10px; }
            @media print {
              body { margin: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <img src="${logo2}" alt="365 Realty Brokerage Logo" class="logo">
            <div class="company-name">365 Realty Brokerage</div>
            <div class="report-title">Real Estate Trust XXXX1618 GL#10002 Account Reconciliation</div>
            <div class="date-info">As of ${new Date(toDate).toLocaleDateString(
              "en-US",
              { month: "long", day: "numeric", year: "numeric" },
            )}</div>
          </div>

          <div class="section">
            <div class="section-title">Balance Per Bank Statement</div>
            <div class="balance-amount">${
              statementAmount
                ? formatAmount(parseFloat(statementAmount))
                : "Not entered"
            }</div>
          </div>

          <div class="section">
            <div class="section-title">Outstanding Transactions</div>
            ${
              unclearedTransactions.length > 0
                ? `
              <table class="transactions-table">
                <thead>
                  <tr>
                    <th>Trade #</th>
                    <th>Address/Description</th>
                    <th>Payee</th>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Debit</th>
                    <th>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  ${unclearedTransactions
                    .map((transaction) => {
                      // Extract address from description
                      const addressMatch = (
                        transaction.description ||
                        transaction.narration ||
                        ""
                      ).match(/- ([^-]+)$/);
                      const address = addressMatch ? addressMatch[1] : "-";

                      // Use actual payee from EFT record if available, otherwise extract from description
                      let payee = transaction.payee || "-";
                      if (payee === "-") {
                        // First try to extract "Received from" for deposits
                        const receivedFromMatch = (
                          transaction.description ||
                          transaction.narration ||
                          ""
                        ).match(/Received from: ([^-]+)/);
                        if (receivedFromMatch) {
                          payee = receivedFromMatch[1].trim();
                        } else {
                          // Fallback to "Paid to" for payments
                          const payeeMatch = (
                            transaction.description ||
                            transaction.narration ||
                            ""
                          ).match(/Paid to: ([^-]+)/);
                          payee = payeeMatch ? payeeMatch[1].trim() : "-";
                        }
                      }

                      // For deposits (positive amounts), show "Received from" information
                      if (transaction.amount > 0 && payee !== "-") {
                        // If payee doesn't already start with "Received from:", add it
                        if (!payee.toLowerCase().includes("received from:")) {
                          payee = `Received from: ${payee}`;
                        }
                      }

                      // Determine what to show in the Trade # column
                      let tradeDisplay = transaction.tradeNumber || "-";
                      if (
                        tradeDisplay === "-" &&
                        transaction.reference &&
                        transaction.reference.startsWith("EFT#")
                      ) {
                        // Extract EFT number from reference (remove "EFT#" prefix)
                        tradeDisplay = transaction.reference.replace(
                          "EFT#",
                          "",
                        );
                      }

                      const absAmount = Math.abs(transaction.amount || 0);
                      const debit = isDebitTxn(transaction)
                        ? formatAmount(absAmount)
                        : "";
                      const credit = !isDebitTxn(transaction)
                        ? formatAmount(absAmount)
                        : "";

                      return `
                      <tr>
                        <td>${tradeDisplay}</td>
                        <td>${address}</td>
                        <td>${payee}</td>
                        <td>${formatDate(
                          transaction.date || transaction.transactionDate,
                        )}</td>
                        <td>${
                          transaction.reference &&
                          transaction.reference !== "null" &&
                          transaction.reference !== null &&
                          transaction.reference.trim() !== ""
                            ? transaction.reference
                            : "-"
                        }</td>
                        <td>${debit}</td>
                        <td>${credit}</td>
                      </tr>
                    `;
                    })
                    .join("")}
                  <tr class="total-row">
                    <td colspan="5">Total Debits Outstanding</td>
                    <td>${formatAmount(totalOutstandingDebits)}</td>
                    <td></td>
                  </tr>
                  <tr class="total-row">
                    <td colspan="5">Total Credits Outstanding</td>
                    <td></td>
                    <td>${formatAmount(totalOutstandingCredits)}</td>
                  </tr>
                  <tr class="total-row">
                    <td colspan="5">Total Outstanding</td>
                    <td colspan="2">${formatAmount(totalOutstanding)}</td>
                  </tr>
                </tbody>
              </table>
              <div style="margin-top: 15px; font-weight: bold;">
                Reconciled Balance: ${formatAmount(reconciledBalance)}
              </div>
            `
                : "<p>No outstanding transactions</p>"
            }
          </div>

          <div class="section">
            <div class="section-title">Balance Per Real Estate Trust Ledger</div>
            <div class="ledger-summary">
              <div class="ledger-item" style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #ddd;">
                <span>Closing Balance:</span>
                <span>${formatAmount(reconciliationValues.reconciledBalance)}</span>
              </div>
              <div class="ledger-grid">
                <div class="ledger-item">
                  <span>Cheques Cleared:</span>
                  <span>${formatAmount(
                    reconciliationValues.chequesCleared,
                  )}</span>
                </div>
                <div class="ledger-item">
                  <span>Deposits Cleared:</span>
                  <span>${formatAmount(
                    reconciliationValues.depositsCleared,
                  )}</span>
                </div>
                <div class="ledger-item">
                  <span>Total Credits Cleared:</span>
                  <span>${formatAmount(
                    reconciliationValues.chequesCleared,
                  )}</span>
                </div>
                <div class="ledger-item">
                  <span>Total Debits Cleared:</span>
                  <span>${formatAmount(
                    reconciliationValues.depositsCleared,
                  )}</span>
                </div>
              </div>
              <div class="note">*Remember, your debits are credits to the bank and vice versa.</div>
            </div>
          </div>

          <div class="approval-section">
            <div class="approval-line">
              <span class="approval-label">Reviewed By:</span>
              <span class="approval-underline"></span>
              <span style="margin-left: 20px;">Date:</span>
              <span class="approval-underline"></span>
            </div>
            <div class="approval-line">
              <span class="approval-label">Approved By:</span>
              <span class="approval-underline"></span>
              <span style="margin-left: 20px;">Date:</span>
              <span class="approval-underline"></span>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  const handlePrintTrustJournal = () => {
    const s1 = trustLedgerSections.section1 || [];
    const s2 = trustLedgerSections.section2 || [];
    if (s1.length === 0 && s2.length === 0) {
      alert("Please generate the Trust Ledger before printing.");
      return;
    }

    const escapeHtml = (value) => {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    const rowHtml = (rows, includeFinalized) =>
      rows
        .map(
          (t) => `
          <tr>
            <td>${escapeHtml(t.tradeNumber || "-")}</td>
            <td>${escapeHtml(t.address || "-")}</td>
            <td>${escapeHtml(t.depositDates || "-")}</td>
            <td class="amount-col">${escapeHtml(formatAmount(t.depositTotal || 0))}</td>
            ${
              includeFinalized
                ? `<td>${escapeHtml(t.finalizedDate || "-")}</td>`
                : ""
            }
            <td>${escapeHtml(t.eftIssuedDates || "-")}</td>
          </tr>`,
        )
        .join("");

    const totalS1 = s1.reduce((sum, t) => sum + (t.depositTotal || 0), 0);
    const totalS2 = s2.reduce((sum, t) => sum + (t.depositTotal || 0), 0);
    const grandTotal = totalS1 + totalS2;

    const printWindow = window.open("", "", "width=1000,height=800");
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Trust Ledger - Real Estate Trust (10002)</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.4; font-size: 11px; }
            .header { text-align: center; margin-bottom: 20px; }
            .logo { max-width: 80px; margin-bottom: 8px; }
            .company-name { font-size: 16px; font-weight: bold; color: #333; margin-bottom: 5px; }
            .report-title { font-size: 14px; color: #666; margin-bottom: 5px; }
            .date-info { font-size: 12px; color: #666; }
            .section-title { font-size: 13px; font-weight: bold; color: #333; margin: 16px 0 8px; border-bottom: 1px solid #333; padding-bottom: 4px; }
            .trust-journal-table { width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
            .trust-journal-table th, .trust-journal-table td { border: 1px solid #ddd; padding: 6px; text-align: left; font-size: 10px; vertical-align: top; overflow-wrap: anywhere; }
            .trust-journal-table th { background: #f5f5f5; font-weight: bold; }
            tfoot td { font-weight: bold; background: #fafafa; }
            .amount-col { text-align: right; white-space: nowrap; }
            .trust-journal-table.report-r1 col.col-trade { width: 7%; }
            .trust-journal-table.report-r1 col.col-address { width: 38%; }
            .trust-journal-table.report-r1 col.col-dates { width: 14%; }
            .trust-journal-table.report-r1 col.col-deposit { width: 12%; }
            .trust-journal-table.report-r1 col.col-finalized { width: 12%; }
            .trust-journal-table.report-r1 col.col-eft { width: 17%; }
            .trust-journal-table.report-r2 col.col-trade { width: 8%; }
            .trust-journal-table.report-r2 col.col-address { width: 42%; }
            .trust-journal-table.report-r2 col.col-dates { width: 15%; }
            .trust-journal-table.report-r2 col.col-deposit { width: 13%; }
            .trust-journal-table.report-r2 col.col-eft { width: 22%; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body>
          <div class="header">
            <img src="${logo2}" alt="365 Realty Brokerage Logo" class="logo">
            <div class="company-name">365 Realty Brokerage</div>
            <div class="report-title">Trust Ledger — G/L #10002 (Real Estate Trust)</div>
            <div class="date-info">Period: ${escapeHtml(fromDate)} to ${escapeHtml(toDate)}</div>
          </div>

          ${
            s1.length > 0
              ? `
          <div class="section-title">Report 1</div>
          <table class="trust-journal-table report-r1">
            <colgroup>
              <col class="col-trade" />
              <col class="col-address" />
              <col class="col-dates" />
              <col class="col-deposit" />
              <col class="col-finalized" />
              <col class="col-eft" />
            </colgroup>
            <thead>
              <tr>
                <th>Trade #</th>
                <th>Address</th>
                <th>Deposit date(s)</th>
                <th class="amount-col">Deposit</th>
                <th>Finalized</th>
                <th>EFT issued</th>
              </tr>
            </thead>
            <tbody>
              ${rowHtml(s1, true)}
            </tbody>
            <tfoot><tr><td colspan="3" style="text-align:right;">Report 1 total</td><td class="amount-col">${escapeHtml(formatAmount(totalS1))}</td><td></td><td></td></tr></tfoot>
          </table>
          `
              : ""
          }

          ${
            s2.length > 0
              ? `
          <div class="section-title">Report 2</div>
          <table class="trust-journal-table report-r2">
            <colgroup>
              <col class="col-trade" />
              <col class="col-address" />
              <col class="col-dates" />
              <col class="col-deposit" />
              <col class="col-eft" />
            </colgroup>
            <thead>
              <tr>
                <th>Trade #</th>
                <th>Address</th>
                <th>Deposit date(s)</th>
                <th class="amount-col">Deposit</th>
                <th>EFT issued</th>
              </tr>
            </thead>
            <tbody>
              ${rowHtml(s2, false)}
            </tbody>
            <tfoot><tr><td colspan="3" style="text-align:right;">Report 2 total</td><td class="amount-col">${escapeHtml(formatAmount(totalS2))}</td><td></td></tr></tfoot>
          </table>
          `
              : ""
          }

          <table class="trust-journal-table report-r1" style="margin-top: 20px;">
            <colgroup>
              <col class="col-trade" />
              <col class="col-address" />
              <col class="col-dates" />
              <col class="col-deposit" />
              <col class="col-finalized" />
              <col class="col-eft" />
            </colgroup>
            <tfoot>
              <tr>
                <td colspan="3" style="text-align:right; font-size: 12px;">${s1.length > 0 && s2.length > 0 ? "Grand total (Report 1 + Report 2)" : "Grand total"}</td>
                <td class="amount-col" style="font-size: 12px;">${escapeHtml(formatAmount(grandTotal))}</td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  const handleClearedChequeReport = () => {
    // Filter cleared transactions (both Credit and Debit)
    const clearedTransactionsList = transactions.filter((t) =>
      clearedTransactions.has(String(t._id)),
    );

    if (clearedTransactionsList.length === 0) {
      alert("No cleared transactions found for the selected period.");
      return;
    }

    const totalCleared = clearedTransactionsList.reduce(
      (sum, t) => sum + Math.abs(t.amount || 0),
      0,
    );

    // Calculate separate totals for cleared credits and debits
    const totalCreditsCleared = clearedTransactionsList
      .filter((t) => t.type === "Credit" || (t.amount > 0 && !t.type))
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const totalDebitsCleared = clearedTransactionsList
      .filter((t) => t.type === "Debit" || (t.amount < 0 && !t.type))
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const printWindow = window.open("", "", "width=1000,height=800");
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Cleared Cheque Report - Real Estate Trust Account</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.4; font-size: 11px; }
            .header { text-align: center; margin-bottom: 30px; position: relative; }
            /* ✅ Decrease logo size */
            .logo { max-width: 80px; margin-bottom: 8px; }
            .company-name { font-size: 16px; font-weight: bold; color: #333; margin-bottom: 5px; }
            .report-title { font-size: 14px; color: #666; margin-bottom: 5px; }
            .date-info { font-size: 12px; color: #666; margin-bottom: 20px; }
            .summary { background: #f9f9f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
            .summary-item { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px; }
            .transactions-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            .transactions-table th, .transactions-table td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 10px; }
            .transactions-table th { background: #f5f5f5; font-weight: bold; }

            /* ✅ Decrease Date column width (Date is column #2 here) */
            .transactions-table th:nth-child(2),
            .transactions-table td:nth-child(2) {
              width: 150px;
              min-width: 150px;
            }

            /* ✅ Increase Description column width (Description is column #4 here) */
            .transactions-table th:nth-child(4),
            .transactions-table td:nth-child(4) {
              width: 350px;
              min-width: 350px;
            }

            /* ✅ Increase Payee column width (Payee is column #5 here) */
            .transactions-table th:nth-child(5),
            .transactions-table td:nth-child(5) {
              width: 280px;
              min-width: 280px;
            }

            .total-row { font-weight: bold; background: #f9f9f9; }
            .print-button { 
              background: #4F46E5; 
              color: white; 
              padding: 10px 20px; 
              border: none; 
              border-radius: 5px; 
              cursor: pointer; 
              font-size: 14px; 
              margin: 20px 0;
              display: inline-block;
            }
            .print-button:hover { background: #4338CA; }

            /* ✅ Print button top-right */
            .top-right-print {
              position: absolute;
              top: 0;
              right: 0;
            }

            @media print {
              body { margin: 0; }
              .no-print { display: none; }
              .print-button { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <img src="${logo2}" alt="365 Realty Brokerage Logo" class="logo">
            <div class="company-name">Save Max 365 Realty., Brokerage</div>
            <div class="report-title">Cleared Cheque Report - Real Estate Trust Account (10002)</div>
            <div class="date-info">
              Period: ${new Date(fromDate).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })} to ${new Date(toDate).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </div>

            <div class="no-print top-right-print">
              <button class="print-button" onclick="window.print()">Print Report</button>
            </div>
          </div>

          <div class="summary">
            <div class="summary-item">
              <span><strong>Total Cleared Transactions:</strong></span>
              <span><strong>${clearedTransactionsList.length}</strong></span>
            </div>
            <div class="summary-item">
              <span><strong>Total Credits Cleared:</strong></span>
              <span><strong>${formatAmount(totalCreditsCleared)}</strong></span>
            </div>
            <div class="summary-item">
              <span><strong>Total Debits Cleared:</strong></span>
              <span><strong>${formatAmount(totalDebitsCleared)}</strong></span>
            </div>
            <div class="summary-item">
              <span><strong>Total Amount:</strong></span>
              <span><strong>${formatAmount(totalCleared)}</strong></span>
            </div>
          </div>

          <table class="transactions-table">
            <thead>
              <tr>
                <th>Trade #</th>
                <th>Date</th>
                <th>Reference</th>
                <th>Description</th>
                <th>Payee</th>
                <th>Type</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${clearedTransactionsList
                .map((transaction) => {
                  // Extract address from description
                  const addressMatch = (
                    transaction.description ||
                    transaction.narration ||
                    ""
                  ).match(/- ([^-]+)$/);
                  const address = addressMatch ? addressMatch[1] : "-";

                  // Use actual payee from EFT record if available, otherwise extract from description
                  let payee = transaction.payee || "-";
                  if (payee === "-") {
                    const receivedFromMatch = (
                      transaction.description ||
                      transaction.narration ||
                      ""
                    ).match(/Received from: ([^-]+)/);
                    if (receivedFromMatch) {
                      payee = receivedFromMatch[1].trim();
                    } else {
                      const payeeMatch = (
                        transaction.description ||
                        transaction.narration ||
                        ""
                      ).match(/Paid to: ([^-]+)/);
                      payee = payeeMatch ? payeeMatch[1].trim() : "-";
                    }
                  }

                  // Determine what to show in the Trade # column
                  let tradeDisplay = transaction.tradeNumber || "-";
                  if (
                    tradeDisplay === "-" &&
                    transaction.reference &&
                    transaction.reference.startsWith("EFT#")
                  ) {
                    tradeDisplay = transaction.reference.replace("EFT#", "");
                  }

                  const transactionType =
                    transaction.type ||
                    (transaction.amount > 0 ? "Credit" : "Debit");

                  return `
                    <tr>
                      <td>${tradeDisplay}</td>
                      <td>${formatDate(
                        transaction.date || transaction.transactionDate,
                      )}</td>
                      <td>${
                        transaction.reference &&
                        transaction.reference !== "null" &&
                        transaction.reference !== null &&
                        transaction.reference.trim() !== ""
                          ? transaction.reference
                          : "-"
                      }</td>
                      <td>${
                        transaction.description || transaction.narration || "-"
                      }</td>
                      <td>${payee}</td>
                      <td>${transactionType}</td>
                      <td>${formatAmount(
                        Math.abs(transaction.amount || 0),
                      )}</td>
                    </tr>
                  `;
                })
                .join("")}
              <tr class="total-row">
                <td colspan="6">Total</td>
                <td>${formatAmount(totalCleared)}</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
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
              Reconciling Real Estate Trust
            </h2>

            {/* Date Picker Section */}
            <div className="bg-gray-50 p-6 rounded-lg mb-6">
              <h3 className="text-lg font-semibold mb-4">Select Date Range</h3>
              <div className="flex space-x-4 mb-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
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
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex space-x-4">
                <button
                  onClick={handleRetrieveData}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-6 rounded-md transition-colors"
                >
                  {loading ? "Loading..." : "Retrieve Data"}
                </button>
                <button
                  onClick={handlePrint}
                  disabled={!showTable || transactions.length === 0}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2 px-6 rounded-md transition-colors flex items-center"
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                    />
                  </svg>
                  Print Report
                </button>
                {showTable && transactions.length > 0 && (
                  <button
                    onClick={handleClearedChequeReport}
                    className="bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-6 rounded-md transition-colors flex items-center"
                  >
                    <svg
                      className="w-4 h-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    Cleared Cheque Report
                  </button>
                )}
                {showTable && transactions.length > 0 && (
                  <button
                    onClick={generateTrustJournal}
                    disabled={trustJournalLoading}
                    className="bg-slate-700 hover:bg-slate-800 disabled:bg-slate-400 text-white font-medium py-2 px-6 rounded-md transition-colors"
                  >
                    {trustJournalLoading ? "Loading..." : "Trust Ledger"}
                  </button>
                )}
              </div>
            </div>

            {/* Reconciliation Formula Section */}
            {showTable && (
              <div className="bg-white rounded-lg shadow-md mb-6">
                <h3 className="text-lg font-semibold p-6 border-b border-gray-200">
                  Reconciliation Formula
                </h3>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="text-center">
                      <h4 className="text-sm font-medium text-gray-600 mb-2">
                        Book
                      </h4>
                      <p className="text-lg font-semibold text-gray-900">
                        {formatAmount(reconciliationValues.book)}
                      </p>
                    </div>
                    <div className="text-center">
                      <h4 className="text-sm font-medium text-gray-600 mb-2">
                        Open
                      </h4>
                      <p className="text-lg font-semibold text-gray-900">
                        {formatAmount(reconciliationValues.open)}
                      </p>
                    </div>
                    <div className="text-center">
                      <h4 className="text-sm font-medium text-gray-600 mb-2">
                        Misc
                      </h4>
                      <p className="text-lg font-semibold text-gray-900">
                        {formatAmount(reconciliationValues.misc)}
                      </p>
                    </div>
                    <div className="text-center">
                      <h4 className="text-sm font-medium text-gray-600 mb-2">
                        Statement
                      </h4>
                      <button
                        onClick={handleStatementInput}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md text-left text-gray-700 hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {statementAmount
                          ? formatAmount(parseFloat(statementAmount))
                          : "Click to enter"}
                      </button>
                    </div>
                  </div>

                  {/* Formula Display */}
                  <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-center space-x-4 text-lg font-medium">
                      <span>
                        Book: {formatAmount(reconciliationValues.book)}
                      </span>
                      <span>+</span>
                      <span>
                        Open: {formatAmount(reconciliationValues.open)}
                      </span>
                      <span>-</span>
                      <span>
                        Misc: {formatAmount(reconciliationValues.misc)}
                      </span>
                      <span>=</span>
                      <span>
                        Bank:{" "}
                        {formatAmount(
                          reconciliationValues.book +
                            reconciliationValues.open -
                            reconciliationValues.misc,
                        )}
                      </span>
                    </div>
                    {statementAmount && (
                      <div className="mt-4 text-center">
                        <span className="text-sm text-gray-600">
                          Difference:{" "}
                        </span>
                        <span
                          className={`text-sm font-semibold ${
                            Math.abs(
                              reconciliationValues.book +
                                reconciliationValues.open -
                                reconciliationValues.misc -
                                parseFloat(statementAmount),
                            ) < 0.01
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {formatAmount(
                            reconciliationValues.book +
                              reconciliationValues.open -
                              reconciliationValues.misc -
                              parseFloat(statementAmount),
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Transactions Table */}
            {showTable && (
              <div className="bg-white rounded-lg shadow-md">
                <h3 className="text-lg font-semibold p-6 border-b border-gray-200">
                  Cash - Trust Account Transactions (10002)
                </h3>

                {/* Summary Section */}
                {transactions.length > 0 && (
                  <div className="bg-gray-50 p-6 border-b border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="text-center">
                        <h4 className="text-sm font-medium text-gray-600 mb-2">
                          Cheques Cleared
                        </h4>
                        <p className="text-lg font-semibold text-red-600">
                          {formatAmount(reconciliationValues.chequesCleared)}
                        </p>
                      </div>
                      <div className="text-center">
                        <h4 className="text-sm font-medium text-gray-600 mb-2">
                          Deposits Cleared
                        </h4>
                        <p className="text-lg font-semibold text-green-600">
                          {formatAmount(reconciliationValues.depositsCleared)}
                        </p>
                      </div>
                      <div className="text-center">
                        <h4 className="text-sm font-medium text-gray-600 mb-2">
                          # Of Entries
                        </h4>
                        <p className="text-lg font-semibold text-gray-900">
                          {transactions.length}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 table-fixed">
                    <thead className="bg-gray-50">
                      <tr>
                        <th
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                          style={{ width: "6%" }}
                        >
                          Trade
                        </th>
                        <th
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                          style={{ width: "36%" }}
                        >
                          Description
                        </th>
                        <th
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                          style={{ width: "10%" }}
                        >
                          Date
                        </th>
                        <th
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                          style={{ width: "14%" }}
                        >
                          Reference
                        </th>
                        <th
                          className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                          style={{ width: "18%" }}
                        >
                          Amount
                        </th>
                        <th
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                          style={{ width: "10%" }}
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {transactions.length > 0 ? (
                        transactions.map((transaction, index) => (
                          <tr
                            key={index}
                            className="hover:bg-gray-50 cursor-pointer"
                            onClick={() => handleRowClick(transaction)}
                          >
                            <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                              {transaction.tradeNumber || "-"}
                            </td>
                            <td className="px-3 py-4 text-sm text-gray-900">
                              {transaction.description ||
                                transaction.narration ||
                                "-"}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                              {formatDate(
                                transaction.date || transaction.transactionDate,
                              )}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                              {transaction.reference ||
                                transaction.referenceNumber ||
                                "-"}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                              {formatTxnAmount(transaction)}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                              {clearedTransactions.has(
                                String(transaction._id),
                              ) ? (
                                <span className="text-green-600 text-xl">
                                  ✓
                                </span>
                              ) : (
                                <span className="text-red-600 text-xl">✗</span>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan="6"
                            className="px-6 py-4 text-center text-sm text-gray-500"
                          >
                            No transactions found for the selected date range
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Trust Ledger Modal */}
      {showTrustJournal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-6 border-b border-gray-200 flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Trust Ledger (G/L #10002)
                </h3>
                <p className="text-sm text-gray-600">
                  Period {fromDate} to {toDate}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handlePrintTrustJournal}
                  disabled={
                    trustJournalLoading ||
                    (trustLedgerSections.section1.length === 0 &&
                      trustLedgerSections.section2.length === 0)
                  }
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-md transition-colors"
                >
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => setShowTrustJournal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6 overflow-auto max-h-[75vh] space-y-8">
              {(trustLedgerSections.section1 || []).length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">
                    Report 1
                  </h4>
                  <div className="overflow-x-auto border border-gray-200 rounded-md">
                    <table className="w-full table-fixed min-w-full divide-y divide-gray-200 text-sm">
                      <colgroup>
                        <col style={{ width: "7%" }} />
                        <col style={{ width: "38%" }} />
                        <col style={{ width: "14%" }} />
                        <col style={{ width: "12%" }} />
                        <col style={{ width: "12%" }} />
                        <col style={{ width: "17%" }} />
                      </colgroup>
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Trade #
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Address
                          </th>
                          <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Deposit date(s)
                          </th>
                          <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                            Deposit
                          </th>
                          <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Finalized
                          </th>
                          <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            EFT issued
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {trustLedgerSections.section1.map((t) => (
                          <tr key={String(t.tradeId)}>
                            <td className="px-2 py-2 whitespace-nowrap">
                              {t.tradeNumber}
                            </td>
                            <td className="px-3 py-2 break-words">{t.address}</td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              {t.depositDates}
                            </td>
                            <td className="px-2 py-2 text-right whitespace-nowrap">
                              {formatAmount(t.depositTotal)}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              {t.finalizedDate}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap text-gray-700">
                              {t.eftIssuedDates}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td
                            colSpan={3}
                            className="px-2 py-2 text-right text-sm font-semibold"
                          >
                            Report 1 total
                          </td>
                          <td className="px-2 py-2 text-right text-sm font-semibold whitespace-nowrap">
                            {formatAmount(
                              trustLedgerSections.section1.reduce(
                                (s, r) => s + (r.depositTotal || 0),
                                0,
                              ),
                            )}
                          </td>
                          <td />
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {(trustLedgerSections.section2 || []).length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">
                    Report 2
                  </h4>
                  <div className="overflow-x-auto border border-gray-200 rounded-md">
                    <table className="w-full table-fixed min-w-full divide-y divide-gray-200 text-sm">
                      <colgroup>
                        <col style={{ width: "8%" }} />
                        <col style={{ width: "42%" }} />
                        <col style={{ width: "15%" }} />
                        <col style={{ width: "13%" }} />
                        <col style={{ width: "22%" }} />
                      </colgroup>
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Trade #
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Address
                          </th>
                          <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Deposit date(s)
                          </th>
                          <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                            Deposit
                          </th>
                          <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            EFT issued
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {trustLedgerSections.section2.map((t) => (
                          <tr key={String(t.tradeId)}>
                            <td className="px-2 py-2 whitespace-nowrap">
                              {t.tradeNumber}
                            </td>
                            <td className="px-3 py-2 break-words">{t.address}</td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              {t.depositDates}
                            </td>
                            <td className="px-2 py-2 text-right whitespace-nowrap">
                              {formatAmount(t.depositTotal)}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap text-gray-700">
                              {t.eftIssuedDates}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td
                            colSpan={3}
                            className="px-2 py-2 text-right text-sm font-semibold"
                          >
                            Report 2 total
                          </td>
                          <td className="px-2 py-2 text-right text-sm font-semibold whitespace-nowrap">
                            {formatAmount(
                              trustLedgerSections.section2.reduce(
                                (s, r) => s + (r.depositTotal || 0),
                                0,
                              ),
                            )}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {(trustLedgerSections.section1.length > 0 ||
                (trustLedgerSections.section2 || []).length > 0) && (
                <div className="flex justify-end border-t border-gray-200 pt-4">
                  <p className="text-sm font-semibold text-gray-900">
                    {(trustLedgerSections.section1 || []).length > 0 &&
                    (trustLedgerSections.section2 || []).length > 0
                      ? "Grand total (Report 1 + Report 2): "
                      : "Grand total: "}
                    {formatAmount(
                      trustLedgerSections.section1.reduce(
                        (s, r) => s + (r.depositTotal || 0),
                        0,
                      ) +
                        (trustLedgerSections.section2 || []).reduce(
                          (s, r) => s + (r.depositTotal || 0),
                          0,
                        ),
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Statement Input Modal */}
      {showStatementModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">
              Enter Statement Amount
            </h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Statement Amount
              </label>
              <input
                type="number"
                step="0.01"
                value={statementAmount}
                onChange={(e) => setStatementAmount(e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowStatementModal(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleStatementSubmit}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Transaction Modal */}
      {showClearModal && selectedTransaction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">
              {clearedTransactions.has(String(selectedTransaction._id))
                ? "Unclear Transaction"
                : "Clear Transaction"}
            </h3>
            <div className="mb-4">
              <p className="text-sm text-gray-700 mb-2">
                {clearedTransactions.has(String(selectedTransaction._id))
                  ? "Do you want to add this transaction back to the Open calculation?"
                  : "Do you want to clear this transaction from the Open calculation?"}
              </p>
              <div className="bg-gray-50 p-3 rounded-md">
                <p className="text-sm font-medium text-gray-900">
                  Amount:{" "}
                  {formatAmount(Math.abs(selectedTransaction.amount || 0))}
                </p>
                <p className="text-sm text-gray-600">
                  Description:{" "}
                  {selectedTransaction.description ||
                    selectedTransaction.narration ||
                    "-"}
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowClearModal(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  handleClearTransaction(
                    !clearedTransactions.has(String(selectedTransaction._id)),
                  )
                }
                className={`px-4 py-2 text-white rounded-md ${
                  clearedTransactions.has(String(selectedTransaction._id))
                    ? "bg-orange-600 hover:bg-orange-700"
                    : "bg-green-600 hover:bg-green-700"
                }`}
              >
                {clearedTransactions.has(String(selectedTransaction._id))
                  ? "Yes, Unclear"
                  : "Yes, Clear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReconcileRealEstateTrust;
