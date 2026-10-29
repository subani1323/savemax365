import React, { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import axiosInstance from "../config/axios";
import {
  formatCurrency,
  formatDate,
  getEFTTypeDisplayName,
} from "../utils/eftUtils";
import { buildProgressReportTradeFilterOptions } from "../utils/progressReportUtils";
import {
  buildDisplayCommissionTrustEfts,
  excludeSeparateTrustActivityEfts,
  filterLedgerEntriesForTrade,
} from "../utils/tradePaymentDetailsDisplay";

const selectStyles = {
  control: (base) => ({
    ...base,
    minHeight: "38px",
    fontSize: "0.875rem",
    borderColor: "#d1d5db",
    boxShadow: "none",
    "&:hover": { borderColor: "#1d4ed8" },
  }),
  menu: (base) => ({ ...base, fontSize: "0.875rem", zIndex: 90 }),
  menuPortal: (base) => ({ ...base, zIndex: 90 }),
};

function EftTypeTable({ efts, emptyMessage }) {
  if (!efts?.length) {
    return <div className="text-gray-500 text-sm">{emptyMessage}</div>;
  }
  return (
    <table className="min-w-full border border-gray-300 mb-2 text-sm">
      <thead>
        <tr>
          <th className="px-2 py-1 text-left bg-gray-100 border">EFT #</th>
          <th className="px-2 py-1 text-left bg-gray-100 border">Date</th>
          <th className="px-2 py-1 text-left bg-gray-100 border">Amount</th>
          <th className="px-2 py-1 text-left bg-gray-100 border">Recipient</th>
          <th className="px-2 py-1 text-left bg-gray-100 border">Type</th>
          <th className="px-2 py-1 text-left bg-gray-100 border">
            Description
          </th>
        </tr>
      </thead>
      <tbody>
        {efts.map((eft) => (
          <tr key={eft._id || eft.eftNumber}>
            <td className="border px-2 py-1">{eft.eftNumber}</td>
            <td className="border px-2 py-1">
              {eft.chequeDate || eft.date
                ? formatDate(eft.chequeDate || eft.date)
                : "-"}
            </td>
            <td className="border px-2 py-1">{formatCurrency(eft.amount)}</td>
            <td className="border px-2 py-1">{eft.recipient}</td>
            <td className="border px-2 py-1">
              {getEFTTypeDisplayName(eft.type)}
            </td>
            <td className="border px-2 py-1">{eft.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EftActivityTable({ efts, emptyMessage }) {
  if (!efts?.length) {
    return <div className="text-gray-500 text-sm">{emptyMessage}</div>;
  }
  return (
    <table className="min-w-full table-fixed border text-sm mb-2">
      <colgroup>
        <col style={{ width: "8%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "11%" }} />
        <col style={{ width: "24%" }} />
        <col style={{ width: "45%" }} />
      </colgroup>
      <thead>
        <tr className="bg-gray-100">
          <th className="border px-2 py-1">EFT #</th>
          <th className="border px-2 py-1 whitespace-nowrap">Date</th>
          <th className="border px-2 py-1">Amount</th>
          <th className="border px-2 py-1">Recipient</th>
          <th className="border px-2 py-1">Description</th>
        </tr>
      </thead>
      <tbody>
        {efts.map((eft, idx) => (
          <tr key={eft._id || eft.eftNumber || idx}>
            <td className="border px-2 py-1">{eft.eftNumber || ""}</td>
            <td className="border px-2 py-1 whitespace-nowrap">
              {eft.chequeDate || eft.date
                ? formatDate(eft.chequeDate || eft.date)
                : "-"}
            </td>
            <td className="border px-2 py-1">
              {formatCurrency(eft.amount || "")}
            </td>
            <td className="border px-2 py-1">
              {eft.recipient || eft.agentName || ""}
            </td>
            <td className="border px-2 py-1 break-words">
              {eft.description || ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CommissionRecallTable({ recalls, emptyMessage }) {
  if (!recalls?.length) {
    return <div className="text-gray-500 text-sm">{emptyMessage}</div>;
  }
  return (
    <table className="min-w-full table-fixed border text-sm mb-2">
      <colgroup>
        <col style={{ width: "12%" }} />
        <col style={{ width: "18%" }} />
        <col style={{ width: "11%" }} />
        <col style={{ width: "14%" }} />
        <col style={{ width: "45%" }} />
      </colgroup>
      <thead>
        <tr className="bg-gray-100">
          <th className="border px-2 py-1 whitespace-nowrap">Date</th>
          <th className="border px-2 py-1">Agent</th>
          <th className="border px-2 py-1">Amount</th>
          <th className="border px-2 py-1">Reference</th>
          <th className="border px-2 py-1">Description</th>
        </tr>
      </thead>
      <tbody>
        {recalls.map((recall, idx) => (
          <tr key={recall._id || recall.recallRef || idx}>
            <td className="border px-2 py-1 whitespace-nowrap">
              {recall.recalledAt ? formatDate(recall.recalledAt) : "-"}
            </td>
            <td className="border px-2 py-1">{recall.agentName || ""}</td>
            <td className="border px-2 py-1">
              {formatCurrency(recall.amount || "")}
            </td>
            <td className="border px-2 py-1">{recall.recallRef || ""}</td>
            <td className="border px-2 py-1 break-words">
              {recall.description || recall.notes || ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ProgressReportCommissionDetailsModal = ({
  isOpen,
  onClose,
  trades,
  initialTradeNumber = "",
}) => {
  const [selectedTradeNumber, setSelectedTradeNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [realEstateTrustEfts, setRealEstateTrustEfts] = useState([]);
  const [allCommissionTrustEfts, setAllCommissionTrustEfts] = useState([]);
  const [commissionTrustEfts, setCommissionTrustEfts] = useState([]);
  const [commissionRecalls, setCommissionRecalls] = useState([]);
  const [ledgerEntries, setLedgerEntries] = useState([]);

  const tradeOptions = useMemo(
    () => buildProgressReportTradeFilterOptions(trades),
    [trades],
  );

  const selectedTrade = useMemo(() => {
    const tn = String(selectedTradeNumber || "").trim();
    if (!tn) return null;
    return (trades || []).find(
      (t) =>
        String(t.tradeNumber ?? t.keyInfo?.tradeNumber ?? "").trim() === tn,
    );
  }, [trades, selectedTradeNumber]);

  const selectedTradeOption = useMemo(
    () => tradeOptions.find((o) => o.value === selectedTradeNumber) || null,
    [tradeOptions, selectedTradeNumber],
  );

  const displayCommissionTrustEfts = useMemo(() => {
    if (!selectedTrade) return [];
    return buildDisplayCommissionTrustEfts(
      selectedTrade,
      realEstateTrustEfts,
      commissionTrustEfts,
      ledgerEntries,
    );
  }, [selectedTrade, realEstateTrustEfts, commissionTrustEfts, ledgerEntries]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedTradeNumber("");
      setRealEstateTrustEfts([]);
      setAllCommissionTrustEfts([]);
      setCommissionTrustEfts([]);
      setCommissionRecalls([]);
      setLedgerEntries([]);
      return;
    }
    if (initialTradeNumber) {
      setSelectedTradeNumber(String(initialTradeNumber).trim());
    }
  }, [isOpen, initialTradeNumber]);

  useEffect(() => {
    if (!isOpen || !selectedTrade?._id) {
      setRealEstateTrustEfts([]);
      setAllCommissionTrustEfts([]);
      setCommissionTrustEfts([]);
      setCommissionRecalls([]);
      setLedgerEntries([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      axiosInstance.get(`/real-estate-trust-eft/trade/${selectedTrade._id}`),
      axiosInstance.get(`/commission-trust-eft/trade/${selectedTrade._id}`),
      axiosInstance.get(`/commission-recalls?tradeId=${selectedTrade._id}`),
      axiosInstance.get("/ledger"),
    ])
      .then(([reRes, ctRes, recallRes, ledgerRes]) => {
        if (cancelled) return;
        const allCt = ctRes.data || [];
        setRealEstateTrustEfts(reRes.data || []);
        setAllCommissionTrustEfts(allCt);
        setCommissionTrustEfts(excludeSeparateTrustActivityEfts(allCt));
        setCommissionRecalls(recallRes.data || []);
        setLedgerEntries(
          filterLedgerEntriesForTrade(ledgerRes.data || [], selectedTrade),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setRealEstateTrustEfts([]);
        setAllCommissionTrustEfts([]);
        setCommissionTrustEfts([]);
        setCommissionRecalls([]);
        setLedgerEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedTrade]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 bg-black/50"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-report-commission-details-title"
        className="bg-white rounded-xl shadow-2xl w-full max-w-[min(96vw,900px)] max-h-[min(92vh,900px)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2
              id="progress-report-commission-details-title"
              className="text-lg font-bold text-gray-900"
            >
              Commission Details
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Select a trade to view trust and commission payment activity.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 shrink-0">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Trade
          </label>
          <Select
            inputId="progress-report-commission-trade-select"
            options={tradeOptions}
            value={selectedTradeOption}
            onChange={(opt) => setSelectedTradeNumber(opt?.value || "")}
            isClearable
            isSearchable
            placeholder="Search or type trade # or address…"
            noOptionsMessage={() => "No matching trades"}
            styles={selectStyles}
            className="text-sm"
            classNamePrefix="progress-report-commission-trade"
            menuPortalTarget={
              typeof document !== "undefined" ? document.body : null
            }
            menuPosition="fixed"
          />
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 min-h-0">
          {!selectedTrade ? (
            <p className="text-sm text-gray-500 py-12 text-center">
              Select a trade to view payment details.
            </p>
          ) : loading ? (
            <p className="text-sm text-gray-500 py-12 text-center">Loading…</p>
          ) : (
            <>
              <div className="mb-6">
                <h3 className="font-semibold text-lg mb-2">
                  Real Estate Trust Payments
                </h3>
                <EftTypeTable
                  efts={realEstateTrustEfts}
                  emptyMessage="No Real Estate Trust Payments found for this trade."
                />
              </div>

              <div className="mb-6">
                <h3 className="font-semibold text-lg mb-2">
                  Commission Trust Activity
                </h3>
                <EftTypeTable
                  efts={displayCommissionTrustEfts}
                  emptyMessage="No Commission Trust Activity found for this trade."
                />
              </div>

              <div className="mb-6">
                <h3 className="font-semibold text-lg mb-2">
                  Commission Recalled
                </h3>
                <CommissionRecallTable
                  recalls={commissionRecalls}
                  emptyMessage="No commission recalls recorded for this trade."
                />
              </div>

              <div className="mb-6">
                <h3 className="font-semibold text-lg mb-2">
                  Builder Repayment (Payment to Builder)
                </h3>
                <EftActivityTable
                  efts={allCommissionTrustEfts.filter(
                    (eft) => eft.type === "BuilderRepayment",
                  )}
                  emptyMessage="No builder repayments recorded for this trade."
                />
              </div>

              <div className="mb-6">
                <h3 className="font-semibold text-lg mb-2">
                  General to Commission Transfer
                </h3>
                <EftActivityTable
                  efts={allCommissionTrustEfts.filter(
                    (eft) => eft.type === "GeneralToCommissionTransfer",
                  )}
                  emptyMessage="No general to commission transfers recorded for this trade."
                />
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 shrink-0 flex justify-end bg-gray-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProgressReportCommissionDetailsModal;
