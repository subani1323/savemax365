const Ledger = require("../models/Ledger");
const EFTReversal = require("../models/EFTReversal");

/**
 * Ledger `date` (YYYY-MM-DD) + chequeDate for trial balance filters.
 * Uses the UTC calendar day of `d` so ISO timestamps from the client (e.g.
 * reversedAt) stay on the same posting day regardless of server timezone.
 */
const ledgerDateFieldsFromReversal = (d) => {
  const dt = d instanceof Date && !Number.isNaN(d.getTime()) ? new Date(d) : new Date();
  const y = dt.getUTCFullYear();
  const mo = dt.getUTCMonth();
  const da = dt.getUTCDate();
  const dateStr = `${y}-${String(mo + 1).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  const chequeDate = new Date(Date.UTC(y, mo, da, 12, 0, 0, 0));
  return { dateStr, chequeDate };
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Align Ledger chequeDate + date with EFTReversal.reversedAt for rows created
 * before ledger dates followed the reversal effective date.
 */
async function backfillEftReversalLedgerDates({ dryRun = false } = {}) {
  const reversals = await EFTReversal.find().lean();
  const summary = [];
  let ledgerRowsUpdated = 0;
  let ledgerRowsMatched = 0;

  for (const r of reversals) {
    const at = r.reversedAt || r.createdAt;
    const { dateStr, chequeDate } = ledgerDateFieldsFromReversal(new Date(at));
    const ref = `REV-${r.sourceEftNumber}`;
    const descPattern = new RegExp(
      `EFT reversal \\(${escapeRegex(r.section)}\\) for EFT#${escapeRegex(String(r.sourceEftNumber))}\\b`,
      "i",
    );
    const filter = { eftNumber: ref, description: descPattern };

    if (dryRun) {
      const matched = await Ledger.countDocuments(filter);
      ledgerRowsMatched += matched;
      summary.push({
        eftNumber: ref,
        section: r.section,
        reversedAt: at,
        ledgerDateStr: dateStr,
        matched,
      });
      continue;
    }

    const result = await Ledger.updateMany(filter, {
      $set: { chequeDate, date: dateStr },
    });
    ledgerRowsMatched += result.matchedCount;
    ledgerRowsUpdated += result.modifiedCount;
    summary.push({
      eftNumber: ref,
      section: r.section,
      reversedAt: at,
      ledgerDateStr: dateStr,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  }

  return {
    dryRun,
    reversalsProcessed: reversals.length,
    ledgerRowsMatched,
    ...(dryRun ? {} : { ledgerRowsUpdated }),
    summary,
  };
}

module.exports = {
  ledgerDateFieldsFromReversal,
  backfillEftReversalLedgerDates,
};
