import React, { useEffect, useMemo, useState } from "react";
import Navbar from "./Navbar";
import FinanceSidebar from "./FinanceSidebar";
import axiosInstance from "../config/axios";
import toast from "react-hot-toast";

const SECTION_OPTIONS = [
  { id: "real-estate", label: "Real Estate Trust" },
  { id: "commission", label: "Commission Trust" },
  { id: "general", label: "General Account" },
  {
    id: "deposit-received",
    label: "Commission Received from Builder / Brokerage",
  },
];

/** EFT column: show digits only (e.g. "EFT#4246" or "REV-4246" → "4246"). */
const displayEftNumber = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const revMatch = raw.match(/^REV-(\d+)$/i);
  if (revMatch) return revMatch[1];
  const eftMatch = raw.match(/^EFT#?\s*(\d+)$/i);
  if (eftMatch) return eftMatch[1];
  if (/^\d+$/.test(raw)) return raw;
  const digits = raw.match(/(\d+)/);
  return digits ? digits[1] : raw;
};

const EFTReversalPage = () => {
  const [section, setSection] = useState("real-estate");
  const [trades, setTrades] = useState([]);
  const [tradeSearch, setTradeSearch] = useState("");
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [generalInvoices, setGeneralInvoices] = useState([]);
  const [selectedInvoiceNumber, setSelectedInvoiceNumber] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [selectedEftNumber, setSelectedEftNumber] = useState("");
  const [finalizePreview, setFinalizePreview] = useState(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reversals, setReversals] = useState([]);
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [customReversalDate, setCustomReversalDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  useEffect(() => {
    const savedSection = sessionStorage.getItem("eftReversalSection");
    if (
      savedSection &&
      SECTION_OPTIONS.some((option) => option.id === savedSection)
    ) {
      setSection(savedSection);
    }

    const savedUseCustomDate =
      sessionStorage.getItem("eftReversalUseCustomDate") === "true";
    const savedCustomReversalDate = sessionStorage.getItem(
      "eftReversalCustomReversalDate",
    );
    setUseCustomDate(savedUseCustomDate);
    if (savedCustomReversalDate) setCustomReversalDate(savedCustomReversalDate);

    const savedTrade = sessionStorage.getItem("eftReversalSelectedTrade");
    if (savedTrade) {
      try {
        const parsed = JSON.parse(savedTrade);
        if (parsed?._id) {
          setSelectedTrade(parsed);
          const address = `${parsed.keyInfo?.streetNumber || ""} ${
            parsed.keyInfo?.streetName || ""
          } ${parsed.keyInfo?.unit || ""}`.trim();
          setTradeSearch(
            `${parsed.tradeNumber} - ${address || "No address"}`.trim(),
          );
        }
      } catch (_e) {}
    }
  }, []);

  useEffect(() => {
    const loadTrades = async () => {
      try {
        const res = await axiosInstance.get("/trades");
        setTrades(res.data || []);
      } catch (error) {
        toast.error("Could not load trades");
      }
    };
    loadTrades();
  }, []);

  const loadReversals = async (tradeId, currentSection) => {
    try {
      const params = { section: currentSection };
      if (tradeId) params.tradeId = tradeId;
      if (currentSection === "general" && selectedInvoiceNumber) {
        params.invoiceNumber = selectedInvoiceNumber;
      }
      const res = await axiosInstance.get("/eft-reversals", {
        params,
      });
      setReversals(res.data || []);
    } catch (_error) {
      setReversals([]);
    }
  };

  const filteredTrades = useMemo(() => {
    if (!tradeSearch.trim()) return trades.slice(0, 20);
    const q = tradeSearch.toLowerCase();
    return trades
      .filter((trade) => {
        const address = `${trade.keyInfo?.streetNumber || ""} ${
          trade.keyInfo?.streetName || ""
        } ${trade.keyInfo?.unit || ""}`.toLowerCase();
        return (
          String(trade.tradeNumber || "").includes(tradeSearch) ||
          address.includes(q)
        );
      })
      .slice(0, 20);
  }, [tradeSearch, trades]);

  const loadCandidates = async (tradeId, currentSection) => {
    setLoadingCandidates(true);
    setSelectedEftNumber("");
    try {
      let res;
      if (currentSection === "general") {
        res = await axiosInstance.get(
          `/eft-reversals/invoice-candidates/${encodeURIComponent(
            selectedInvoiceNumber,
          )}`,
        );
      } else if (currentSection === "deposit-received") {
        res = await axiosInstance.get(
          `/eft-reversals/finalize-transactions/${tradeId}`,
        );
        setFinalizePreview(res.data || null);
        setCandidates([]);
        return;
      } else {
        res = await axiosInstance.get(
          `/eft-reversals/trade-candidates/${currentSection}/${tradeId}`,
        );
      }
      setFinalizePreview(null);
      setCandidates(res.data || []);
    } catch (_error) {
      toast.error(
        currentSection === "deposit-received"
          ? "Could not load finalize transactions for this trade"
          : "Could not load EFT records for this trade",
      );
      setFinalizePreview(null);
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  };

  useEffect(() => {
    if (section === "general") {
      setSelectedTrade(null);
      setTradeSearch("");
      sessionStorage.removeItem("eftReversalSelectedTrade");
      if (selectedInvoiceNumber) {
        loadCandidates(null, section);
      } else {
        setCandidates([]);
        setSelectedEftNumber("");
      }
      loadReversals(null, section);
    } else {
      setSelectedInvoiceNumber("");
      if (selectedTrade?._id) {
        loadCandidates(selectedTrade._id, section);
        sessionStorage.setItem(
          "eftReversalSelectedTrade",
          JSON.stringify(selectedTrade),
        );
      } else {
        setCandidates([]);
        setFinalizePreview(null);
        setSelectedEftNumber("");
        sessionStorage.removeItem("eftReversalSelectedTrade");
      }
      loadReversals(selectedTrade?._id, section);
    }
    if (section !== "deposit-received") {
      setFinalizePreview(null);
    }
    sessionStorage.setItem("eftReversalSection", section);
  }, [section, selectedTrade?._id, selectedInvoiceNumber]);

  useEffect(() => {
    const loadGeneralInvoices = async () => {
      if (section !== "general") return;
      try {
        const res = await axiosInstance.get("/eft-reversals/general-invoices");
        setGeneralInvoices(res.data || []);
      } catch (_e) {
        setGeneralInvoices([]);
      }
    };
    loadGeneralInvoices();
  }, [section]);

  useEffect(() => {
    sessionStorage.setItem("eftReversalUseCustomDate", String(useCustomDate));
  }, [useCustomDate]);

  useEffect(() => {
    if (customReversalDate) {
      sessionStorage.setItem(
        "eftReversalCustomReversalDate",
        customReversalDate,
      );
    }
  }, [customReversalDate]);

  const selectedCandidate = candidates.find(
    (c) => String(c.eftNumber) === String(selectedEftNumber),
  );
  const finalizeLines = finalizePreview?.lines || [];
  const finalizeAlreadyReversed = Boolean(finalizePreview?.alreadyReversed);
  const canReverseDepositReceived =
    section === "deposit-received" &&
    selectedTrade?._id &&
    finalizeLines.length > 0 &&
    !finalizeAlreadyReversed;
  const canReverseOther =
    section !== "deposit-received" &&
    (section === "general"
      ? selectedInvoiceNumber && selectedCandidate
      : selectedTrade?._id && selectedCandidate);
  const sectionLabel =
    SECTION_OPTIONS.find((option) => option.id === section)?.label || section;

  const handleReverse = async () => {
    if (section === "general") {
      if (!selectedInvoiceNumber || !selectedCandidate) {
        toast.error("Please select an invoice # and EFT first");
        return;
      }
    } else if (section === "deposit-received") {
      if (!selectedTrade?._id) {
        toast.error("Please select a trade first");
        return;
      }
      if (finalizeAlreadyReversed) {
        toast.error("Finalize transactions for this trade are already reversed");
        return;
      }
      if (finalizeLines.length === 0) {
        toast.error("No finalize transaction lines found for this trade");
        return;
      }
    } else if (!selectedTrade?._id || !selectedCandidate) {
      toast.error("Please select a trade and EFT first");
      return;
    }
    setReversing(true);
    try {
      const reversalDateIso = useCustomDate
        ? new Date(`${customReversalDate}T00:00:00`).toISOString()
        : new Date().toISOString();
      let response;
      if (section === "general") {
        response = await axiosInstance.post("/eft-reversals/reverse", {
          section,
          invoiceNumber: selectedInvoiceNumber,
          sourceEftNumber: String(selectedCandidate.eftNumber),
          amount: Number(selectedCandidate.amount || 0),
          reversalDate: reversalDateIso,
        });
      } else if (section === "deposit-received") {
        response = await axiosInstance.post("/eft-reversals/reverse", {
          section,
          tradeId: selectedTrade._id,
          reversalDate: reversalDateIso,
        });
      } else {
        response = await axiosInstance.post("/eft-reversals/reverse", {
          section,
          tradeId: selectedTrade._id,
          sourceEftNumber: String(selectedCandidate.eftNumber),
          amount: Number(selectedCandidate.amount || 0),
          reversalDate: reversalDateIso,
        });
      }

      const lineCount = response?.data?.lineCount;
      const ledgerPosting = response?.data?.ledgerPosting;
      const commissionReversalMsg = ledgerPosting
        ? `EFT reversed successfully. Debit ${ledgerPosting.debitAccount} and Credit ${ledgerPosting.creditAccount} posted.`
        : "EFT reversed successfully.";
      toast.success(
        section === "real-estate"
          ? "EFT reversed successfully. Debit 10002 and Credit 21300 posted."
          : section === "commission"
            ? commissionReversalMsg
            : section === "deposit-received"
              ? `Finalize transactions reversed (${lineCount ?? finalizeLines.length} ledger lines).`
              : "EFT reversed successfully. Debit 10001 and Credit 21000 posted.",
      );
      if (section === "general") {
        await loadCandidates(null, section);
        await loadReversals(null, section);
      } else {
        await loadCandidates(selectedTrade._id, section);
        await loadReversals(selectedTrade._id, section);
      }
    } catch (error) {
      const message =
        error?.response?.data?.message || "Failed to reverse selected EFT";
      toast.error(message);
    } finally {
      setReversing(false);
    }
  };

  const handlePrint = () => {
    const rows = reversals
      .map((r) => {
        const description = r.description || "";
        const dateText = r.reversedAt
          ? new Date(r.reversedAt).toLocaleDateString()
          : "";
        const leftValue =
          section === "general" ? r.invoiceNumber || "" : r.tradeNumber || "";
        return `<tr>
          <td style="border:1px solid #ccc;padding:8px;">${leftValue}</td>
          <td style="border:1px solid #ccc;padding:8px;">${displayEftNumber(r.sourceEftNumber)}</td>
          <td style="border:1px solid #ccc;padding:8px;">${dateText}</td>
          <td style="border:1px solid #ccc;padding:8px;">${Number(r.amount || 0).toFixed(2)}</td>
          <td style="border:1px solid #ccc;padding:8px;">${description}</td>
        </tr>`;
      })
      .join("");

    const w = window.open("", "_blank", "width=1000,height=700");
    if (!w) return;
    w.document.write(`
      <html>
        <head><title>Reversed EFT Report</title></head>
        <body style="font-family:Arial,sans-serif;padding:24px;">
          <h2>Reversed EFT Report</h2>
          <p>${
            section === "general"
              ? `Invoice #${selectedInvoiceNumber || ""}`
              : `Trade #${selectedTrade?.tradeNumber || ""}`
          } | Section: ${sectionLabel}</p>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="border:1px solid #ccc;padding:8px;">${
                  section === "general" ? "Invoice #" : "Trade #"
                }</th>
                <th style="border:1px solid #ccc;padding:8px;">${
                  section === "deposit-received" ? "Ref" : "Original EFT #"
                }</th>
                <th style="border:1px solid #ccc;padding:8px;">Reversal Date</th>
                <th style="border:1px solid #ccc;padding:8px;">Amount</th>
                <th style="border:1px solid #ccc;padding:8px;">Description</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="5" style="border:1px solid #ccc;padding:8px;">No reversed EFTs.</td></tr>'}</tbody>
          </table>
        </body>
      </html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <Navbar />
      <div className="flex">
        <FinanceSidebar />
        <div className="flex-1 p-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">
              EFT Reversal
            </h2>

            <div className="flex gap-4 border-b pb-3 mb-5">
              {SECTION_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSection(option.id)}
                  className={`px-4 py-2 rounded ${
                    section === option.id
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {section === "general" ? (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Invoice #
                  </label>
                  <select
                    className="w-full rounded border-gray-300"
                    value={selectedInvoiceNumber}
                    onChange={(e) => setSelectedInvoiceNumber(e.target.value)}
                  >
                    <option value="">Select Invoice #...</option>
                    {generalInvoices.map((inv) => (
                      <option key={inv} value={inv}>
                        {inv}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1">Trade</label>
                  <input
                    value={tradeSearch}
                    onChange={(e) => {
                      setTradeSearch(e.target.value);
                      setSelectedTrade(null);
                    }}
                    placeholder="Search trade number or address..."
                    className="w-full rounded border-gray-300"
                  />
                  {!selectedTrade && filteredTrades.length > 0 && (
                    <div className="border rounded mt-1 max-h-44 overflow-auto">
                      {filteredTrades.map((trade) => {
                        const address = `${trade.keyInfo?.streetNumber || ""} ${
                          trade.keyInfo?.streetName || ""
                        } ${trade.keyInfo?.unit || ""}`.trim();
                        return (
                          <button
                            key={trade._id}
                            type="button"
                            onClick={() => {
                              setSelectedTrade(trade);
                              setTradeSearch(
                                `${trade.tradeNumber} - ${address || "No address"}`,
                              );
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-100 border-b"
                          >
                            Trade #{trade.tradeNumber} -{" "}
                            {address || "No address"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {section === "deposit-received" &&
                selectedTrade &&
                !loadingCandidates && (
                  <>
                    {finalizeAlreadyReversed && (
                      <p className="text-sm text-amber-700">
                        Finalize transactions for this trade are already
                        reversed.
                      </p>
                    )}
                    {!finalizeAlreadyReversed && finalizeLines.length === 0 && (
                      <p className="text-sm text-gray-500">
                        No finalize transaction lines found on the ledger for
                        this trade.
                      </p>
                    )}
                  </>
                )}

              {section !== "deposit-received" && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    EFT To Reverse
                  </label>
                  <select
                    className="w-full rounded border-gray-300"
                    disabled={
                      (section === "general" && !selectedInvoiceNumber) ||
                      (section !== "general" && !selectedTrade) ||
                      loadingCandidates
                    }
                    value={selectedEftNumber}
                    onChange={(e) => setSelectedEftNumber(e.target.value)}
                  >
                    <option value="">Select EFT...</option>
                    {candidates.map((c) => {
                      const eftNum = displayEftNumber(c.eftNumber);
                      const label = `${eftNum} - $${Number(c.amount || 0).toFixed(2)} - ${c.recipient || "N/A"}`;
                      return (
                        <option key={c.eftNumber} value={c.eftNumber}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleReverse}
                  disabled={
                    reversing ||
                    !(section === "deposit-received"
                      ? canReverseDepositReceived
                      : canReverseOther)
                  }
                  className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-60"
                >
                  {reversing ? "Reversing..." : "Reverse"}
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="bg-gray-200 text-gray-800 px-6 py-2 rounded"
                >
                  Print Report
                </button>
              </div>

              <div className="mt-2">
                <label className="block text-sm font-medium mb-1">
                  Reversal Date
                </label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={useCustomDate}
                      onChange={(e) => setUseCustomDate(e.target.checked)}
                    />
                    Override date
                  </label>
                  <input
                    type="date"
                    value={customReversalDate}
                    disabled={!useCustomDate}
                    onChange={(e) => setCustomReversalDate(e.target.value)}
                    className="rounded border-gray-300 disabled:bg-gray-100"
                  />
                </div>
              </div>
            </div>

            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-3">
                Reversed EFT Details
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-2 text-left">
                        {section === "general" ? "Invoice #" : "Trade #"}
                      </th>
                      <th className="border p-2 text-left">
                        {section === "deposit-received" ? "Ref" : "Original EFT #"}
                      </th>
                      <th className="border p-2 text-left">Reversal Date</th>
                      <th className="border p-2 text-right">Amount</th>
                      <th className="border p-2 text-left">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reversals.length === 0 ? (
                      <tr>
                        <td className="border p-2 text-center" colSpan="5">
                          No reversals yet for this selection/section.
                        </td>
                      </tr>
                    ) : (
                      reversals.map((r) => (
                        <tr key={r._id}>
                          <td className="border p-2">
                            {section === "general" ? r.invoiceNumber : r.tradeNumber}
                          </td>
                          <td className="border p-2">
                            {displayEftNumber(r.sourceEftNumber)}
                          </td>
                          <td className="border p-2">
                            {r.reversedAt
                              ? new Date(r.reversedAt).toLocaleDateString()
                              : ""}
                          </td>
                          <td className="border p-2 text-right">
                            ${Number(r.amount || 0).toFixed(2)}
                          </td>
                          <td className="border p-2">{r.description || ""}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EFTReversalPage;
