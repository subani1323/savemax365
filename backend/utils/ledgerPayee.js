/** Extract original EFT number from reversal reference REV-1234. */
function extractSourceEftFromRevRef(eftNumber) {
  const raw = String(eftNumber || "").trim();
  const revMatch = /^REV-(\d+)$/i.exec(raw);
  return revMatch ? revMatch[1] : null;
}

/** Payee name from ledger / reversal description text. */
function payeeFromLedgerDescription(description) {
  const text = String(description || "").trim();
  if (!text) return null;
  const received = text.match(/Received\s+From:\s*(.+?)(?:\s*-\s*|$)/i);
  if (received) return received[1].trim();
  const receivedLower = text.match(/Received\s+from:\s*(.+?)(?:\s*-\s*|$)/i);
  if (receivedLower) return receivedLower[1].trim();
  const paidTo = text.match(/Paid\s+to:\s*(.+?)(?:\s*-\s*|$)/i);
  if (paidTo) return paidTo[1].trim();
  const lastDash = text.lastIndexOf(" - ");
  if (lastDash > 0) {
    const tail = text.slice(lastDash + 3).trim();
    if (
      tail &&
      !/^EFT/i.test(tail) &&
      !/^Trade\s*#/i.test(tail) &&
      !/^Invoice\s*#/i.test(tail)
    ) {
      return tail;
    }
  }
  return null;
}

function payeeFromEftRecord(eftRecord, accountNumber) {
  if (!eftRecord) return null;
  if (accountNumber === "10004" && eftRecord.agentName) {
    return String(eftRecord.agentName).trim();
  }
  if (eftRecord.recipient) return String(eftRecord.recipient).trim();
  return null;
}

/**
 * Resolve payee for reconciliation / ledger display (including REV-* reversals).
 */
async function resolveLedgerEntryPayee(entry, accountNumber, eftRecord, models) {
  const { RealEstateTrustEFT, CommissionTrustEFT, GeneralAccountEFT } = models;

  const fromEft = payeeFromEftRecord(eftRecord, accountNumber);
  if (fromEft) return fromEft;

  const revSource = extractSourceEftFromRevRef(entry.eftNumber);
  if (revSource) {
    const num = Number(revSource);
    let orig = null;
    if (accountNumber === "10002") {
      orig = await RealEstateTrustEFT.findOne({
        eftNumber: Number.isFinite(num) ? num : revSource,
      });
    } else if (accountNumber === "10004") {
      orig = await CommissionTrustEFT.findOne({
        eftNumber: Number.isFinite(num) ? num : revSource,
      });
    } else if (accountNumber === "10001") {
      orig = await GeneralAccountEFT.findOne({
        eftNumber: Number.isFinite(num) ? num : revSource,
      });
    }
    const fromOrig = payeeFromEftRecord(orig, accountNumber);
    if (fromOrig) return fromOrig;
  }

  return payeeFromLedgerDescription(entry.description);
}

module.exports = {
  extractSourceEftFromRevRef,
  payeeFromLedgerDescription,
  payeeFromEftRecord,
  resolveLedgerEntryPayee,
};
