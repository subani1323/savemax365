import React, { useState } from "react";
import { FaSearch } from "react-icons/fa";
import TradeFinalizeModal from "./TradeFinalizeModal";
import { tradeMatchesSearchQuery } from "../utils/tradeSearchUtils";

const FinalizeTradeSection = ({ trades, onTradeFinalized }) => {
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTrades = trades.filter((trade) =>
    tradeMatchesSearchQuery(trade, searchQuery),
  );

  // Helper function to format dates in local timezone to avoid UTC conversion issues
  const formatDate = (dateString) => {
    if (!dateString) return "-";

    // Handle both Date objects and date strings
    let date;
    if (dateString instanceof Date) {
      date = dateString;
    } else {
      // Parse the date string and create a date in local timezone
      const [year, month, day] = dateString.split("-");
      if (year && month && day) {
        // Create date in local timezone to avoid UTC conversion issues
        date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else {
        // Fallback to original method for other date formats
        date = new Date(dateString);
      }
    }

    return date.toLocaleDateString();
  };

  const handleRowClick = (trade) => {
    setSelectedTrade(trade);
    setShowModal(true);
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Finalize Trade</h2>

      <div className="mb-6 relative">
        <input
          type="text"
          placeholder="Trade #, agent, or address (e.g. 358, 359)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-96 pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
        />
        <FaSearch className="absolute left-3 top-3 text-gray-400" />
      </div>

      {filteredTrades.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          {searchQuery
            ? "No trades found matching your search."
            : "No trades available to finalize."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-blue-900 text-white">
                <th className="px-4 py-3 text-left font-medium border-b">
                  Trade #
                </th>
                <th className="px-4 py-3 text-left font-medium border-b">
                  Street #
                </th>
                <th className="px-4 py-3 text-left font-medium border-b">
                  Street Name
                </th>
                <th className="px-4 py-3 text-left font-medium border-b">
                  Unit
                </th>
                <th className="px-4 py-3 text-left font-medium border-b">
                  MLS #
                </th>
                <th className="px-4 py-3 text-left font-medium border-b">
                  Price
                </th>
                <th className="px-4 py-3 text-left font-medium border-b">
                  Type
                </th>
                <th className="px-4 py-3 text-left font-medium border-b">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium border-b">
                  Finalized Date
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((trade) => {
                return (
                  <tr
                    key={trade._id}
                    className="hover:bg-gray-100 cursor-pointer"
                    onClick={() => handleRowClick(trade)}
                  >
                    <td className="px-4 py-3 border-b">
                      {trade.tradeNumber || "-"}
                    </td>
                    <td className="px-4 py-3 border-b">
                      {trade.keyInfo?.streetNumber || "-"}
                    </td>
                    <td className="px-4 py-3 border-b">
                      {trade.keyInfo?.streetName || "-"}
                    </td>
                    <td className="px-4 py-3 border-b">
                      {trade.keyInfo?.unit || "-"}
                    </td>
                    <td className="px-4 py-3 border-b">
                      {trade.keyInfo?.mlsNumber || "-"}
                    </td>
                    <td className="px-4 py-3 border-b">
                      {trade.keyInfo?.sellPrice
                        ? `$${trade.keyInfo.sellPrice.toLocaleString()}`
                        : "-"}
                    </td>
                    <td className="px-4 py-3 border-b">
                      {trade.keyInfo?.propertyType || "-"}
                    </td>
                    <td className="px-4 py-3 border-b">
                      <span
                        className={`px-2 py-1 rounded-full text-sm font-semibold ${
                          trade.keyInfo?.status === "CLOSED"
                            ? "bg-green-100 text-green-800"
                            : trade.keyInfo?.status === "PENDING"
                              ? "bg-yellow-100 text-yellow-800"
                              : trade.keyInfo?.status === "CANCELLED"
                                ? "bg-red-100 text-red-800"
                                : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {trade.keyInfo?.status || "Available"}
                      </span>
                    </td>
                    <td className="px-4 py-3 border-b">
                      {trade.keyInfo?.finalizedDate
                        ? formatDate(trade.keyInfo.finalizedDate)
                        : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <TradeFinalizeModal
          trade={selectedTrade}
          onClose={() => {
            setShowModal(false);
            if (onTradeFinalized) {
              onTradeFinalized();
            }
          }}
        />
      )}
    </div>
  );
};

export default FinalizeTradeSection;
