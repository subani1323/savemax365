import React, { useEffect, useMemo, useState } from "react";
import axiosInstance from "../config/axios";
import toast from "react-hot-toast";

const CommissionRecallModal = ({ isOpen, onClose, onSuccess }) => {
  const [trades, setTrades] = useState([]);
  const [tradeSearch, setTradeSearch] = useState("");
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [amount, setAmount] = useState("");
  const [recallDate, setRecallDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const loadTrades = async () => {
      try {
        const res = await axiosInstance.get("/trades", { params: { list: "1" } });
        setTrades(res.data || []);
      } catch (_e) {
        toast.error("Could not load trades");
      }
    };
    loadTrades();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setTradeSearch("");
    setSelectedTrade(null);
    setAgents([]);
    setSelectedAgentId("");
    setAmount("");
    setRecallDate(new Date().toISOString().slice(0, 10));
    setNotes("");
  }, [isOpen]);

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

  const selectedAgent = agents.find(
    (a) => String(a.agentId) === String(selectedAgentId),
  );

  useEffect(() => {
    if (!selectedAgentId || !selectedAgent) return;
    const suggested = selectedAgent.suggestedRecallAmount;
    if (suggested != null && Number(suggested) > 0) {
      setAmount(Number(suggested).toFixed(2));
    } else {
      setAmount("");
    }
  }, [selectedAgentId, selectedAgent?.suggestedRecallAmount]);

  const loadAgentsForTrade = async (trade) => {
    setLoadingAgents(true);
    setSelectedAgentId("");
    setAmount("");
    setAgents([]);
    try {
      const fullTradeRes = await axiosInstance.get(`/trades/${trade._id}`);
      const tradeForAgents = fullTradeRes.data || trade;
      const res = await axiosInstance.get(
        `/commission-recalls/trade-agents/${tradeForAgents._id || trade._id}`,
      );
      const list = res.data?.agents || [];
      setAgents(list);
      if (list.length === 1) {
        setSelectedAgentId(String(list[0].agentId));
        if (list[0].suggestedRecallAmount > 0) {
          setAmount(Number(list[0].suggestedRecallAmount).toFixed(2));
        }
      }
    } catch (_e) {
      toast.error("Could not load agents for this trade");
      setAgents([]);
    } finally {
      setLoadingAgents(false);
    }
  };

  const handleSelectTrade = (trade) => {
    setSelectedTrade(trade);
    const address = `${trade.keyInfo?.streetNumber || ""} ${
      trade.keyInfo?.streetName || ""
    } ${trade.keyInfo?.unit || ""}`.trim();
    setTradeSearch(
      `${trade.tradeNumber} - ${address || "No address"}`.trim(),
    );
    loadAgentsForTrade(trade);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedTrade?._id) {
      toast.error("Please select a trade");
      return;
    }
    if (!selectedAgentId) {
      toast.error("Please select an agent");
      return;
    }
    const numericAmount = parseFloat(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      toast.error("Enter a valid amount greater than 0");
      return;
    }

    setSubmitting(true);
    try {
      await axiosInstance.post("/commission-recalls/recall", {
        tradeId: selectedTrade._id,
        agentId: selectedAgentId,
        agentName: selectedAgent?.agentName || "",
        amount: numericAmount,
        notes,
        recallDate: new Date(`${recallDate}T00:00:00`).toISOString(),
      });
      toast.success(
        "Commission recalled. Debit 10004 and Credit 12101 posted to the ledger.",
      );
      onSuccess?.();
      onClose();
    } catch (error) {
      toast.error(
        error?.response?.data?.message || "Failed to post commission recall",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-800">Commission Recalled</h3>
          <p className="text-sm text-gray-600 mt-1">
            Posts Debit 10004 (Commission Trust) and Credit 12101 (A/R - Agt's Recoverable - Commission).
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Trade
            </label>
            <input
              type="text"
              value={tradeSearch}
              onChange={(e) => {
                setTradeSearch(e.target.value);
                setSelectedTrade(null);
                setAgents([]);
                setSelectedAgentId("");
                setAmount("");
              }}
              placeholder="Search trade number or address..."
              className="w-full rounded border-gray-300"
            />
            {!selectedTrade && filteredTrades.length > 0 && (
              <div className="border rounded mt-1 max-h-40 overflow-auto">
                {filteredTrades.map((trade) => {
                  const address = `${trade.keyInfo?.streetNumber || ""} ${
                    trade.keyInfo?.streetName || ""
                  } ${trade.keyInfo?.unit || ""}`.trim();
                  return (
                    <button
                      key={trade._id}
                      type="button"
                      onClick={() => handleSelectTrade(trade)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 border-b text-sm"
                    >
                      Trade #{trade.tradeNumber} — {address || "No address"}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Agent
            </label>
            {loadingAgents ? (
              <p className="text-sm text-gray-500">Loading agents...</p>
            ) : !selectedTrade ? (
              <p className="text-sm text-gray-500">Select a trade first</p>
            ) : agents.length === 0 ? (
              <p className="text-sm text-amber-700">
                No agents on this trade (excluding referrals).
              </p>
            ) : agents.length === 1 ? (
              <input
                type="text"
                readOnly
                value={`${agents[0].agentName} (${agents[0].agentId})`}
                className="w-full rounded border-gray-300 bg-gray-100"
              />
            ) : (
              <select
                className="w-full rounded border-gray-300"
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
              >
                <option value="">Select agent...</option>
                {agents.map((a) => (
                  <option key={a.agentId} value={a.agentId}>
                    {a.agentName} ({a.agentId})
                    {a.classification ? ` — ${a.classification}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded border-gray-300"
              placeholder="0.00"
            />
            {selectedAgent?.suggestedRecallAmount > 0 && (
              <p className="mt-1 text-xs text-gray-500">
                Pre-filled from{" "}
                {selectedAgent.amountSource === "agentCommissionEft"
                  ? `agent commission EFT #${selectedAgent.agentCommissionEftNumber}`
                  : "agent net commission on trade"}
                {" "}({Number(selectedAgent.suggestedRecallAmount).toFixed(2)}).
                You may change this amount.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Recall Date
            </label>
            <input
              type="date"
              value={recallDate}
              onChange={(e) => setRecallDate(e.target.value)}
              className="w-full rounded border-gray-300"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded border-gray-300"
              placeholder="Optional notes"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedTrade || !selectedAgentId}
              className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Posting..." : "Post Recall"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CommissionRecallModal;
