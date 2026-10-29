/** Digits-only EFT number from "EFT#2384", "REV-2384", or plain "2384". */
export function extractEftDigits(refOrNumber) {
  const raw = String(refOrNumber ?? "").trim();
  if (!raw) return "";
  const rev = raw.match(/^REV-(\d+)$/i);
  if (rev) return rev[1];
  const eft = raw.match(/EFT#?\s*(\d+)/i);
  if (eft) return eft[1];
  const digits = raw.match(/(\d+)/);
  return digits ? digits[1] : "";
}

function appendBracketTag(payee, tag) {
  const base = String(payee || "").trim();
  if (!base) return `(${tag})`;
  if (new RegExp(`\\(${tag}\\)\\s*$`, "i").test(base)) return base;
  return `${base} (${tag})`;
}

function tradeIdKey(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    return String(value._id || value.id || "");
  }
  return String(value);
}

function sameCommissionSlot(a, b) {
  if (!a || !b) return false;
  if (tradeIdKey(a.tradeId) !== tradeIdKey(b.tradeId)) return false;
  if (String(a.type || "").toLowerCase() !== String(b.type || "").toLowerCase()) {
    return false;
  }
  const agentA = String(a.agentId || a.agentName || "").trim().toLowerCase();
  const agentB = String(b.agentId || b.agentName || "").trim().toLowerCase();
  if (agentA || agentB) return agentA === agentB;
  return true;
}

function amountsMatch(a, b) {
  const aa = Math.abs(Number(a) || 0);
  const bb = Math.abs(Number(b) || 0);
  if (aa === 0 && bb === 0) return true;
  return Math.abs(aa - bb) < 0.01;
}

/**
 * Build void→replacement pairs from EFT reversals and duplicate commission EFTs.
 * @returns {{ voidedBySource: Map<string, object>, replacementNumbers: Set<string> }}
 */
function buildVoidReplacementMaps(reversals, commissionEfts) {
  const eftByNumber = new Map();
  for (const eft of commissionEfts || []) {
    const n = extractEftDigits(eft.eftNumber);
    if (n) eftByNumber.set(n, eft);
  }

  const voidedBySource = new Map();
  for (const rev of reversals || []) {
    if (String(rev.section || "").toLowerCase() !== "commission") continue;
    const sourceNum = extractEftDigits(rev.sourceEftNumber);
    if (!sourceNum) continue;
    voidedBySource.set(sourceNum, rev);
  }

  const replacementNumbers = new Set();

  const markReplacementsForSource = (sourceNum, sourceEft, rev) => {
    if (!sourceEft) return;
    const sourceEftNum = Number(sourceEft.eftNumber) || 0;
    const sourceCreated = sourceEft.createdAt
      ? new Date(sourceEft.createdAt).getTime()
      : 0;
    const amt = Math.abs(Number(rev?.amount ?? sourceEft.amount) || 0);

    for (const cand of commissionEfts || []) {
      const candNum = extractEftDigits(cand.eftNumber);
      if (!candNum || candNum === sourceNum || voidedBySource.has(candNum)) {
        continue;
      }
      const candEftNum = Number(cand.eftNumber) || 0;
      if (candEftNum <= sourceEftNum) continue;

      const sameSlot = sameCommissionSlot(sourceEft, cand);
      const sameTrade = tradeIdKey(cand.tradeId) === tradeIdKey(sourceEft.tradeId);
      const sameAmt = amountsMatch(cand.amount, amt || sourceEft.amount);
      const candCreated = cand.createdAt
        ? new Date(cand.createdAt).getTime()
        : 0;
      const isLater =
        candEftNum > sourceEftNum ||
        (sourceCreated > 0 && candCreated > sourceCreated);

      if (isLater && (sameSlot || (sameTrade && sameAmt))) {
        replacementNumbers.add(candNum);
      }
    }
  };

  for (const [sourceNum, rev] of voidedBySource.entries()) {
    markReplacementsForSource(sourceNum, eftByNumber.get(sourceNum), rev);
  }

  // Fallback: duplicate same-slot commission EFTs (void checkbox + recreate)
  // when no EFTReversal exists yet — older = void, newer = replacement.
  // Include already-reversed sources in pairing so replacements still get marked,
  // but group by trade + agent (type can vary in casing).
  const groups = new Map();
  for (const eft of commissionEfts || []) {
    const n = extractEftDigits(eft.eftNumber);
    if (!n) continue;
    const key = [
      tradeIdKey(eft.tradeId),
      String(eft.agentId || eft.agentName || "")
        .trim()
        .toLowerCase(),
      String(eft.type || "").toLowerCase(),
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(eft);
  }

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) => (Number(a.eftNumber) || 0) - (Number(b.eftNumber) || 0),
    );
    // Keep only the highest EFT # for each amount within the slot; older same-amount = voided
    const newestByAmount = new Map();
    for (let i = sorted.length - 1; i >= 0; i--) {
      const eft = sorted[i];
      const amtKey = Math.abs(Number(eft.amount) || 0).toFixed(2);
      if (!newestByAmount.has(amtKey)) {
        newestByAmount.set(amtKey, extractEftDigits(eft.eftNumber));
      }
    }
    for (const eft of sorted) {
      const n = extractEftDigits(eft.eftNumber);
      if (!n) continue;
      const amtKey = Math.abs(Number(eft.amount) || 0).toFixed(2);
      const keeper = newestByAmount.get(amtKey);
      if (keeper && n !== keeper) {
        if (!voidedBySource.has(n)) {
          const newer = sorted.find(
            (e) => extractEftDigits(e.eftNumber) === keeper,
          );
          voidedBySource.set(n, {
            section: "commission",
            sourceEftNumber: n,
            amount: eft.amount,
            reversedAt:
              newer?.chequeDate ||
              newer?.date ||
              newer?.createdAt ||
              new Date(),
            _synthetic: true,
          });
        }
        if (keeper) replacementNumbers.add(keeper);
      }
    }
  }

  // Extra safety: same trade + same amount + same agent name, even if agentId differs
  const byTradeAmount = new Map();
  for (const eft of commissionEfts || []) {
    const n = extractEftDigits(eft.eftNumber);
    const tid = tradeIdKey(eft.tradeId);
    if (!n || !tid) continue;
    const agentLabel = String(eft.agentName || eft.agentId || "")
      .trim()
      .toLowerCase();
    const key = `${tid}|${Math.abs(Number(eft.amount) || 0).toFixed(2)}|${agentLabel}`;
    if (!byTradeAmount.has(key)) byTradeAmount.set(key, []);
    byTradeAmount.get(key).push(eft);
  }
  for (const list of byTradeAmount.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) => (Number(a.eftNumber) || 0) - (Number(b.eftNumber) || 0),
    );
    const newest = sorted[sorted.length - 1];
    const newestNum = extractEftDigits(newest.eftNumber);
    for (let i = 0; i < sorted.length - 1; i++) {
      const olderNum = extractEftDigits(sorted[i].eftNumber);
      if (!olderNum || !newestNum || olderNum === newestNum) continue;
      if (!voidedBySource.has(olderNum)) {
        voidedBySource.set(olderNum, {
          section: "commission",
          sourceEftNumber: olderNum,
          amount: sorted[i].amount,
          reversedAt:
            newest.chequeDate || newest.date || newest.createdAt || new Date(),
          _synthetic: true,
        });
      }
      replacementNumbers.add(newestNum);
    }
  }

  return { voidedBySource, replacementNumbers };
}

