import React, { useMemo, useEffect, useState } from "react";
import { DEFAULT_TAX_RATE } from "../constants/tax";
import { roundTo2 } from "../utils/tradeFinancialUtils";

const CommissionForm = ({
  sellPrice = "",
  closingDate = "",
  status = "Active",
  ar = "",
  onClosingDateChange = () => {},
  onStatusChange = () => {},
  onARChange = () => {},
  listingCommission = "",
  sellingCommission = "",
  onListingCommissionChange = () => {},
  onSellingCommissionChange = () => {},
  goToNextSection = () => {},
  goToPreviousSection = () => {},
  tradeNumber = "",
  // New props for table data and handlers
  saleClosingRows = [],
  commissionIncomeRows = [],
  outsideBrokersRows = [],
  editingSaleClosingIdx = null,
  editingCommissionIncomeIdx = null,
  editingOutsideBrokerIdx = null,
  brokerAgentName = "",
  brokerBrokerage = "",
  brokerSellingAmount = "",
  brokerPercentage = "",
  onBrokerAgentNameChange = () => {},
  onBrokerBrokerageChange = () => {},
  onBrokerSellingAmountChange = () => {},
  onBrokerPercentageChange = () => {},
  onAddCommissionInfo = () => {},
  onEditSaleClosing = () => {},
  onDeleteSaleClosing = () => {},
  onEditCommissionIncome = () => {},
  onDeleteCommissionIncome = () => {},
  onEditOutsideBroker = () => {},
  onDeleteOutsideBroker = () => {},
  // New prop for outside brokers data from OutsideBrokersForm
  outsideBrokers = [],
  onCommissionTotalChange = () => {},
  onUpdateSaleClosing = () => {},
  onUpdateCommissionIncome = () => {},
  onUpdateOutsideBroker = () => {},
  onBrokerTotalChange = () => {},
  taxRate = DEFAULT_TAX_RATE,
  onTaxRateChange = () => {},
}) => {
  const [showTaxRateModal, setShowTaxRateModal] = useState(false);
  const [taxRateInput, setTaxRateInput] = useState("");
  // Parse sell price and commissions as numbers for calculations
  const sellPriceNum = parseFloat(sellPrice) || 0;
  const listingCommissionNum = parseFloat(listingCommission) || 0;
  const sellingCommissionNum = parseFloat(sellingCommission) || 0;
  const brokerSellingAmountNum = parseFloat(brokerSellingAmount) || 0;

  // Calculated values (always round commission to 2 decimals)
  const listingAmount = useMemo(
    () => roundTo2((sellPriceNum * listingCommissionNum) / 100).toFixed(2),
    [sellPriceNum, listingCommissionNum],
  );
  const sellingAmount = useMemo(
    () => roundTo2((sellPriceNum * sellingCommissionNum) / 100).toFixed(2),
    [sellPriceNum, sellingCommissionNum],
  );
  const listingTax = useMemo(
    () => roundTo2(parseFloat(listingAmount) * taxRate).toFixed(2),
    [listingAmount, taxRate],
  );
  const sellingTax = useMemo(
    () => roundTo2(parseFloat(sellingAmount) * taxRate).toFixed(2),
    [sellingAmount, taxRate],
  );
  const hst = useMemo(
    () =>
      roundTo2(
        parseFloat(listingTax) + parseFloat(sellingTax)
      ).toFixed(2),
    [listingTax, sellingTax],
  );
  const total = useMemo(
    () =>
      roundTo2(
        parseFloat(listingAmount) +
          parseFloat(sellingAmount) +
          parseFloat(listingTax) +
          parseFloat(sellingTax)
      ).toFixed(2),
    [listingAmount, sellingAmount, listingTax, sellingTax],
  );

  const cooperatingBrokers = useMemo(
    () =>
      (outsideBrokers || []).filter(
        (b) => (b?.type || "") === "Cooperating Broker",
      ),
    [outsideBrokers],
  );

  // In edit mode some trades may have only "Listing Broker" entries added.
  // If there are no cooperating brokers available, allow selecting from all outside brokers.
  const selectableBrokers = useMemo(() => {
    if (cooperatingBrokers.length > 0) return cooperatingBrokers;
    return outsideBrokers || [];
  }, [cooperatingBrokers, outsideBrokers]);

  // When there are multiple cooperating brokers, don't auto-overwrite selling amount.
  const hasMultipleCooperatingBrokers = cooperatingBrokers.length > 1;
  const brokerPercentageNum = parseFloat(brokerPercentage) || 0;
  const isUsingBrokerPercentage = brokerPercentageNum > 0;

  // Outside Brokers & Expenses calculations
  // If percentage is provided, calculate based on percentage of Commission Income selling amount.
  const calculatedBrokerSellingAmount = useMemo(() => {
    if (brokerPercentageNum > 0) {
      return roundTo2(
        parseFloat(sellingAmount) * (brokerPercentageNum / 100)
      ).toFixed(2);
    }
    return roundTo2(brokerSellingAmountNum).toFixed(2);
  }, [brokerPercentageNum, sellingAmount, brokerSellingAmountNum]);

  const brokerTax = useMemo(
    () =>
      roundTo2(parseFloat(calculatedBrokerSellingAmount) * taxRate).toFixed(2),
    [calculatedBrokerSellingAmount, taxRate],
  );
  const brokerTotal = useMemo(
    () =>
      roundTo2(
        parseFloat(calculatedBrokerSellingAmount) + parseFloat(brokerTax)
      ).toFixed(2),
    [calculatedBrokerSellingAmount, brokerTax],
  );

  // Auto-update broker selling amount when Commission Income selling amount or percentage changes
  useEffect(() => {
    if (brokerPercentageNum > 0) {
      // Update selling amount based on percentage
      const calculatedAmount = roundTo2(
        parseFloat(sellingAmount) * (brokerPercentageNum / 100)
      ).toFixed(2);
      onBrokerSellingAmountChange({ target: { value: calculatedAmount } });
    } else if (!hasMultipleCooperatingBrokers) {
      // Only auto-sync when there is 0 or 1 cooperating broker.
      // When there are multiple cooperating brokers, user must enter each broker's amount.
      onBrokerSellingAmountChange({ target: { value: sellingAmount } });
    }
  }, [
    sellingAmount,
    hasMultipleCooperatingBrokers,
    brokerPercentageNum,
    onBrokerSellingAmountChange,
  ]);

  // Notify parent component when commission total changes
  useEffect(() => {
    onCommissionTotalChange(total);
  }, [total, onCommissionTotalChange]);

  // Notify parent component when broker total changes
  useEffect(() => {
    if (typeof onBrokerTotalChange === "function") {
      onBrokerTotalChange(brokerTotal);
    }
  }, [brokerTotal, onBrokerTotalChange]);

  // Handler for auto-populating broker fields from outsideBrokers data
  const handleBrokerSelect = (e) => {
    const selectedValue = e.target.value;
    if (selectedValue) {
      const selectedBroker = selectableBrokers.find(
        (broker) =>
          `${broker.firstName} ${broker.lastName} - ${broker.company}` ===
          selectedValue,
      );
      if (selectedBroker) {
        onBrokerAgentNameChange({
          target: {
            value: `${selectedBroker.firstName} ${selectedBroker.lastName}`,
          },
        });
        onBrokerBrokerageChange({ target: { value: selectedBroker.company } });
        onBrokerSellingAmountChange({
          target: { value: selectedBroker.sellingAmount || "" },
        });
      }
    } else {
      onBrokerAgentNameChange({ target: { value: "" } });
      onBrokerBrokerageChange({ target: { value: "" } });
      onBrokerSellingAmountChange({ target: { value: "" } });
      onBrokerPercentageChange({ target: { value: "" } });
    }
  };

  // Handlers for each table's add/update functionality
  const handleSaleClosingAddOrUpdate = () => {
    const newSaleClosingRow = {
      sellPrice,
      closingDate,
      tradeNumber,
      status,
      ar,
    };
    if (
      editingSaleClosingIdx !== null &&
      typeof onUpdateSaleClosing === "function"
    ) {
      onUpdateSaleClosing(newSaleClosingRow);
    } else {
      onAddCommissionInfo({ type: "saleClosing", data: newSaleClosingRow });
    }
  };

  const handleCommissionIncomeAddOrUpdate = () => {
    const newCommissionIncomeRow = {
      income: "Commission",
      listingAmount,
      sellingAmount,
      listingTax,
      sellingTax,
      tax: (parseFloat(listingTax) + parseFloat(sellingTax)).toFixed(2),
      total,
    };
    if (
      editingCommissionIncomeIdx !== null &&
      typeof onUpdateCommissionIncome === "function"
    ) {
      onUpdateCommissionIncome(newCommissionIncomeRow);
    } else {
      onAddCommissionInfo({
        type: "commissionIncome",
        data: newCommissionIncomeRow,
      });
    }
  };

  const handleOutsideBrokerAddOrUpdate = () => {
    if (
      brokerAgentName ||
      brokerBrokerage ||
      brokerSellingAmount ||
      brokerPercentage
    ) {
      const newBrokerRow = {
        agentName: brokerAgentName,
        brokerage: brokerBrokerage,
        sellingAmount:
          brokerPercentageNum > 0
            ? calculatedBrokerSellingAmount
            : brokerSellingAmount,
        percentage: brokerPercentage || "",
        tax: brokerTax,
        total: brokerTotal,
      };
      if (
        editingOutsideBrokerIdx !== null &&
        typeof onUpdateOutsideBroker === "function"
      ) {
        onUpdateOutsideBroker(newBrokerRow);
      } else {
        onAddCommissionInfo({ type: "outsideBroker", data: newBrokerRow });
      }
    }
  };

  return (
    <div className="py-8 px-2">
      <h2 className="text-2xl font-bold mb-6">Commissions</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Sale Closing Information */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold mb-4">
            Sale Closing Information
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sell Price
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={sellPrice}
                readOnly
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Trade Number
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-100"
                value={tradeNumber}
                readOnly
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Closing Date
              </label>
              <input
                type="date"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={closingDate}
                onChange={onClosingDateChange}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                className="w-full rounded border-gray-300 bg-gray-50"
                value={status}
                onChange={onStatusChange}
              >
                <option value="Active">Active</option>
                <option value="Sold">Sold</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              AR
            </label>
            <input
              type="text"
              name="ar"
              value={ar}
              onChange={onARChange}
              className="block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm focus:border-blue-700 focus:ring-blue-700"
              readOnly
            />
          </div>
        </div>

        {/* Commission Income */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-lg font-semibold">Commission Income</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                Tax rate: <strong>{Math.round((taxRate ?? DEFAULT_TAX_RATE) * 100)}%</strong>
                {taxRate != null && Number(taxRate) !== DEFAULT_TAX_RATE && (
                  <span className="text-gray-500 ml-1">(custom)</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  setTaxRateInput(taxRate !== DEFAULT_TAX_RATE ? String(Math.round(taxRate * 100)) : "");
                  setShowTaxRateModal(true);
                }}
                className="text-sm px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700"
              >
                Set Tax Rate
              </button>
            </div>
          </div>
          {showTaxRateModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
                <h4 className="text-lg font-semibold mb-2">Set Tax Rate</h4>
                <p className="text-sm text-gray-600 mb-3">
                  Enter tax rate as percentage (e.g. 13 for 13%). Leave empty to use default {Math.round(DEFAULT_TAX_RATE * 100)}%.
                </p>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g. 13"
                  value={taxRateInput}
                  onChange={(e) => setTaxRateInput(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 mb-4"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTaxRateModal(false);
                      setTaxRateInput("");
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const pct = taxRateInput.trim();
                      if (pct === "") {
                        onTaxRateChange(null);
                      } else {
                        const num = parseFloat(pct);
                        if (!Number.isNaN(num) && num >= 0 && num <= 100) {
                          onTaxRateChange(num / 100);
                        }
                      }
                      setShowTaxRateModal(false);
                      setTaxRateInput("");
                    }}
                    className="px-4 py-2 bg-blue-700 text-white rounded-md hover:bg-blue-800"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Income
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value="Commission"
                readOnly
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Listing Commission (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={listingCommission}
                onChange={onListingCommissionChange}
                placeholder="%"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Selling Commission (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={sellingCommission}
                onChange={onSellingCommissionChange}
                placeholder="%"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Listing Amount
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={listingAmount}
                readOnly
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Selling Amount
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={sellingAmount}
                readOnly
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Listing Tax
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={listingTax}
                readOnly
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Selling Tax
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={sellingTax}
                readOnly
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                HST
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={hst}
                readOnly
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-100 font-semibold"
                value={total}
                readOnly
              />
            </div>
          </div>
        </div>

        {/* Outside Brokers & Expenses */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold mb-4">
            Outside Brokers & Expenses
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Broker
              </label>
              <select
                className="w-full rounded border-gray-300 bg-gray-50"
                onChange={handleBrokerSelect}
                value={
                  brokerAgentName && brokerBrokerage
                    ? `${brokerAgentName} - ${brokerBrokerage}`
                    : ""
                }
              >
                <option value="">Select a Broker</option>
                {selectableBrokers.map((broker, index) => (
                  <option
                    key={index}
                    value={`${broker.firstName} ${broker.lastName} - ${broker.company}`}
                  >
                    {broker.firstName} {broker.lastName} - {broker.company}
                    {broker.type ? ` (${broker.type})` : ""}
                  </option>
                ))}
              </select>
              
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Agent Name
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={brokerAgentName}
                onChange={onBrokerAgentNameChange}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Brokerage
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={brokerBrokerage}
                onChange={onBrokerBrokerageChange}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Percentage (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={brokerPercentage}
                onChange={onBrokerPercentageChange}
                placeholder="%"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Selling Amount
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={
                  isUsingBrokerPercentage
                    ? calculatedBrokerSellingAmount
                    : brokerSellingAmount
                }
                onChange={onBrokerSellingAmountChange}
                readOnly={isUsingBrokerPercentage}
              />
              {isUsingBrokerPercentage && (
                <div className="mt-1 text-xs text-gray-500">
                  Auto-calculated from Commission Income Selling Amount.
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End (Side)
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={(() => {
                  const selected = outsideBrokers.find(
                    (b) => `${b.firstName} ${b.lastName}` === brokerAgentName,
                  );
                  return selected && selected.end ? selected.end : "";
                })()}
                readOnly
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tax
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-50"
                value={brokerTax}
                readOnly
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total
              </label>
              <input
                type="text"
                className="w-full rounded border-gray-300 bg-gray-100 font-semibold"
                value={brokerTotal}
                readOnly
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tables Section */}
      <div className="mt-12 space-y-8">
        {/* Sale Closing Information Table */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between mb-2">
            <h3 className="text-lg font-semibold">Sale Closing Information</h3>
            <div>
              <button
                className="px-3 py-1 bg-yellow-600 text-white rounded mr-2"
                onClick={handleSaleClosingAddOrUpdate}
              >
                {editingSaleClosingIdx !== null ? "Update" : "Add"}
              </button>
              <button
                className="px-3 py-1 bg-blue-600 text-white rounded mr-2"
                onClick={onEditSaleClosing}
                disabled={saleClosingRows.length === 0}
              >
                Edit
              </button>
              <button
                className="px-3 py-1 bg-red-600 text-white rounded"
                onClick={onDeleteSaleClosing}
                disabled={saleClosingRows.length === 0}
              >
                Delete
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-4 py-2 border-b text-center">Sell Price</th>
                  <th className="px-4 py-2 border-b text-center">
                    Closing Date
                  </th>
                  <th className="px-4 py-2 border-b text-center">
                    Trade Number
                  </th>
                  <th className="px-4 py-2 border-b text-center">Status</th>
                  <th className="px-4 py-2 border-b text-center">AR</th>
                </tr>
              </thead>
              <tbody>
                {saleClosingRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-4 text-gray-500">
                      No sale closing info added yet.
                    </td>
                  </tr>
                ) : (
                  saleClosingRows.map((row, idx) => (
                    <tr key={idx} className="text-center">
                      <td className="px-4 py-2 border-b">{row.sellPrice}</td>
                      <td className="px-4 py-2 border-b">{row.closingDate}</td>
                      <td className="px-4 py-2 border-b">{row.tradeNumber}</td>
                      <td className="px-4 py-2 border-b">{row.status}</td>
                      <td className="px-4 py-2 border-b">{row.ar}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Commission Income Table */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between mb-2">
            <h3 className="text-lg font-semibold">Commission Income</h3>
            <div>
              <button
                className="px-3 py-1 bg-yellow-600 text-white rounded mr-2"
                onClick={handleCommissionIncomeAddOrUpdate}
              >
                {editingCommissionIncomeIdx !== null ? "Update" : "Add"}
              </button>
              <button
                className="px-3 py-1 bg-blue-600 text-white rounded mr-2"
                onClick={onEditCommissionIncome}
                disabled={commissionIncomeRows.length === 0}
              >
                Edit
              </button>
              <button
                className="px-3 py-1 bg-red-600 text-white rounded"
                onClick={onDeleteCommissionIncome}
                disabled={commissionIncomeRows.length === 0}
              >
                Delete
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-4 py-2 border-b text-center">Income</th>
                  <th className="px-4 py-2 border-b text-center">
                    Listing Amount
                  </th>
                  <th className="px-4 py-2 border-b text-center">
                    Selling Amount
                  </th>
                  <th className="px-4 py-2 border-b text-center">Tax</th>
                  <th className="px-4 py-2 border-b text-center">Total</th>
                </tr>
              </thead>
              <tbody>
                {commissionIncomeRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-4 text-gray-500">
                      No commission income info added yet.
                    </td>
                  </tr>
                ) : (
                  commissionIncomeRows.map((row, idx) => (
                    <tr key={idx} className="text-center">
                      <td className="px-4 py-2 border-b">{row.income}</td>
                      <td className="px-4 py-2 border-b">
                        {row.listingAmount}
                      </td>
                      <td className="px-4 py-2 border-b">
                        {row.sellingAmount}
                      </td>
                      <td className="px-4 py-2 border-b">{row.tax}</td>
                      <td className="px-4 py-2 border-b">{row.total}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Outside Brokers & Expenses Table */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between mb-2">
            <h3 className="text-lg font-semibold">
              Outside Brokers & Expenses
            </h3>
            <div>
              <button
                className="px-3 py-1 bg-yellow-600 text-white rounded mr-2"
                onClick={handleOutsideBrokerAddOrUpdate}
              >
                {editingOutsideBrokerIdx !== null ? "Update" : "Add"}
              </button>
              <button
                className="px-3 py-1 bg-blue-600 text-white rounded mr-2"
                onClick={onEditOutsideBroker}
                disabled={outsideBrokersRows.length === 0}
              >
                Edit
              </button>
              <button
                className="px-3 py-1 bg-red-600 text-white rounded"
                onClick={onDeleteOutsideBroker}
                disabled={outsideBrokersRows.length === 0}
              >
                Delete
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-4 py-2 border-b text-center">Agent Name</th>
                  <th className="px-4 py-2 border-b text-center">Brokerage</th>
                  <th className="px-4 py-2 border-b text-center">
                    Percentage (%)
                  </th>
                  <th className="px-4 py-2 border-b text-center">
                    Selling Amount
                  </th>
                  <th className="px-4 py-2 border-b text-center">Tax</th>
                  <th className="px-4 py-2 border-b text-center">Total</th>
                </tr>
              </thead>
              <tbody>
                {outsideBrokersRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-4 text-gray-500">
                      No outside brokers added yet.
                    </td>
                  </tr>
                ) : (
                  outsideBrokersRows.map((row, idx) => (
                    <tr key={idx} className="text-center">
                      <td className="px-4 py-2 border-b">{row.agentName}</td>
                      <td className="px-4 py-2 border-b">{row.brokerage}</td>
                      <td className="px-4 py-2 border-b">
                        {row.percentage || ""}
                      </td>
                      <td className="px-4 py-2 border-b">
                        {row.sellingAmount}
                      </td>
                      <td className="px-4 py-2 border-b">{row.tax}</td>
                      <td className="px-4 py-2 border-b">{row.total}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between mt-8">
        <button
          onClick={goToPreviousSection}
          className="bg-gray-500 text-white px-6 py-2 rounded font-semibold hover:bg-gray-600"
        >
          Previous
        </button>
        <button
          onClick={goToNextSection}
          className="bg-yellow-700 text-white px-6 py-2 rounded font-semibold hover:bg-yellow-800"
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default CommissionForm;
