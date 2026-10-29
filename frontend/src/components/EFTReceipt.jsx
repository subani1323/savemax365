import React from "react";
import logo from "../Assets/logo2.jpg";
import { toWords } from "number-to-words";

const EFTReceipt = ({ data, onClose, hideTradeSellerBuyer }) => {
  const companyInfo = {
    name: "365 Realty Brokerage",
    addressLine1: "66 Antibes Dr",
    addressLine2: "Brampton Ontario L6X 5H5",
    phone: "416-365-0100",
  };

  if (!data) {
    return (
      <div className="fixed inset-0 bg-white flex justify-center items-center z-50 p-4">
        <div className="bg-white p-8 rounded-lg max-w-md w-full text-center">
          <h2 className="text-xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-gray-600 mb-6">No receipt data available.</p>
          <button
            onClick={onClose}
            className="bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const {
    eftNumber,
    paidTo,
    trade,
    notes,
    amount,
    seller,
    buyer,
    firstPartyLabel = "Seller",
    secondPartyLabel = "Buyer",
    payTo,
    orderOf,
    note,
    chequeDate,
    eftAgentSummary,
  } = data;

  const fmtMoney = (n) =>
    Number(n || 0).toLocaleString("en-CA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const fmtYtdMoney = (v) =>
    v == null || Number.isNaN(Number(v)) ? "—" : `$${fmtMoney(Number(v))}`;
  const fmtYtdOffice = (v) => {
    if (v == null || Number.isNaN(Number(v))) return "—";
    const n = Number(v);
    if (n === 0) return "$0.00";
    return `-$${fmtMoney(Math.abs(n))}`;
  };

  const buildOrderLine = () => {
    if (!orderOf) return "N/A";
    const streetNumber = String(orderOf.streetNumber || "").trim();
    const streetName = String(orderOf.streetName || "").trim();
    const unitNumber = String(orderOf.unitNumber || "").trim();
    const legacy = String(orderOf.address || "").trim();

    const base =
      `${streetNumber}${streetNumber && streetName ? ", " : ""}${streetName}`.trim();
    const withUnit = unitNumber ? `${base}, ${unitNumber}` : base;
    return withUnit || legacy || "N/A";
  };

  const buildOfLine = () => {
    if (!orderOf) return "N/A";
    const province = String(orderOf.province || "").trim();
    const postalCode = String(orderOf.postalCode || "").trim();
    const legacy = String(orderOf.cityProvincePostal || "").trim();

    const provPostal =
      `${province}${province && postalCode ? ", " : ""}${postalCode}`.trim();
    return provPostal || legacy || "N/A";
  };

  const amountNumber = Number(amount) || 0;

  const agentBuyerRebateAmt = eftAgentSummary
    ? Number(eftAgentSummary.buyerRebateAmount) || 0
    : 0;
  const grossEarningsDisplay =
    eftAgentSummary &&
    (eftAgentSummary.tradeCommissionExHST != null
      ? eftAgentSummary.tradeCommissionExHST
      : eftAgentSummary.grossEarningsExHST);

  const convertAmountToWords = (amt) => {
    const dollars = Math.floor(amt);
    const cents = Math.round((amt - dollars) * 100);

    let result = "";

    if (dollars > 0) {
      result =
        toWords(dollars)
          .replace(/,/g, "")
          .split(" ")
          .map(
            (word) =>
              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
          )
          .join(" ") + " Dollars";
    }

    if (cents > 0) {
      if (result) {
        result += " and ";
      }
      result += `${cents}/100`;
    }

    if (!result) {
      result = "Zero Dollars";
    }

    return result + " Only";
  };

  const amountInWords = convertAmountToWords(amountNumber);
  const currentDate = new Date().toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const displayDate = chequeDate
    ? (() => {
        let dateToUse;
        if (chequeDate.includes("/")) {
          const [month, day, year] = chequeDate.split("/");
          dateToUse = `${year}-${month.padStart(2, "0")}-${day.padStart(
            2,
            "0",
          )}T00:00:00`;
        } else {
          dateToUse = chequeDate + "T00:00:00";
        }
        return new Date(dateToUse).toLocaleDateString("en-CA", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      })()
    : currentDate;

  const getPaidToDisplay = () => {
    if (typeof paidTo === "string") {
      return paidTo;
    } else if (paidTo && typeof paidTo === "object") {
      return paidTo.name || "N/A";
    }
    return "N/A";
  };

  const escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const buildAgentSummaryPrintHtml = () => {
    if (!eftAgentSummary) return "";
    const a = eftAgentSummary;
    const tradeGrossForTable =
      a.tradeCommissionExHST != null
        ? a.tradeCommissionExHST
        : a.grossEarningsExHST;
    const grossEarningsRow =
      a.tradeCommissionExHST != null
        ? a.tradeCommissionExHST
        : a.grossEarningsExHST;
    const office = Number(a.officeShareLess) || 0;
    const officeDisplay =
      office === 0 ? "$0.00" : `-$${fmtMoney(Math.abs(office))}`;
    const officeExpensesAmt = Number(a.officeExpenses) || 0;
    const commissionDeductionAmt = Number(a.commissionDeduction) || 0;
    const ytdPlain = (v) =>
      v == null || Number.isNaN(Number(v)) ? "—" : `$${fmtMoney(Number(v))}`;
    const ytdOffice = (v) => {
      if (v == null || Number.isNaN(Number(v))) return "—";
      const n = Number(v);
      if (n === 0) return "$0.00";
      return `-$${fmtMoney(Math.abs(n))}`;
    };
    const buyerRebate = Number(a.buyerRebateAmount) || 0;
    const rebateDisplay =
      buyerRebate === 0 ? "$0.00" : `-$${fmtMoney(Math.abs(buyerRebate))}`;
    const showOfficeExpenses =
      officeExpensesAmt > 0 || Number(a.ytdOfficeExpenses) > 0;
    const showCommissionDeduction =
      commissionDeductionAmt > 0 || Number(a.ytdCommissionDeduction) > 0;
    const officeExpensesRow = showOfficeExpenses
      ? `<tr><td style="padding: 2px 0;">Office expenses</td><td style="text-align: right; padding: 2px 0;">${
          officeExpensesAmt === 0
            ? "$0.00"
            : `-$${fmtMoney(Math.abs(officeExpensesAmt))}`
        }</td><td style="text-align: right; padding: 2px 0;">${ytdOffice(a.ytdOfficeExpenses)}</td></tr>`
      : "";
    const commissionDeductionRow = showCommissionDeduction
      ? `<tr><td style="padding: 2px 0;">Commission deduction</td><td style="text-align: right; padding: 2px 0;">${
          commissionDeductionAmt === 0
            ? "$0.00"
            : `-$${fmtMoney(Math.abs(commissionDeductionAmt))}`
        }</td><td style="text-align: right; padding: 2px 0;">${ytdOffice(a.ytdCommissionDeduction)}</td></tr>`
      : "";
    const rebateRow =
      buyerRebate > 0
        ? `<tr><td style="padding: 2px 0;">Buyer rebate</td><td style="text-align: right; padding: 2px 0;">${rebateDisplay}</td><td style="text-align: right; padding: 2px 0;">${ytdOffice(a.ytdBuyerRebate)}</td></tr>`
        : "";
    return `
          <div class="eft-payment-summary" style="margin-top: 0.2in; border: 1px solid #333; padding: 0.15in; font-size: 11px; color: black;">
            <div style="font-weight: bold; font-size: 12px; margin-bottom: 0.1in;">Payment summary</div>
            <div style="margin-bottom: 0.1in;">
              <span style="font-weight: bold;">Agent #:</span> ${escapeHtml(a.agentNumber)} &nbsp;&nbsp;
              <span style="font-weight: bold;">Agent name:</span> ${escapeHtml(a.agentName)}
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 0.12in; font-size: 10px;">
              <thead>
                <tr style="border-bottom: 1px solid #999;">
                  <th style="text-align: left; padding: 4px;">Trade #</th>
                  <th style="text-align: left; padding: 4px;">Property address</th>
                  <th style="text-align: right; padding: 4px;">Gross</th>
                  <th style="text-align: right; padding: 4px;">Net payment</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding: 4px;">${escapeHtml(a.tradeNumber)}</td>
                  <td style="padding: 4px;">${escapeHtml(a.propertyAddress)}</td>
                  <td style="text-align: right; padding: 4px;">$${fmtMoney(tradeGrossForTable)}</td>
                  <td style="text-align: right; padding: 4px; font-weight: bold;">$${fmtMoney(a.netPay)}</td>
                </tr>
              </tbody>
            </table>
            <div style="font-weight: bold; margin-bottom: 0.06in;">EFT summary</div>
            <table style="width: 100%; max-width: 5.75in; font-size: 10px; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 1px solid #999;">
                  <th style="text-align: left; padding: 4px 4px 4px 0;">&nbsp;</th>
                  <th style="text-align: right; padding: 4px;">Amount</th>
                  <th style="text-align: right; padding: 4px;">YTD</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style="padding: 2px 0;">Gross Earnings</td><td style="text-align: right; padding: 2px 0;">$${fmtMoney(grossEarningsRow)}</td><td style="text-align: right; padding: 2px 0;">${ytdPlain(a.ytdGrossEarningsExHST)}</td></tr>
                <tr><td style="padding: 2px 0;">Office share Less</td><td style="text-align: right; padding: 2px 0;">${officeDisplay}</td><td style="text-align: right; padding: 2px 0;">${ytdOffice(a.ytdOfficeShareLess)}</td></tr>
                ${officeExpensesRow}
                ${commissionDeductionRow}
                ${rebateRow}
                <tr><td style="padding: 2px 0;">HST</td><td style="text-align: right; padding: 2px 0;">$${fmtMoney(a.hstOnAgentShare)}</td><td style="text-align: right; padding: 2px 0;">${ytdPlain(a.ytdHstOnAgentShare)}</td></tr>
                <tr style="font-weight: bold; border-top: 1px solid #999;"><td style="padding: 4px 0;">NET Pay</td><td style="text-align: right; padding: 4px 0;">$${fmtMoney(a.netPay)}</td><td style="text-align: right; padding: 4px 0;">${ytdPlain(a.ytdNetPay)}</td></tr>
              </tbody>
            </table>
          </div>`;
  };

  const buildPrintPreviewToolbarHtml = () => `
          <div class="preview-toolbar" role="toolbar" aria-label="Print preview actions">
            <span class="preview-toolbar-title">Print preview — EFT # ${eftNumber}</span>
            <div class="preview-toolbar-actions">
              <button type="button" onclick="window.print()">Print</button>
              <button type="button" class="preview-toolbar-close" onclick="window.close()">Close</button>
            </div>
          </div>`;

  const openPrintWindow = ({ previewToolbar }) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow pop-ups to print or preview the receipt.");
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>EFT Receipt - ${eftNumber}</title>
          <style>
            @media print {
              .preview-toolbar { display: none !important; }
              @page {
                margin: 0.5in;
                size: letter;
              }
              body {
                margin: 0;
                padding: 0;
                font-family: Arial, sans-serif;
                font-size: 12px;
                line-height: 1.2;
                background: white;
              }
              .receipt-container {
                width: 100%;
                max-width: 100%;
                margin: 0;
                padding: 0;
                page-break-after: avoid;
                page-break-before: avoid;
                page-break-inside: avoid;
                background: white;
              }
              .receipt-border {
                border: 2px solid #808080;
                padding: 0.4in;
                margin: 0;
                box-sizing: border-box;
                background: white;
                border-radius: 0;
              }
              .header-section {
                margin-bottom: 0.3in;
              }
              .logo {
                height: 0.8in;
                margin-right: 0.25in;
                display: inline-block;
              }
              .company-info {
                display: inline-block;
                vertical-align: top;
              }
              .company-name {
                font-size: 14px;
                font-weight: bold;
                margin-bottom: 0.05in;
                color: black;
              }
              .company-address {
                font-size: 10px;
                margin-bottom: 0.02in;
                color: black;
              }
              .eft-header {
                text-align: right;
                font-size: 12px;
                color: black;
              }
              .eft-number {
                font-weight: bold;
                margin-bottom: 0.05in;
                color: black;
              }
              .content-section {
                margin-bottom: 0.2in;
                font-size: 11px;
                color: black;
              }
              .label {
                font-weight: bold;
                display: inline-block;
                width: 0.8in;
                margin-right: 0.1in;
                color: black;
              }
              .main-section {
                border-top: 1px solid #808080;
                border-bottom: 1px solid #808080;
                padding: 0.25in 0;
                margin: 0.25in 0;
              }
              .amount-section {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 0.2in;
              }
              .amount-words {
                flex: 1;
                color: black;
              }
              .amount-right {
                text-align: right;
                min-width: 1.5in;
                color: black;
              }
              .order-section {
                display: flex;
                margin-top: 0.2in;
              }
              .order-labels {
                font-weight: bold;
                width: 0.8in;
                margin-right: 0.1in;
                color: black;
              }
              .order-content {
                flex: 1;
                color: black;
              }
              .no-print {
                display: none;
              }
              .pay-label {
                font-weight: bold;
                display: inline-block;
                width: 0.5in;
                margin-right: 0.08in;
              }
              .amount-asterisk {
                font-weight: bold;
              }
              .eft-payment-summary {
                margin-top: 0.2in;
                border: 1px solid #333;
                padding: 0.15in;
                font-size: 11px;
                color: black;
              }
            }
            @media screen {
              html {
                overflow-y: scroll;
                height: auto;
                -webkit-text-size-adjust: 100%;
              }
              .preview-toolbar {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 10000;
                background: #f3f4f6;
                border-bottom: 1px solid #d1d5db;
                padding: 12px 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 12px;
                font-family: Arial, sans-serif;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
              }
              .preview-toolbar-title {
                font-weight: 600;
                color: #111827;
              }
              .preview-toolbar-actions button {
                background: #2563eb;
                color: white;
                border: none;
                padding: 8px 18px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
              }
              .preview-toolbar-actions .preview-toolbar-close {
                background: #6b7280;
                margin-left: 8px;
              }
              body.preview-mode {
                background: #e5e7eb;
                padding: 16px;
                padding-top: 72px;
                margin: 0;
                box-sizing: border-box;
                overflow-x: hidden;
                overflow-y: auto;
                font-family: Arial, Helvetica, sans-serif;
              }
              .receipt-container {
                width: 100%;
                max-width: 8.5in;
                margin: 0 auto;
                padding: 24px 16px 32px;
                box-sizing: border-box;
              }
              .receipt-border {
                border: 2px solid #808080;
                padding: 28px 24px;
                background: white;
                box-sizing: border-box;
              }
              .logo {
                height: 80px;
                width: auto;
                max-width: 200px;
                object-fit: contain;
                margin-right: 16px;
                display: inline-block;
                vertical-align: top;
              }
              .receipt-header-row {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                flex-wrap: wrap;
                gap: 12px;
                margin-bottom: 12px;
              }
              .receipt-header-left {
                display: flex;
                align-items: flex-start;
                flex: 1 1 220px;
                min-width: 0;
              }
              .header-section {
                margin-bottom: 12px;
              }
              .company-name {
                font-size: 14px;
                font-weight: bold;
                margin-bottom: 4px;
                color: #000;
              }
              .company-address {
                font-size: 10px;
                margin-bottom: 2px;
                color: #000;
              }
              .eft-header {
                text-align: right;
                font-size: 12px;
                color: #000;
                flex: 0 0 auto;
                min-width: 120px;
              }
              .eft-number {
                font-weight: bold;
                margin-bottom: 4px;
              }
              .content-section {
                margin-bottom: 12px;
                font-size: 11px;
                color: #000;
              }
              .label {
                font-weight: bold;
                display: inline-block;
                width: 72px;
                margin-right: 8px;
                color: #000;
              }
              .main-section {
                border-top: 1px solid #808080;
                border-bottom: 1px solid #808080;
                padding: 16px 0;
                margin: 16px 0;
              }
              .amount-section {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 12px;
                flex-wrap: wrap;
                margin-bottom: 12px;
              }
              .amount-words {
                flex: 1 1 200px;
                min-width: 0;
                color: #000;
                font-size: 11px;
              }
              .amount-right {
                text-align: right;
                min-width: 120px;
                font-size: 11px;
                color: #000;
              }
              .order-section {
                display: flex;
                margin-top: 12px;
                gap: 8px;
              }
              .order-labels {
                font-weight: bold;
                width: 64px;
                flex-shrink: 0;
                font-size: 11px;
                color: #000;
              }
              .order-content {
                flex: 1;
                min-width: 0;
                font-size: 11px;
                color: #000;
                word-wrap: break-word;
              }
              .pay-label {
                font-weight: bold;
                display: inline-block;
                width: 40px;
                margin-right: 6px;
              }
              .amount-asterisk {
                font-weight: bold;
              }
              .eft-payment-summary {
                margin-top: 16px;
                border: 1px solid #333;
                padding: 12px;
                font-size: 11px;
                color: #000;
                box-sizing: border-box;
                max-width: 100%;
              }
            }
          </style>
        </head>
        <body class="${previewToolbar ? "preview-mode" : ""}">
          ${previewToolbar ? buildPrintPreviewToolbarHtml() : ""}
          <div class="receipt-container">
            <div class="receipt-border">
              <div class="header-section">
                <div class="receipt-header-row">
                  <div class="receipt-header-left">
                    <img src="${logo}" alt="365 Realty Brokerage Logo" class="logo" />
                    <div class="company-info">
                      <div class="company-name">${companyInfo.name}</div>
                      <div class="company-address">${
                        companyInfo.addressLine1
                      }</div>
                      <div class="company-address">${
                        companyInfo.addressLine2
                      }</div>
                      <div class="company-address">Phone: ${
                        companyInfo.phone
                      }</div>
                    </div>
                  </div>
                  <div class="eft-header">
                    <div class="eft-number">EFT # ${eftNumber}</div>
                    <div>Date: ${displayDate}</div>
                  </div>
                </div>
              </div>

              <div class="content-section">
                <div style="margin-bottom: 0.08in;"><span class="label">Paid To:</span>${getPaidToDisplay()}</div>
                ${
                  !hideTradeSellerBuyer
                    ? `
                  <div style="margin-bottom: 0.04in;"><span class="label">Trade:</span>${
                    trade || "N/A"
                  }</div>
                  <div style="margin-bottom: 0.04in;"><span class="label">${firstPartyLabel}:</span>${
                    seller || "N/A"
                  }</div>
                  <div style="margin-bottom: 0.1in;"><span class="label">${secondPartyLabel}:</span>${
                    buyer || "N/A"
                  }</div>
                `
                    : ""
                }
                <div style="margin-bottom: 0.04in;"><span class="label">Notes:</span>${
                  notes || "N/A"
                }</div>
                <div style="margin-bottom: 0.1in;"><span class="label">Amount:</span>$${amountNumber.toLocaleString(
                  "en-CA",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  },
                )}</div>
              </div>

              <div class="main-section">
                <div class="amount-section">
                  <div class="amount-words">
                    <span class="pay-label">PAY</span>${amountInWords}
                  </div>
                  <div class="amount-right">
                    <div>Date: ${displayDate}</div>
                    <div style="font-weight: bold; margin-top: 0.03in;">AMOUNT</div>
                    <div class="amount-asterisk">*$${amountNumber.toLocaleString(
                      "en-CA",
                      {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      },
                    )}*</div>
                  </div>
                </div>
                <div class="order-section">
                  <div class="order-labels">
                    <div style="margin-bottom: 0.04in;">TO THE</div>
                    <div style="margin-bottom: 0.04in;">ORDER</div>
                    <div style="margin-bottom: 0.04in;">OF</div>
                    <div style="margin-bottom: 0.04in;">NOTE</div>
                  </div>
                  <div class="order-content">
                    <div style="margin-bottom: 0.04in;">${payTo || "N/A"}</div>
                    <div style="margin-bottom: 0.04in;">${buildOrderLine()}</div>
                    <div style="margin-bottom: 0.04in;">${buildOfLine()}</div>
                    <div style="margin-bottom: 0.04in;">${note || "N/A"}</div>
                  </div>
                </div>
              </div>
            </div>
            ${buildAgentSummaryPrintHtml()}
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();

    if (previewToolbar) {
      return;
    }

    const runPrint = () => {
      try {
        printWindow.print();
        printWindow.close();
      } catch (e) {
        console.error(e);
      }
    };
    if (printWindow.document.readyState === "complete") {
      setTimeout(runPrint, 150);
    } else {
      printWindow.onload = () => setTimeout(runPrint, 150);
    }
  };

  const handlePrintPreview = () => {
    openPrintWindow({ previewToolbar: true });
  };

  const handlePrint = () => {
    openPrintWindow({ previewToolbar: false });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
      <div className="flex min-h-full justify-center items-start p-4 py-8">
        <div
          className="bg-white p-6 rounded-lg max-w-4xl w-full relative mx-auto"
          id="receipt-content"
        >
          <div className="border-2 border-gray-500 p-8 bg-white">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-start">
                <img
                  src={logo}
                  alt="365 Realty Brokerage Logo"
                  className="h-20 mr-6"
                />
                <div>
                  <h1 className="font-bold text-lg mb-1">{companyInfo.name}</h1>
                  <p className="text-sm mb-1">{companyInfo.addressLine1}</p>
                  <p className="text-sm mb-1">{companyInfo.addressLine2}</p>
                  <p className="text-sm">Phone: {companyInfo.phone}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-base mb-1">EFT # {eftNumber}</p>
                <p className="text-sm">Date: {displayDate}</p>
              </div>
            </div>

            <div className="mb-4 flex items-start">
              <span className="font-bold pr-2 w-24 flex-shrink-0">
                Paid To:
              </span>
              <div>
                <p className="my-0 font-semibold">{getPaidToDisplay()}</p>
              </div>
            </div>

            {!hideTradeSellerBuyer && (
              <>
                <div className="mb-1">
                  <span className="font-bold w-24 inline-block">Trade:</span>{" "}
                  {trade}
                </div>
                <div className="mb-1">
                  <span className="font-bold w-24 inline-block">
                    {firstPartyLabel}:
                  </span>{" "}
                  {seller}
                </div>
                <div className="mb-4">
                  <span className="font-bold w-24 inline-block">
                    {secondPartyLabel}:
                  </span>{" "}
                  {buyer}
                </div>
              </>
            )}

            <div className="mb-1">
              <span className="font-bold w-24 inline-block">Notes:</span>{" "}
              {notes}
            </div>
            <div className="mb-4">
              <span className="font-bold w-24 inline-block">Amount:</span> $
              {amountNumber.toLocaleString("en-CA", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>

            <div className="border-t border-b border-gray-400 py-6">
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-bold inline-block w-20">PAY</span>
                  <span>{amountInWords}</span>
                </div>
                <div className="text-right">
                  <p>Date: {displayDate}</p>
                  <p className="font-bold mt-1">AMOUNT</p>
                  <p className="font-bold">
                    *$
                    {amountNumber.toLocaleString("en-CA", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    *
                  </p>
                </div>
              </div>
              <div className="mt-4 flex">
                <div className="font-bold w-20 flex-shrink-0">
                  <p className="mb-1">TO THE</p>
                  <p className="mb-1">ORDER</p>
                  <p className="mb-1">OF</p>
                  <p className="mb-1">NOTE</p>
                </div>
                <div className="flex-1">
                  <p className="mb-1">{payTo}</p>
                  <p className="mb-1">{buildOrderLine()}</p>
                  <p className="mb-1">{buildOfLine()}</p>
                  <p className="mb-1">{note}</p>
                </div>
              </div>
            </div>
          </div>

          {eftAgentSummary && (
            <div className="mt-6 border border-gray-600 p-4 bg-gray-50 text-sm text-gray-900">
              <h3 className="font-bold text-base mb-3 text-gray-900">
                Payment summary
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 text-sm">
                <div>
                  <span className="font-semibold">Agent #:</span>{" "}
                  {eftAgentSummary.agentNumber || "—"}
                </div>
                <div>
                  <span className="font-semibold">Agent name:</span>{" "}
                  {eftAgentSummary.agentName || "—"}
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <table className="w-full text-sm border border-gray-400">
                    <thead className="bg-gray-200">
                      <tr>
                        <th className="text-left p-2 border-b border-gray-400 font-semibold">
                          Trade #
                        </th>
                        <th className="text-left p-2 border-b border-gray-400 font-semibold">
                          Property address
                        </th>
                        <th className="text-right p-2 border-b border-gray-400 font-semibold">
                          Gross
                        </th>
                        <th className="text-right p-2 border-b border-gray-400 font-semibold">
                          Net payment
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="p-2 border-b border-gray-200">
                          {eftAgentSummary.tradeNumber || "—"}
                        </td>
                        <td className="p-2 border-b border-gray-200">
                          {eftAgentSummary.propertyAddress || "—"}
                        </td>
                        <td className="p-2 border-b border-gray-200 text-right tabular-nums">
                          $
                          {fmtMoney(
                            eftAgentSummary.tradeCommissionExHST != null
                              ? eftAgentSummary.tradeCommissionExHST
                              : eftAgentSummary.grossEarningsExHST,
                          )}
                        </td>
                        <td className="p-2 border-b border-gray-200 text-right font-semibold tabular-nums">
                          ${fmtMoney(eftAgentSummary.netPay)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="font-bold mb-2">EFT summary</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-400 text-left">
                        <th className="py-1 pr-2 font-semibold">&nbsp;</th>
                        <th className="py-1 text-right font-semibold tabular-nums">
                          Amount
                        </th>
                        <th className="py-1 text-right font-semibold tabular-nums">
                          YTD
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="py-1 pr-2">Gross Earnings</td>
                        <td className="py-1 text-right tabular-nums">
                          ${fmtMoney(grossEarningsDisplay)}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {fmtYtdMoney(eftAgentSummary.ytdGrossEarningsExHST)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2">Office share Less</td>
                        <td className="py-1 text-right tabular-nums">
                          {Number(eftAgentSummary.officeShareLess) === 0
                            ? "$0.00"
                            : `-$${fmtMoney(Math.abs(Number(eftAgentSummary.officeShareLess)))}`}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {fmtYtdOffice(eftAgentSummary.ytdOfficeShareLess)}
                        </td>
                      </tr>
                      {(Number(eftAgentSummary.officeExpenses) > 0 ||
                        Number(eftAgentSummary.ytdOfficeExpenses) > 0) && (
                        <tr>
                          <td className="py-1 pr-2">Office expenses</td>
                          <td className="py-1 text-right tabular-nums">
                            {Number(eftAgentSummary.officeExpenses) === 0
                              ? "$0.00"
                              : `-$${fmtMoney(Math.abs(Number(eftAgentSummary.officeExpenses)))}`}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {fmtYtdOffice(eftAgentSummary.ytdOfficeExpenses)}
                          </td>
                        </tr>
                      )}
                      {(Number(eftAgentSummary.commissionDeduction) > 0 ||
                        Number(eftAgentSummary.ytdCommissionDeduction) > 0) && (
                        <tr>
                          <td className="py-1 pr-2">Commission deduction</td>
                          <td className="py-1 text-right tabular-nums">
                            {Number(eftAgentSummary.commissionDeduction) === 0
                              ? "$0.00"
                              : `-$${fmtMoney(Math.abs(Number(eftAgentSummary.commissionDeduction)))}`}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {fmtYtdOffice(
                              eftAgentSummary.ytdCommissionDeduction,
                            )}
                          </td>
                        </tr>
                      )}
                      {agentBuyerRebateAmt > 0 && (
                        <tr>
                          <td className="py-1 pr-2">Buyer rebate</td>
                          <td className="py-1 text-right tabular-nums">
                            {`-$${fmtMoney(agentBuyerRebateAmt)}`}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {fmtYtdOffice(eftAgentSummary.ytdBuyerRebate)}
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="py-1 pr-2">HST</td>
                        <td className="py-1 text-right tabular-nums">
                          ${fmtMoney(eftAgentSummary.hstOnAgentShare)}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {fmtYtdMoney(eftAgentSummary.ytdHstOnAgentShare)}
                        </td>
                      </tr>
                      <tr className="border-t border-gray-400 font-semibold">
                        <td className="py-2 pr-2">NET Pay</td>
                        <td className="py-2 text-right tabular-nums">
                          ${fmtMoney(eftAgentSummary.netPay)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {fmtYtdMoney(eftAgentSummary.ytdNetPay)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end flex-wrap gap-3 mt-6 no-print">
            <button
              type="button"
              onClick={handlePrintPreview}
              className="bg-slate-600 text-white py-2 px-6 rounded-md hover:bg-slate-700"
            >
              Print preview
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700"
            >
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-red-500 text-white py-2 px-6 rounded-md hover:bg-red-600"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EFTReceipt;
