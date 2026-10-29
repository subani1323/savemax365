/**
 * Trust / Commission ledger reports for reconciliation screens.
 *
 * G/L #10002 (Real Estate Trust): Uses buyer trustRecords + real-estate-trust EFTs. Only trades whose first
 * trust row has We Hold = Yes. Report 1/2 rules in buildReconciliationLedgerSections apply only to 10002.
 *
 * G/L #10004 (Commission Trust — Reconcile Commission Trust): **As-of the report To date**, lists trades with
 * commission **received** on or before that date (CommissionReceived EFT and/or G/L incoming) and **no** agent/office
 * payout EFT **on or before** that date. Includes pre-construction / co-op deals that received commission but never
 * ran “Finalize Trade” (uses first commission-in date when finalize is missing). Payouts after the report To date
 * do not exclude the trade. All rows go to Report 1; Report 2 is empty.
 *
 * 10002 inclusion: (1) At least one deposit-line dated within the selected From–To period, or (2) not finalized
 * by the end of the selected period, with prior-period lines (backlog — Report 1 only).
 * 10002 Report 2: finalized, no account EFT in the month of finalization, activity in selected period only.
 */

function parseYMDLocal(dateStr) {
    if (!dateStr) return null;
    if (typeof dateStr === "string" && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
      return new Date(y, m - 1, d);
    }
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  
  function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }
  
  function startOfCalendarMonth(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), 1);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  
  function endOfCalendarMonth(d) {
    const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    x.setHours(23, 59, 59, 999);
    return x;
  }
  
  /** True if any EFT payment date falls in the same calendar month as anchor (e.g. finalized date). */
  function hasEftInSameCalendarMonthAs(efts, anchorDate) {
    if (!anchorDate || Number.isNaN(anchorDate.getTime())) return false;
    const ms = startOfCalendarMonth(anchorDate);
    const me = endOfCalendarMonth(anchorDate);
    return (efts || []).some((eft) => {
      const ed = eftPaymentDate(eft);
      return ed && !Number.isNaN(ed.getTime()) && ed >= ms && ed <= me;
    });
  }
  
  function sameCalendarMonth(a, b) {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }
  
  function trustRecordDepositDate(record) {
    return parseYMDLocal(record.depositDate || record.date);
  }
  
  /** YYYY-MM-DD in local calendar (stable; avoids duplicate-looking en-CA output). */
  function formatCalendarDateYMD(d) {
    if (!d || Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  
  /** One label per calendar day, sorted (multiple trust lines or commission EFTs same day → single date). */
  function depositDatesLabelFromRows(rows) {
    const dates = (rows || [])
      .map((r) => trustRecordDepositDate(r))
      .filter((d) => d && !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b);
    const seen = new Set();
    const labels = [];
    for (const d of dates) {
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(formatCalendarDateYMD(d));
    }
    return labels.join("; ");
  }
  
  function trustDepositAmount(record) {
    const n = parseFloat(
      record.amount ?? record.depositAmount ?? record.total ?? 0,
    );
    return Number.isNaN(n) ? 0 : n;
  }
  
  /** Cheque/issue date for EFTs; supports YYYY-MM-DD, MM/DD/YYYY, Date, ISO, and createdAt fallback. */
  function eftPaymentDate(eft) {
    if (!eft) return null;
    const raw = eft.chequeDate ?? eft.date;
    let d = parseYMDLocal(raw);
    if (d && !Number.isNaN(d.getTime())) return d;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    if (typeof raw === "string" && raw.trim()) {
      const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const mm = parseInt(m[1], 10);
        const day = parseInt(m[2], 10);
        const yyyy = parseInt(m[3], 10);
        return new Date(yyyy, mm - 1, day);
      }
      const tryD = new Date(raw);
      if (!Number.isNaN(tryD.getTime())) return tryD;
    }
    if (eft.createdAt) {
      const c = new Date(eft.createdAt);
      if (!Number.isNaN(c.getTime())) return c;
    }
    return null;
  }
  
  /** All issue dates for this trade's EFTs (any period), sorted; multiple same-day collapsed. */
  function formatEftIssuedDates(efts) {
    const dates = (efts || [])
      .map((e) => eftPaymentDate(e))
      .filter((d) => d && !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b);
    const seen = new Set();
    const labels = [];
    for (const d of dates) {
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(d.toLocaleDateString("en-CA"));
    }
    return labels.length ? labels.join("; ") : "-";
  }
  
  /** Dates for CommissionReceived (incoming) EFTs only — not outside broker / agent payouts. */
  function formatIncomingCommissionEftIssuedDates(efts) {
    const incoming = (efts || []).filter(
      (e) => e && COMMISSION_INCOMING_EFT_TYPES.has(e.type),
    );
    return formatEftIssuedDates(incoming);
  }
  
  function getFinalizedDate(trade) {
    const s = trade.keyInfo?.finalizedDate || trade.finalizedDate || "";
    let d = parseYMDLocal(s);
    if (d && !Number.isNaN(d.getTime())) return d;
    if (trade.isFinalized && trade.keyInfo?.closeDate) {
      d = parseYMDLocal(trade.keyInfo.closeDate);
      if (d && !Number.isNaN(d.getTime())) return d;
    }
    return null;
  }
  
  /** Earliest commission-in date from EFT rows (already filtered) or G/L rows. */
  function firstCommissionIncomingDate(incomingEftByEnd, ledgerIncoming) {
    const dates = [];
    for (const e of incomingEftByEnd || []) {
      const d = eftPaymentDate(e);
      if (d && !Number.isNaN(d.getTime())) dates.push(d);
    }
    for (const r of ledgerIncoming || []) {
      const d = ledgerLinePaymentDate({ date: r.dateRaw });
      if (d && !Number.isNaN(d.getTime())) dates.push(d);
    }
    if (dates.length === 0) return null;
    return new Date(Math.min(...dates.map((x) => x.getTime())));
  }
  
  /**
   * Date used for "as-of" and period notes. Pre-construction / co-op deals often have commission in
   * without Trade Finalize (isFinalized / keyInfo.finalizedDate) — use first commission-in or close/firm.
   */
  function getCommissionLedgerReferenceDate(
    trade,
    incomingEftByEnd,
    ledgerIncoming,
  ) {
    const fd = getFinalizedDate(trade);
    if (fd && !Number.isNaN(fd.getTime())) return fd;
  
    const firstIn = firstCommissionIncomingDate(incomingEftByEnd, ledgerIncoming);
    if (firstIn && !Number.isNaN(firstIn.getTime())) return firstIn;
  
    for (const raw of [
      trade.keyInfo?.closeDate,
      trade.keyInfo?.firmDate,
      trade.keyInfo?.offerDate,
    ]) {
      const d = parseYMDLocal(raw);
      if (d && !Number.isNaN(d.getTime())) return d;
    }
    return null;
  }
  
  function tradeAddressLine(trade) {
    const kn = trade.keyInfo || {};
    const street = `${kn.streetNumber || ""} ${kn.streetName || ""}`.trim();
    const city = kn.city || "";
    const parts = [street, city].filter(Boolean);
    return parts.join(", ") || "-";
  }
  
  function tradeNumberDisplay(trade) {
    return trade.keyInfo?.tradeNumber ?? trade.tradeNumber ?? "-";
  }
  
  /** Trust form / TradeFinalizeModal: We Hold on first trust record. Excludes co-op deposits held elsewhere. */
  function isWeHoldYes(trade) {
    const records = trade.trustRecords || [];
    const v = records[0]?.weHold;
    if (v === true) return true;
    if (typeof v === "string" && v.toLowerCase() === "yes") return true;
    return false;
  }
  
  /**
   * Money into commission trust.
   * Outside-broker POST uses type OutsideBrokerCommission + Cr 10004 in the ledger; finalize uses CommissionReceived + Dr 10004.
   */
  const COMMISSION_INCOMING_EFT_TYPES = new Set([
    "CommissionReceived",
    "OutsideBrokerCommission",
  ]);
  
  /**
   * Payouts that mean "internal side" is done for this report.
   * Outside broker cheques are excluded from this set so co-op–paid deals still appear while agents await payment.
   * (Outside-broker-only exclusion was hiding most co-op trades that match the report intent.)
   */
  const COMMISSION_PAYOUT_EFT_TYPES = new Set([
    "AgentCommissionTransfer",
    "OurBrokerageCommission",
  ]);
  
  function hasCommissionIncomingEfts(efts) {
    return (efts || []).some((e) => {
      if (!COMMISSION_INCOMING_EFT_TYPES.has(e.type)) return false;
      const n = parseFloat(e.amount ?? 0);
      if (n <= 0) return false;
      const dd = eftPaymentDate(e);
      return !!(dd && !Number.isNaN(dd.getTime()));
    });
  }
  
  /**
   * Agent/office payout issue date for this report: **chequeDate / date only** (no createdAt).
   * Avoids excluding a trade from January when a payout row was saved in January but the cheque is dated February
   * (e.g. 218-A vs 218-B lots). If cheque/issue is missing, the payout does not count as “before period end.”
   */
  function commissionPayoutChequeOrIssueDateOnly(eft) {
    if (!eft) return null;
    const stub = { chequeDate: eft.chequeDate, date: eft.date };
    const raw = stub.chequeDate ?? stub.date;
    if (raw == null || (typeof raw === "string" && String(raw).trim() === "")) {
      return null;
    }
    return eftPaymentDate(stub);
  }
  
  /**
   * True if an agent/office payout exists with **cheque/issue date** on or before report `rangeEnd`.
   * Feb-dated payouts do not match a Jan 31 end date — trade stays listed (e.g. 218-A with commission in Jan, payouts later).
   */
  function hasCommissionPayoutOnOrBefore(efts, rangeEnd) {
    return (efts || []).some((e) => {
      if (!e || !COMMISSION_PAYOUT_EFT_TYPES.has(e.type)) return false;
      const dd = commissionPayoutChequeOrIssueDateOnly(e);
      if (!dd || Number.isNaN(dd.getTime())) return false;
      return dd <= rangeEnd;
    });
  }
  
  /** CommissionReceived lines with a dated deposit on or before period end. */
  function filterCommissionIncomingEftsOnOrBefore(efts, rangeEnd) {
    return (efts || []).filter((e) => {
      if (!COMMISSION_INCOMING_EFT_TYPES.has(e.type)) return false;
      const n = parseFloat(e.amount ?? 0);
      if (n <= 0) return false;
      const dd = eftPaymentDate(e);
      return !!(dd && !Number.isNaN(dd.getTime()) && dd <= rangeEnd);
    });
  }
  
  function syntheticIncomingRowsFromEfts(efts) {
    return (efts || [])
      .filter((e) => {
        if (!COMMISSION_INCOMING_EFT_TYPES.has(e.type)) return false;
        const n = parseFloat(e.amount ?? 0);
        if (n <= 0) return false;
        const dd = eftPaymentDate(e);
        return !!(dd && !Number.isNaN(dd.getTime()));
      })
      .map((e) => {
        const dd = eftPaymentDate(e);
        return {
          depositDate: dd
            ? formatCalendarDateYMD(dd)
            : e.chequeDate || e.date || e.createdAt,
          amount: e.amount,
        };
      });
  }
  
  function incomingCommissionEftInRange(efts, rangeStart, rangeEnd) {
    return (efts || []).some((e) => {
      if (!COMMISSION_INCOMING_EFT_TYPES.has(e.type)) return false;
      const dd = eftPaymentDate(e);
      return (
        dd && !Number.isNaN(dd.getTime()) && dd >= rangeStart && dd <= rangeEnd
      );
    });
  }
  
  /**
   * Transformed /ledger/account/10004 lines: money into commission trust (Dr or Cr — outside-broker flow credits 10004).
   */
  function isLedgerFinalizeCommissionIncoming(line) {
    if (!line) return false;
    const acct = line.accountNumber || line.debitAccount;
    if (String(acct) !== "10004") return false;
    if (line.type !== "Debit" && line.type !== "Credit") return false;
    const amt = parseFloat(line.amount);
    if (!Number.isFinite(amt) || amt <= 0) return false;
    const desc = line.description || "";
    if (/Received From:/i.test(desc)) return true;
    if (/Trade #:/i.test(desc) && /Commission Trust/i.test(desc)) return true;
    return false;
  }
  
  function ledgerLinePaymentDate(line) {
    const raw = line.date;
    let d = parseYMDLocal(raw);
    if (!d || Number.isNaN(d.getTime())) {
      if (raw instanceof Date) d = raw;
      else if (typeof raw === "string") d = new Date(raw);
    }
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }
  
  function incomingLedgerInRange(ledgerRows, rangeStart, rangeEnd) {
    return (ledgerRows || []).some((r) => {
      const d = ledgerLinePaymentDate(r);
      return d && d >= rangeStart && d <= rangeEnd;
    });
  }
  
  /** Compare keyInfo/root trade numbers across number vs string (319 vs "319"). */
  function tradeNumbersLooselyEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return String(a).trim() === String(b).trim();
  }
  
  function ledgerLinesToIncomingByTradeId(allTrades, ledgerLines) {
    const map = new Map();
    for (const line of ledgerLines || []) {
      if (!isLedgerFinalizeCommissionIncoming(line)) continue;
      const rawTid = line.tradeId?._id || line.tradeId;
      let tid = rawTid ? String(rawTid) : null;
      if (!tid) {
        const tn = line.tradeNumber;
        if (tn == null || (typeof tn === "string" && tn.trim() === "")) continue;
        const trade = allTrades.find((t) =>
          tradeNumbersLooselyEqual(tradeNumberDisplay(t), tn),
        );
        if (!trade) continue;
        tid = String(trade._id);
      }
      if (!map.has(tid)) map.set(tid, []);
      map.get(tid).push({
        amount: parseFloat(line.amount) || 0,
        dateRaw: line.date,
      });
    }
    return map;
  }
  
  function formatLedgerIncomingDates(ledgerRows) {
    const dates = (ledgerRows || [])
      .map((r) => ledgerLinePaymentDate(r))
      .filter((d) => d && !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b);
    const seen = new Set();
    const labels = [];
    for (const d of dates) {
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(d.toLocaleDateString("en-CA"));
    }
    return labels.length ? labels.join("; ") : "-";
  }
  
  /**
   * Commission ledger: commission in + no agent/office payout by report end. Finalize Trade optional if commission in exists.
   * @returns {{ section1: object[], section2: object[] }}
   */
  function buildCommissionLedgerReconcileSections(
    allTrades,
    eftsByTradeId,
    rangeStart,
    rangeEnd,
    ledgerLines10004,
  ) {
    const section1 = [];
    const ledgerIncomingByTradeId = ledgerLinesToIncomingByTradeId(
      allTrades,
      ledgerLines10004 || [],
    );
  
    (allTrades || []).forEach((trade) => {
      const tid = String(trade._id);
      const tradeEfts = eftsByTradeId.get(tid) || [];
      const ledgerIncomingAll = ledgerIncomingByTradeId.get(tid) || [];
      const ledgerIncoming = ledgerIncomingAll.filter((r) => {
        const d = ledgerLinePaymentDate({ date: r.dateRaw });
        return d && !Number.isNaN(d.getTime()) && d <= rangeEnd;
      });
  
      const incomingEftByEnd = filterCommissionIncomingEftsOnOrBefore(
        tradeEfts,
        rangeEnd,
      );
      const hasEftIncoming = incomingEftByEnd.length > 0;
      const hasLedgerIncoming = ledgerIncoming.length > 0;
  
      if (!hasEftIncoming && !hasLedgerIncoming) return;
  
      // Outstanding for this report: no Agent/OurBrokerage payout with issue/cheque date on or before the report To date.
      // (Payouts dated after the selected period — e.g. February — do not remove the trade from a January run.)
      if (hasCommissionPayoutOnOrBefore(tradeEfts, rangeEnd)) return;
  
      const referenceDate = getCommissionLedgerReferenceDate(
        trade,
        incomingEftByEnd,
        ledgerIncoming,
      );
      if (!referenceDate || Number.isNaN(referenceDate.getTime())) return;
      // Do not drop a trade because keyInfo.finalizedDate is after the report period while commission was already in
      // before period end (e.g. 214: commission in 2025, payouts Feb 2026, finalize line Feb 2026 — still belongs on Jan report).
  
      const finalizedDate = getFinalizedDate(trade);
      const hasAppFinalizedDate =
        !!finalizedDate && !Number.isNaN(finalizedDate.getTime());
      const anchorForPeriod = hasAppFinalizedDate ? finalizedDate : referenceDate;
  
      const finalizedInRange =
        anchorForPeriod >= rangeStart && anchorForPeriod <= rangeEnd;
      const incomingEftInRange = incomingCommissionEftInRange(
        tradeEfts,
        rangeStart,
        rangeEnd,
      );
      const incomingLedgerInRng = incomingLedgerInRange(
        ledgerIncomingAll,
        rangeStart,
        rangeEnd,
      );
      const inPeriod =
        finalizedInRange || incomingEftInRange || incomingLedgerInRng;
  
      let incomingRows = [];
      if (hasEftIncoming) {
        incomingRows = syntheticIncomingRowsFromEfts(incomingEftByEnd);
      } else {
        incomingRows = ledgerIncoming.map((r) => ({
          depositDate: r.dateRaw,
          amount: r.amount,
        }));
      }
      if (incomingRows.length === 0) return;
  
      const depositTotal = incomingRows.reduce(
        (s, r) => s + trustDepositAmount(r),
        0,
      );
      const depositDatesLabel = depositDatesLabelFromRows(incomingRows);
  
      const eftIssuedDates = tradeEfts.length
        ? formatIncomingCommissionEftIssuedDates(incomingEftByEnd)
        : formatLedgerIncomingDates(ledgerIncoming);
  
      const finalizeNote = hasAppFinalizedDate
        ? "Finalize recorded"
        : "Commission in (pre-construction / not finalized in app)";
      const baseReason = hasEftIncoming
        ? `${finalizeNote}; commission received by report date; no agent/office payout EFT on or before report end`
        : `${finalizeNote}; commission received (G/L) by report date; no agent/office payout EFT on or before report end`;
      const reason = inPeriod
        ? baseReason
        : `${baseReason} (activity outside selected From–To window)`;
  
      const finalizedColumnLabel = hasAppFinalizedDate
        ? finalizedDate.toLocaleDateString("en-CA")
        : `${referenceDate.toLocaleDateString("en-CA")} *`;
  
      section1.push({
        tradeId: trade._id,
        tradeNumber: tradeNumberDisplay(trade),
        address: tradeAddressLine(trade),
        depositDates: depositDatesLabel,
        depositTotal,
        finalizedDate: finalizedColumnLabel,
        eftIssuedDates,
        reason,
      });
    });
  
    return { section1, section2: [] };
  }
  
  /**
   * @param {object[]} allTrades
   * @param {object[]} allEfts - Real Estate or Commission trust EFTs (must include tradeId)
   * @param {string} fromDateStr - YYYY-MM-DD
   * @param {string} toDateStr - YYYY-MM-DD
   * @param {{ ledgerAccount?: '10002' | '10004'; ledgerLines10004?: object[]; realEstateEfts?: object[] }} [options] -
   *   10004: ledgerLines10004 = transformed 10004 rows; realEstateEfts = RE trust EFTs (CommissionTransfer → incoming).
   * @returns {{ section1: object[], section2: object[] }}
   */
  export function buildReconciliationLedgerSections(
    allTrades,
    allEfts,
    fromDateStr,
    toDateStr,
    options = {},
  ) {
    const ledgerAccount = options.ledgerAccount || "10002";
    const rangeStart = startOfDay(
      parseYMDLocal(fromDateStr) || new Date(fromDateStr),
    );
    const rangeEnd = endOfDay(parseYMDLocal(toDateStr) || new Date(toDateStr));
  
    const eftsByTradeId = new Map();
    (allEfts || []).forEach((e) => {
      const tid = e.tradeId?._id || e.tradeId;
      if (!tid) return;
      const key = String(tid);
      if (!eftsByTradeId.has(key)) eftsByTradeId.set(key, []);
      eftsByTradeId.get(key).push(e);
    });
  
    if (ledgerAccount === "10004" && options.realEstateEfts?.length) {
      (options.realEstateEfts || []).forEach((e) => {
        if (!e || e.type !== "CommissionTransfer") return;
        const tid = e.tradeId?._id || e.tradeId;
        if (!tid) return;
        const key = String(tid);
        const list = eftsByTradeId.get(key) || [];
        if (hasCommissionIncomingEfts(list)) return;
        const n = parseFloat(e.amount ?? 0);
        if (n <= 0) return;
        let dd = eftPaymentDate(e);
        if (!dd || Number.isNaN(dd.getTime())) {
          dd = e.createdAt ? new Date(e.createdAt) : null;
        }
        if (!dd || Number.isNaN(dd.getTime())) return;
        if (!eftsByTradeId.has(key)) eftsByTradeId.set(key, []);
        eftsByTradeId.get(key).push({
          ...e,
          type: "CommissionReceived",
          _syntheticFromReTrustTransfer: true,
        });
      });
    }
  
    if (ledgerAccount === "10004") {
      return buildCommissionLedgerReconcileSections(
        allTrades,
        eftsByTradeId,
        rangeStart,
        rangeEnd,
        options.ledgerLines10004,
      );
    }
  
    const section1 = [];
    const section2 = [];
  
    /** Deposit-like rows: trust form rows (10002) only. */
    function positiveDepositsForTrade(trade) {
      if (!isWeHoldYes(trade)) return [];
      const records = trade.trustRecords || [];
      return records.filter((r) => {
        if (trustDepositAmount(r) <= 0) return false;
        const dd = trustRecordDepositDate(r);
        return dd && !Number.isNaN(dd.getTime());
      });
    }
  
    (allTrades || []).forEach((trade) => {
      const positiveDeposits = positiveDepositsForTrade(trade);
      if (positiveDeposits.length === 0) return;
  
      const depositsInRange = positiveDeposits.filter((r) => {
        const dd = trustRecordDepositDate(r);
        return dd >= rangeStart && dd <= rangeEnd;
      });
  
      const finalizedDate = getFinalizedDate(trade);
      const isFinalized = !!(trade.isFinalized || finalizedDate);
      const finalizedDateValid =
        finalizedDate && !Number.isNaN(finalizedDate.getTime());
      /** Still open at end of selected From–To (e.g. Feb report: finalized March 9 counts as not finalized for Feb). */
      const notFinalizedByEndOfReportPeriod = finalizedDateValid
        ? finalizedDate > rangeEnd
        : !isFinalized;
  
      if (depositsInRange.length === 0) {
        // Report 1 only: trust received before this window, and not squared by end of period (or finalized later).
        if (notFinalizedByEndOfReportPeriod) {
          const priorDeposits = positiveDeposits.filter((r) => {
            const dd = trustRecordDepositDate(r);
            return dd && !Number.isNaN(dd.getTime()) && dd < rangeStart;
          });
          if (priorDeposits.length > 0) {
            const tidPrior = String(trade._id);
            const tradeEftsPrior = eftsByTradeId.get(tidPrior) || [];
            const depositTotalPrior = priorDeposits.reduce(
              (s, r) => s + trustDepositAmount(r),
              0,
            );
            const depositDatesPrior = depositDatesLabelFromRows(priorDeposits);
            const finalizedAfterPeriodEnd =
              finalizedDateValid && finalizedDate > rangeEnd;
            section1.push({
              tradeId: trade._id,
              tradeNumber: tradeNumberDisplay(trade),
              address: tradeAddressLine(trade),
              depositDates: depositDatesPrior,
              depositTotal: depositTotalPrior,
              finalizedDate: finalizedAfterPeriodEnd
                ? finalizedDate.toLocaleDateString("en-CA")
                : "-",
              eftIssuedDates: formatEftIssuedDates(tradeEftsPrior),
              reason: finalizedAfterPeriodEnd
                ? "Trust deposit before report period; finalized after selected period"
                : "Not finalized (trust deposit before report period)",
            });
          }
        }
        return;
      }
  
      const depositsForRow = depositsInRange;
  
      const tid = String(trade._id);
      const tradeEfts = eftsByTradeId.get(tid) || [];
      // Section 2: block only if an EFT exists in the finalized month — not the report period.
      const hasEftInFinalizedMonth =
        finalizedDate && !Number.isNaN(finalizedDate.getTime())
          ? hasEftInSameCalendarMonthAs(tradeEfts, finalizedDate)
          : tradeEfts.some((eft) => {
              const ed = eftPaymentDate(eft);
              return (
                ed &&
                !Number.isNaN(ed.getTime()) &&
                ed >= rangeStart &&
                ed <= rangeEnd
              );
            });
  
      const hasTrustDepositSameMonthAsFinalized =
        finalizedDate &&
        !Number.isNaN(finalizedDate.getTime()) &&
        depositsForRow.some((r) => {
          const dd = trustRecordDepositDate(r);
          return dd && sameCalendarMonth(dd, finalizedDate);
        });
  
      // Fully squared in one month: trust deposit month = finalized month + trust EFT that month → omit both reports.
      if (
        isFinalized &&
        finalizedDate &&
        hasEftInFinalizedMonth &&
        hasTrustDepositSameMonthAsFinalized
      ) {
        return;
      }
  
      const depositTotal = depositsForRow.reduce(
        (s, r) => s + trustDepositAmount(r),
        0,
      );
      const depositDatesLabel = depositDatesLabelFromRows(depositsForRow);
  
      const baseRow = {
        tradeId: trade._id,
        tradeNumber: tradeNumberDisplay(trade),
        address: tradeAddressLine(trade),
        depositDates: depositDatesLabel,
        depositTotal,
        finalizedDate: finalizedDate
          ? finalizedDate.toLocaleDateString("en-CA")
          : "-",
        eftIssuedDates: formatEftIssuedDates(tradeEfts),
      };
  
      // Report 2: finalized, no account EFT in the month of finalization (activity already in selected period).
      const qualifiesSection2 =
        isFinalized && finalizedDate && !hasEftInFinalizedMonth;
  
      if (qualifiesSection2) {
        section2.push({
          ...baseRow,
          reason: "Finalized; no trust EFT in finalized month",
        });
        return;
      }
  
      const inSection1 =
        !isFinalized ||
        hasEftInFinalizedMonth ||
        depositsForRow.some((r) => {
          const dd = trustRecordDepositDate(r);
          if (!dd) return true;
          if (!finalizedDate) return true;
          return !sameCalendarMonth(finalizedDate, dd);
        });
  
      if (inSection1) {
        let reason = "Not finalized";
        if (isFinalized && finalizedDate) {
          reason = hasEftInFinalizedMonth
            ? "Trust EFT dated in finalized month"
            : "Finalized in a different month than deposit";
        }
        section1.push({
          ...baseRow,
          reason,
        });
      }
    });
  
    return { section1, section2 };
  }
  