/**
 * For agent payment / summary reports: drop voided source EFTs so only the
 * replacement (and unrelated EFTs) remain. Does not alter disbursement journals.
 */
export function excludeVoidedCommissionTrustEfts(
  commissionEfts,
  reversals = [],
) {
  const list = Array.isArray(commissionEfts) ? commissionEfts : [];
  if (list.length === 0) return list;
  const { voidedBySource } = buildVoidReplacementMaps(reversals, list);
  if (voidedBySource.size === 0) return list;
  return list.filter((eft) => {
    const n = extractEftDigits(eft.eftNumber);
    return !n || !voidedBySource.has(n);
  });
}

/**
 * Annotate commission-trust disbursement rows for voided EFTs and their replacements.
 *
 * For each voided EFT:
 * 1) Original row — transaction date, original description/amount (no Void tag)
 * 2) Inserted row — void/reversal date, (Void), minus amount
 * 3) Later replacement EFT — (Replacement)
 */
export function applyCommissionTrustVoidReplacement(
  transactions,
  { reversals = [], commissionEfts = [], formatDate, fromDate, toDate } = {},
) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return transactions || [];
  }

  const { voidedBySource, replacementNumbers } = buildVoidReplacementMaps(
    reversals,
    commissionEfts,
  );
  if (voidedBySource.size === 0) return transactions;

  const inRange = (dateValue) => {
    if (!fromDate || !toDate || !dateValue) return true;
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return true;
    const start = new Date(fromDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    return d >= start && d <= end;
  };

  const format =
    typeof formatDate === "function"
      ? formatDate
      : (v) => {
          try {
            return new Date(v).toLocaleDateString("en-US");
          } catch {
            return String(v || "");
          }
        };

  const result = [];
  for (const row of transactions) {
    const eftNum = extractEftDigits(row.referenceNumber);
    const rev = eftNum ? voidedBySource.get(eftNum) : null;

    if (rev) {
      const absAmount = Math.abs(Number(row.amount) || 0);

      // 1) Original transaction date — keep description as-is (no Void tag)
      result.push({ ...row });

      // 2) Void-date row directly below — (Void), minus amount
      const voidDateRaw = rev.reversedAt || rev.chequeDate || rev.createdAt;
      if (voidDateRaw && inRange(voidDateRaw)) {
        result.push({
          ...row,
          payee: appendBracketTag(row.payee, "Void"),
          date: format(voidDateRaw),
          referenceNumber: row.referenceNumber,
          amount: -absAmount,
          reversed: "",
          isVoidDateRow: true,
        });
      }
      continue;
    }

    if (eftNum && replacementNumbers.has(eftNum)) {
      result.push({
        ...row,
        payee: appendBracketTag(row.payee, "Replacement"),
      });
      continue;
    }

    result.push(row);
  }

  return result;
}
