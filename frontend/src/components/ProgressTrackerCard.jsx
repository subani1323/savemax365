import React, { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "react-toastify";
import Select from "react-select";
import { FaTable } from "react-icons/fa";
import axiosInstance from "../config/axios";
import ProgressTrackerModal from "./ProgressTrackerModal";
import ProgressReportModal from "./ProgressReportModal";
import ProgressLoginModal, {
  isProgressAdminLoggedIn,
} from "./ProgressLoginModal";
import { enrichTradesWithProgressReportEftDates } from "../utils/progressReportEftDates";
import { mergeSavedTradesIntoList } from "../utils/progressReportSave";
import {
  compareBaseTradeNumberDesc,
  progressReportTradeLabel,
} from "../utils/progressReportUtils";

function tradeLabel(t) {
  return progressReportTradeLabel(t);
}

const tradeSelectStyles = {
  control: (base) => ({
    ...base,
    minHeight: "38px",
    fontSize: "0.875rem",
    borderColor: "#d1d5db",
    boxShadow: "none",
    "&:hover": { borderColor: "#1d4ed8" },
  }),
  menu: (base) => ({ ...base, fontSize: "0.875rem", zIndex: 20 }),
};

async function fetchProgressReportTrades() {
  const [tradesRes, ctRes, reRes, ledgerRes] = await Promise.all([
    axiosInstance.get("/trades"),
    axiosInstance.get("/commission-trust-eft"),
    axiosInstance.get("/real-estate-trust-eft"),
    axiosInstance.get("/ledger", {
      params: { from: "2000-01-01", to: "2099-12-31" },
    }),
  ]);
  const ledgerLines = ledgerRes.data || [];
  const ledger10004 = ledgerLines.filter(
    (line) => String(line.accountNumber) === "10004",
  );
  const ledger21500 = ledgerLines.filter(
    (line) => String(line.accountNumber) === "21500",
  );
  return enrichTradesWithProgressReportEftDates(
    tradesRes.data || [],
    ctRes.data || [],
    reRes.data || [],
    ledger10004,
    ledger21500,
  );
}

const ProgressTrackerCard = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(() => isProgressAdminLoggedIn());
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [listTrades, setListTrades] = useState([]);
  const [reportTrades, setReportTrades] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  const loadTrades = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await axiosInstance.get("/trades");
      setListTrades(res.data || []);
    } catch (e) {
      console.error(e);
      toast.error("Could not load trades for progress tracker.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) loadTrades();
  }, [loadTrades, isLoggedIn]);

  const tradeOptions = useMemo(
    () =>
      listTrades
        .map((t) => ({
          value: t._id,
          label: tradeLabel(t),
          sortKey: String(t.tradeNumber ?? t.keyInfo?.tradeNumber ?? "").trim(),
        }))
        .sort((a, b) => compareBaseTradeNumberDesc(a.sortKey, b.sortKey)),
    [listTrades],
  );

  const selectedTradeOption = useMemo(
    () => tradeOptions.find((o) => o.value === selectedId) || null,
    [tradeOptions, selectedId],
  );

  const handleTradeSelect = (option) => {
    const id = option?.value || "";
    setSelectedId(id);
    if (id) setModalOpen(true);
    else setModalOpen(false);
  };

  const handleOpenClick = () => {
    if (selectedId) setModalOpen(true);
  };

  const handleProgressReport = async () => {
    setReportLoading(true);
    try {
      const enriched = await fetchProgressReportTrades();
      setReportTrades(enriched);
      setReportModalOpen(true);
    } catch (e) {
      console.error(e);
      toast.error("Could not load trades for progress report.");
      setReportModalOpen(false);
    } finally {
      setReportLoading(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="xl:flex-1 bg-white rounded-lg shadow-md p-6 min-w-0 flex flex-col justify-center">
        <h2 className="text-2xl font-semibold mb-2 text-gray-700">
          Progress Tracker
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Progress Tracker and Progress Report require login.
        </p>
        <button
          type="button"
          onClick={() => setLoginModalOpen(true)}
          className="w-full py-2 rounded-md bg-blue-900 text-white text-sm font-medium hover:bg-blue-950"
        >
          Login
        </button>
        <ProgressLoginModal
          isOpen={loginModalOpen}
          onClose={() => setLoginModalOpen(false)}
          onSuccess={() => setIsLoggedIn(true)}
        />
      </div>
    );
  }

  return (
    <div className="xl:flex-1 bg-white rounded-lg shadow-md p-6 min-w-0 flex flex-col">
      <h2 className="text-2xl font-semibold mb-2 text-gray-700">
        Progress Tracker
      </h2>
      <p className="text-xs text-gray-500 mb-4">
        Select a trade to open the full checklist. Checklist and milestone dates
        save on the trade; finalized date and EFT dates still come from Trade
        Key Info and trust EFTs.
      </p>

      <label className="block text-sm font-medium text-gray-700 mb-1">
        Trade
      </label>
      <Select
        inputId="progress-tracker-trade-select"
        options={tradeOptions}
        value={selectedTradeOption}
        onChange={handleTradeSelect}
        isClearable
        isSearchable
        isDisabled={loadingList}
        placeholder="Search or select a trade…"
        noOptionsMessage={() => "No matching trades"}
        styles={tradeSelectStyles}
        className="mb-3"
        classNamePrefix="progress-tracker-trade"
      />

      {selectedId && !modalOpen && (
        <button
          type="button"
          onClick={handleOpenClick}
          className="w-full py-2 rounded-md bg-blue-900 text-white text-sm font-medium hover:bg-blue-950"
        >
          Open progress tracker
        </button>
      )}

      {!selectedId && !loadingList && (
        <p className="text-sm text-gray-500 mt-1">
          Choose a trade to view and edit the complete progress checklist.
        </p>
      )}

      <button
        type="button"
        onClick={handleProgressReport}
        disabled={loadingList}
        className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
      >
        <FaTable />
        Progress Report
      </button>

      <ProgressTrackerModal
        isOpen={modalOpen}
        tradeId={selectedId}
        onClose={() => setModalOpen(false)}
      />

      <ProgressReportModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        trades={reportTrades}
        loading={reportLoading}
        onTradesSaved={async (savedTrades) => {
          if (savedTrades?.length) {
            setReportTrades((prev) =>
              mergeSavedTradesIntoList(prev, savedTrades),
            );
            setListTrades((prev) => mergeSavedTradesIntoList(prev, savedTrades));
          }
        }}
      />
    </div>
  );
};

export default ProgressTrackerCard;
