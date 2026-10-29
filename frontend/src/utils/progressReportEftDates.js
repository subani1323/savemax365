/** Shared logic for Progress Report commission-received / agent-payment dates from EFTs. */

function canonicalEftType(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function parseEftDateToMs(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.getTime();
  }
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(
      parseInt(iso[1], 10),
      parseInt(iso[2], 10) - 1,
      parseInt(iso[3], 10),
    );
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const d = new Date(
      parseInt(slash[3], 10),
      parseInt(slash[1], 10) - 1,
      parseInt(slash[2], 10),
    );
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function eftIssueMs(e) {
  return parseEftDateToMs(e?.chequeDate ?? e?.date);
}

function msToYmd(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function setMinMs(map, key, ms) {
  if (ms == null || !key) return;
  const prev = map.get(key);
  if (prev === undefined || ms < prev) map.set(key, ms);
}

function setMaxMs(map, key, ms) {
  if (ms == null || !key) return;
  const prev = map.get(key);
  if (prev === undefined || ms > prev) map.set(key, ms);
}

function normalizeTradeId(id) {
  if (id == null) return null;
  const s = String(id).trim();
  return /^[a-f0-9]{24}$/i.test(s) ? s : null;
}

function buildTradeIdByNumber(trades) {
  const map = new Map();
  for (const t of trades || []) {
    const tid = normalizeTradeId(t._id);
    if (!tid) continue;
    const candidates = new Set([t.tradeNumber, t.keyInfo?.tradeNumber]);
    for (const raw of candidates) {
      const tn = String(raw ?? "").trim();
      if (!tn) continue;
      map.set(tn.toLowerCase(), tid);
    }
  }
  return map;
}

function tradeIdFromTradeNumber(tradeIdByNumber, tradeNumber) {
  const tn = String(tradeNumber ?? "").trim();
  if (!tn) return null;
  return tradeIdByNumber.get(tn.toLowerCase()) || null;
}

/** Resolve trade _id from EFT tradeId ref, populated trade, or description. */
function resolveEftTradeId(e, tradeIdByNumber) {
  const raw = e?.tradeId;
  if (raw && typeof raw === "object") {
    const fromObjectId = normalizeTradeId(raw._id ?? raw.id);
    if (fromObjectId) return fromObjectId;
  }
  if (raw != null) {
    const fromRaw = normalizeTradeId(raw);
    if (fromRaw) return fromRaw;
  }
  const populatedTn =
    raw?.tradeNumber ?? raw?.keyInfo?.tradeNumber ?? e?.tradeNumber;
  const fromPopulated = tradeIdFromTradeNumber(tradeIdByNumber, populatedTn);
  if (fromPopulated) return fromPopulated;
  const fromDesc = tradeNumberFromLedgerDescription(e.description);
  return tradeIdFromTradeNumber(tradeIdByNumber, fromDesc);
}

function isCtPayoutEft(e) {
  const t = canonicalEftType(e?.type);
  return (
    t === "agentcommissiontransfer" ||
    t === "outsidebrokercommission" ||
    t === "ourbrokeragecommission" ||
    t === "builderrepayment" ||
    t === "refundofdeposit"
  );
}

export { isCtPayoutEft };

/** Match trade detail / print logic for commission received on commission trust. */
export function isCommissionReceivedCtEft(e) {
  if (!e || isCtPayoutEft(e)) return false;
  const amt = parseFloat(e.amount ?? 0);
  if (!Number.isFinite(amt) || amt <= 0) return false;
  const t = canonicalEftType(e.type);
  const d = String(e.description || "").toLowerCase();
  if (t === "commissionreceived" || t === "commissiontransfer") return true;
  if (t === "generaltocommissiontransfer") {
    return (
      d.includes("commission received") ||
      d.includes("received from") ||
      d.includes("from general")
    );
  }
  if (d.includes("commission received")) return true;
  if (d.includes("received from") && !d.includes("paid to")) return true;
  return false;
}

function roundMoney2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * True when commission trust has received commission and payouts (agent + office +
 * outside broker, etc.) cover that received amount in full.
 * Example: received $1,299.50, paid agent $1,130 + office $169.50 → fully paid out.
 */
export function isTradeCommissionFullyPaidOut(commissionTrustEftsForTrade) {
  const efts = (commissionTrustEftsForTrade || []).filter((e) => !e?.reversed);
  let received = 0;
  let paidOut = 0;

  for (const e of efts) {
    const amt = roundMoney2(e.amount);
    if (amt <= 0) continue;
    if (isCommissionReceivedCtEft(e)) {
      received = roundMoney2(received + amt);
    } else if (isCtPayoutEft(e)) {
      paidOut = roundMoney2(paidOut + amt);
    }
  }

  return received > 0 && paidOut + 0.005 >= received;
}

/**
 * Build Map<tradeId string, eft[]> from all commission-trust EFTs.
 */
export function groupCommissionTrustEftsByTradeId(commissionTrustEfts) {
  const byTrade = new Map();
  for (const e of commissionTrustEfts || []) {
    if (!e || e.reversed) continue;
    const raw = e.tradeId;
    const tid =
      raw && typeof raw === "object"
        ? String(raw._id || raw.id || "").trim()
        : String(raw || "").trim();
    if (!tid) continue;
    if (!byTrade.has(tid)) byTrade.set(tid, []);
    byTrade.get(tid).push(e);
  }
  return byTrade;
}

function tradeNumberFromLedgerDescription(desc) {
  const m = String(desc || "").match(/Trade\s*#:?\s*([^,]+)/i);
  return m ? String(m[1]).trim() : "";
}

function tradeIdForLedgerLine(line, tradeIdByNumber) {
  const tn = tradeNumberFromLedgerDescription(line.description);
  if (tn) {
    const id = tradeIdByNumber.get(tn.toLowerCase());
    if (id) return id;
  }
  const desc = String(line.description || "").toLowerCase();
  for (const [tnKey, tid] of tradeIdByNumber) {
    if (
      desc.includes(`trade #: ${tnKey}`) ||
      desc.includes(`trade #:${tnKey}`) ||
      desc.includes(`trade #${tnKey}`)
    ) {
      return tid;
    }
  }
  return null;
}

function isLedgerCommissionReceived(line) {
  const desc = String(line.description || "").toLowerCase();
  if (
    !desc.includes("received from") &&
    !desc.includes("commission received")
  ) {
    return false;
  }
  const debit = parseFloat(line.debit ?? 0);
  return Number.isFinite(debit) && debit > 0;
}

function isLedgerAgentPayment(line) {
  const desc = String(line.description || "").toLowerCase();
  if (!desc.includes("paid to")) return false;
  const debit = parseFloat(line.debit ?? 0);
  return Number.isFinite(debit) && debit > 0;
}

function tradeIdForLedgerLineAgent(line, tradeIdByNumber) {
  const fromField = tradeIdFromTradeNumber(tradeIdByNumber, line.tradeNumber);
  if (fromField) return fromField;
  return tradeIdForLedgerLine(line, tradeIdByNumber);
}

function buildCommissionTrustEftByNumber(commissionTrustEfts, tradeIdByNumber) {
  const byNumber = new Map();
  for (const e of commissionTrustEfts || []) {
    if (e.reversed) continue;
    const num = String(e.eftNumber ?? "").trim();
    const tid = resolveEftTradeId(e, tradeIdByNumber);
    if (!num || !tid) continue;
    byNumber.set(num, {
      tid,
      type: e.type,
      ms: eftIssueMs(e),
    });
  }
  return byNumber;
}

function applyOutsideBrokerPaymentFromEftNumber(
  line,
  ctEftByNumber,
  outsideBrokerPayMs,
) {
  const eftNum = String(line.eftNumber ?? "").trim();
  if (!eftNum) return false;
  const meta = ctEftByNumber.get(eftNum);
  if (!meta || canonicalEftType(meta.type) !== "outsidebrokercommission") {
    return false;
  }
  const ms = parseEftDateToMs(line.chequeDate ?? line.date) ?? meta.ms ?? null;
  if (ms == null) return false;
  setMaxMs(outsideBrokerPayMs, meta.tid, ms);
  return true;
}

function applyAgentPaymentFromEftNumber(line, ctEftByNumber, agentPayMs) {
  const eftNum = String(line.eftNumber ?? "").trim();
  if (!eftNum) return false;
  const meta = ctEftByNumber.get(eftNum);
  if (!meta || canonicalEftType(meta.type) !== "agentcommissiontransfer") {
    return false;
  }
  const ms = parseEftDateToMs(line.chequeDate ?? line.date) ?? meta.ms ?? null;
  if (ms == null) return false;
  setMaxMs(agentPayMs, meta.tid, ms);
  return true;
}

/**
 * Merge paymentReceivedEftDateIso / paymentToAgentsEftDateIso onto trade objects.
 */
export function enrichTradesWithProgressReportEftDates(
  trades,
  commissionTrustEfts = [],
  realEstateTrustEfts = [],
  ledgerLines10004 = [],
  ledgerLines21500 = [],
) {
  const tradeIdByNumber = buildTradeIdByNumber(trades);
  const ctEftByNumber = buildCommissionTrustEftByNumber(
    commissionTrustEfts,
    tradeIdByNumber,
  );

  const receivedMs = new Map();
  const agentPayMs = new Map();
  const outsideBrokerPayMs = new Map();

  for (const e of commissionTrustEfts || []) {
    if (e.reversed) continue;
    const tid = resolveEftTradeId(e, tradeIdByNumber);
    if (!tid) continue;
    const ms = eftIssueMs(e);
    if (ms == null) continue;
    const eftType = canonicalEftType(e.type);
    if (eftType === "agentcommissiontransfer") {
      setMaxMs(agentPayMs, tid, ms);
    } else if (eftType === "outsidebrokercommission") {
      setMaxMs(outsideBrokerPayMs, tid, ms);
    } else if (isCommissionReceivedCtEft(e)) {
      setMinMs(receivedMs, tid, ms);
    }
  }

  for (const e of realEstateTrustEfts || []) {
    if (canonicalEftType(e.type) !== "commissiontransfer") continue;
    const tid = resolveEftTradeId(e, tradeIdByNumber);
    if (!tid) continue;
    const ms = eftIssueMs(e);
    if (ms == null) continue;
    const amt = parseFloat(e.amount ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    setMinMs(receivedMs, tid, ms);
  }

  for (const line of ledgerLines10004 || []) {
    if (applyAgentPaymentFromEftNumber(line, ctEftByNumber, agentPayMs)) {
      continue;
    }
    if (
      applyOutsideBrokerPaymentFromEftNumber(
        line,
        ctEftByNumber,
        outsideBrokerPayMs,
      )
    ) {
      continue;
    }
    if (!isLedgerCommissionReceived(line)) continue;
    const tid = tradeIdForLedgerLine(line, tradeIdByNumber);
    if (!tid) continue;
    const ms = parseEftDateToMs(line.chequeDate ?? line.date);
    if (ms == null) continue;
    setMinMs(receivedMs, tid, ms);
  }

  for (const line of ledgerLines21500 || []) {
    if (applyAgentPaymentFromEftNumber(line, ctEftByNumber, agentPayMs)) {
      continue;
    }
    if (!isLedgerAgentPayment(line)) continue;
    const tid = tradeIdForLedgerLineAgent(line, tradeIdByNumber);
    if (!tid) continue;
    const ms = parseEftDateToMs(line.chequeDate ?? line.date);
    if (ms == null) continue;
    setMaxMs(agentPayMs, tid, ms);
  }

  return (trades || []).map((trade) => {
    const tid = String(trade._id);
    const rMs = receivedMs.get(tid);
    const aMs = agentPayMs.get(tid);
    const obMs = outsideBrokerPayMs.get(tid);
    return {
      ...trade,
      paymentReceivedEftDateIso:
        rMs != null
          ? msToYmd(rMs)
          : String(trade.paymentReceivedEftDateIso || "").trim(),
      paymentToAgentsEftDateIso:
        aMs != null
          ? msToYmd(aMs)
          : String(trade.paymentToAgentsEftDateIso || "").trim(),
      outsideBrokerPayEftDateIso:
        obMs != null
          ? msToYmd(obMs)
          : String(trade.outsideBrokerPayEftDateIso || "").trim(),
    };
  });
}
