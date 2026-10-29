import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FaPrint, FaSave } from "react-icons/fa";
import Select from "react-select";
import { toast } from "react-toastify";
import axiosInstance from "../config/axios";
import {
  PROGRESS_REPORT_COLUMNS,
  PROGRESS_REPORT_FILTER_KEYS,
  PROGRESS_REPORT_PERIOD_DATE_FIELDS,
  applyProgressReportFilters,
  applyProgressReportPeriodFilter,
  buildProgressReportRows,
  cloneProgressReportRows,
  formatProgressReportPeriodFilterLabel,
  getProgressReportColumnLabel,
  getProgressReportFilterOptions,
  getProgressReportSelectOptions,
  PROGRESS_REPORT_TYPEABLE_FILTER_KEYS,
  buildProgressReportTradeFilterOptions,
  getProgressReportColumnCellClass,
  getProgressReportInvoiceDateCellClass,
  isProgressReportPeriodFilterActive,
  progressReportDateForInput,
  progressReportDateFromInput,
} from "../utils/progressReportUtils";
import {
  mergeSavedTradesIntoList,
  saveProgressReportRows,
} from "../utils/progressReportSave";
import { openProgressReportPrintWindowFromRows } from "../utils/progressReportPrintHtml";
import ProgressReportCommissionDetailsModal from "./ProgressReportCommissionDetailsModal";

const EDITABLE_KEYS = new Set([
  "action",
  "notes",
  "followUpDate",
  "tradeCategory",
  "complianceStatus",
]);

const blankSelectClass =
  "w-full min-w-[5rem] text-xs border-0 bg-transparent py-1.5 pl-1 pr-7 focus:bg-white focus:ring-1 focus:ring-blue-600 focus:outline-none appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%236b7280%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.94a.75.75%200%20111.08%201.04l-4.24%204.5a.75.75%200%2001-1.08%200l-4.24-4.5a.75.75%200%2001.02-1.06z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[length:0.75rem] bg-[right_0.35rem_center]";

const tradeFilterSelectStyles = {
  control: (base) => ({
    ...base,
    minHeight: "34px",
    fontSize: "0.75rem",
    borderColor: "#d1d5db",
    boxShadow: "none",
    "&:hover": { borderColor: "#1d4ed8" },
  }),
  menu: (base) => ({ ...base, fontSize: "0.75rem", zIndex: 80 }),
  menuPortal: (base) => ({ ...base, zIndex: 80 }),
};

const cellInputClass =
  "w-full min-w-[4.5rem] pl-2 pr-2 py-1.5 text-xs border-0 bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-600 focus:outline-none";

const cellDateClass =
  "w-full min-w-[9rem] pl-2 pr-8 py-1.5 text-xs border-0 bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-600 focus:outline-none";

const cellInputMinWidth = {
  action: "min-w-0",
  notes: "min-w-0",
};

function ReportSelectCell({ col, row, onChange, options }) {
  const value = row[col.key] ?? "";
  const isEmpty = !String(value).trim();

  return (
    <select
      value={value}
      onChange={(e) => onChange(row.rowKey, col.key, e.target.value)}
      className={`${blankSelectClass} ${isEmpty ? "text-transparent" : "text-gray-800"}`}
      aria-label={col.label}
    >
      <option value="" />
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="text-gray-800">
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function ReportCell({ col, row, onChange, selectOptions }) {
  const value = row[col.key] ?? "";

  if (col.edit === "select" && EDITABLE_KEYS.has(col.key)) {
    const options =
      selectOptions?.[col.key] ||
      getProgressReportSelectOptions(col.key, []) ||
      [];
    return (
      <ReportSelectCell
        col={col}
        row={row}
        onChange={onChange}
        options={options}
      />
    );
  }

  if (!EDITABLE_KEYS.has(col.key)) {
    const invoiceClass =
      col.key === "invoiceDate"
        ? getProgressReportInvoiceDateCellClass(row.invoiceDateKind)
        : "";
    return (
      <span
        className={`block px-2 py-1.5 text-xs text-gray-800 ${
          col.key === "agentName" ||
          col.key === "address" ||
          col.key === "outsideBroker" ||
          col.key === "tradeClass"
            ? "truncate"
            : "whitespace-nowrap"
        } ${invoiceClass}`}
        title={value || undefined}
      >
        {value || "—"}
      </span>
    );
  }

  if (col.edit === "date") {
    const iso = progressReportDateForInput(value);
    return (
      <input
        type="date"
        value={iso}
        onChange={(e) =>
          onChange(
            row.rowKey,
            col.key,
            progressReportDateFromInput(e.target.value),
          )
        }
        className={cellDateClass}
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(row.rowKey, col.key, e.target.value)}
      className={`${cellInputClass} ${cellInputMinWidth[col.key] || ""}`}
      title={value || undefined}
    />
  );
}

const ProgressReportModal = ({
  isOpen,
  onClose,
  trades,
  loading,
  onTradesSaved,
}) => {
  const [rows, setRows] = useState([]);
  const [baselineRows, setBaselineRows] = useState([]);
  const [filters, setFilters] = useState({});
  const [filterColumn, setFilterColumn] = useState("");
  const [periodFilter, setPeriodFilter] = useState({
    dateField: "",
    from: "",
    to: "",
  });
  const [saving, setSaving] = useState(false);
  const [commissionDetailsOpen, setCommissionDetailsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setRows([]);
      setBaselineRows([]);
      setFilters({});
      setFilterColumn("");
      setPeriodFilter({ dateField: "", from: "", to: "" });
      setCommissionDetailsOpen(false);
      return;
    }
    if (loading || !trades?.length) return;
    const built = buildProgressReportRows(trades);
    const cloned = cloneProgressReportRows(built);
    setRows(cloned);
    setBaselineRows(cloneProgressReportRows(built));
  }, [isOpen, trades, loading]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const filteredRows = useMemo(() => {
    const columnFiltered = applyProgressReportFilters(rows, filters);
    return applyProgressReportPeriodFilter(columnFiltered, periodFilter);
  }, [rows, filters, periodFilter]);

  const columnSelectOptions = useMemo(() => {
    const map = {};
    for (const col of PROGRESS_REPORT_COLUMNS) {
      if (col.edit === "select") {
        map[col.key] = getProgressReportSelectOptions(col.key, rows) || [];
      }
    }
    return map;
  }, [rows]);

  const tradeFilterOptions = useMemo(
    () => buildProgressReportTradeFilterOptions(trades),
    [trades],
  );

  const selectedTradeFilterOption = useMemo(() => {
    const q = String(filters.tradeNumber || "").trim();
    if (!q) return null;
    return tradeFilterOptions.find((o) => o.value === q) || null;
  }, [tradeFilterOptions, filters.tradeNumber]);

  const handleCellChange = useCallback((rowKey, columnKey, value) => {
    setRows((prev) =>
      prev.map((row) =>
        row.rowKey === rowKey ? { ...row, [columnKey]: value } : row,
      ),
    );
  }, []);

  const handleFilterColumnChange = (columnKey) => {
    setFilterColumn(columnKey);
    if (!columnKey) return;
    setFilters((prev) => {
      const next = { ...prev };
      delete next[columnKey];
      return next;
    });
  };

  const filterUsesTextInput =
    filterColumn && PROGRESS_REPORT_TYPEABLE_FILTER_KEYS.has(filterColumn);

  const filterUsesAddressCombo = filterColumn === "address";

  const handleOpenCommissionDetails = () => {
    setCommissionDetailsOpen(true);
  };

  const handleFilterValueChange = (value) => {
    if (!filterColumn) return;
    setFilters((prev) => {
      const next = { ...prev };
      if (!value) delete next[filterColumn];
      else next[filterColumn] = value;
      return next;
    });
  };

  const removeFilter = (columnKey) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[columnKey];
      return next;
    });
    if (filterColumn === columnKey) setFilterColumn("");
  };

  const handleSave = async () => {
    if (!rows.length) {
      toast.error("No rows to save.");
      return;
    }
    setSaving(true);
    try {
      const { dirtyCount, savedCount, skippedInvalid, savedTrades } =
        await saveProgressReportRows(
          rows,
          baselineRows,
          trades,
          axiosInstance,
        );
      if (dirtyCount === 0) {
        toast.info("No changes to save.");
        return;
      }
      if (savedCount === 0) {
        toast.error(
          skippedInvalid > 0
            ? "Could not save: invalid trade id on one or more rows. Reload the report and try again."
            : "Changes could not be saved. Restart the backend and try again.",
        );
        return;
      }
      const mergedTrades = mergeSavedTradesIntoList(trades, savedTrades);
      const rebuilt = cloneProgressReportRows(
        buildProgressReportRows(mergedTrades),
      );
      setRows(rebuilt);
      setBaselineRows(cloneProgressReportRows(rebuilt));
      if (onTradesSaved) await onTradesSaved(savedTrades);
      toast.success(
        `Saved ${savedCount} trade${savedCount === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      console.error(e);
      toast.error("Failed to save progress report changes.");
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    if (!filteredRows.length) {
      toast.error("No rows to print.");
      return;
    }
    const opened = openProgressReportPrintWindowFromRows(filteredRows);
    if (!opened) {
      toast.error("Pop-up blocked. Allow pop-ups to print the report.");
    }
  };

  const periodFilterActive = isProgressReportPeriodFilterActive(periodFilter);

  const handlePeriodFilterChange = (field, value) => {
    setPeriodFilter((prev) => ({ ...prev, [field]: value }));
  };

  const clearPeriodFilter = () => {
    setPeriodFilter({ dateField: "", from: "", to: "" });
  };

  if (!isOpen) return null;

  const columnFilterActiveCount = Object.values(filters).filter(
    (v) => v != null && String(v).trim() !== "",
  ).length;
  const filterActiveCount =
    columnFilterActiveCount + (periodFilterActive ? 1 : 0);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/50"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-report-modal-title"
        className="bg-white rounded-xl shadow-2xl w-full max-w-[min(96vw,1400px)] max-h-[min(92vh,900px)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0 flex-1">
            <h2
              id="progress-report-modal-title"
              className="text-lg font-bold text-gray-900"
            >
              Progress Report
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Edit Trade Category, Compliance, BC Invoiced, Notes, and Follow Up Date
              here. Invoice, Open TRS, and Closed TRS dates come from Progress
              Tracker. AR Amount, Invoice Amount, and Outside Broker come from
              the trade commission tab. Save updates your edits on each trade.
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

        {!loading && rows.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-100 shrink-0">
            <p className="text-xs font-medium text-gray-600 mb-2">Filter</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-0.5 min-w-[10rem]">
                <span className="text-[10px] font-medium text-gray-500">
                  Column
                </span>
                <select
                  value={filterColumn}
                  onChange={(e) => handleFilterColumnChange(e.target.value)}
                  className="rounded border border-gray-300 text-xs py-1.5 pl-2 pr-7 bg-white min-w-[10rem]"
                >
                  <option value="">Select column…</option>
                  {PROGRESS_REPORT_FILTER_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {getProgressReportColumnLabel(key)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 min-w-[12rem] flex-1 max-w-md">
                <span className="text-[10px] font-medium text-gray-500">
                  Value
                </span>
                {filterUsesAddressCombo ? (
                  <div className="flex flex-col gap-1 w-full">
                    <input
                      type="text"
                      value={filters.address || ""}
                      onChange={(e) =>
                        handleFilterValueChange(e.target.value)
                      }
                      disabled={!filterColumn}
                      placeholder="Type address…"
                      className="rounded border border-gray-300 text-xs py-1.5 px-2 bg-white w-full disabled:bg-gray-100 disabled:text-gray-400"
                    />
                    <select
                      value={filters.address || ""}
                      onChange={(e) =>
                        handleFilterValueChange(e.target.value)
                      }
                      disabled={!filterColumn}
                      className="rounded border border-gray-300 text-xs py-1.5 pl-2 pr-7 bg-white w-full disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      {getProgressReportFilterOptions("address", rows).map(
                        (opt) => (
                          <option
                            key={`address-${opt.value}`}
                            value={opt.value}
                          >
                            {opt.label}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                ) : filterUsesTextInput ? (
                  <Select
                    inputId="progress-report-trade-filter"
                    options={tradeFilterOptions}
                    value={selectedTradeFilterOption}
                    onChange={(opt) =>
                      handleFilterValueChange(opt?.value || "")
                    }
                    isClearable
                    isSearchable
                    isDisabled={!filterColumn}
                    placeholder="Search or select a trade…"
                    noOptionsMessage={() => "No matching trades"}
                    styles={tradeFilterSelectStyles}
                    className="w-full text-xs"
                    classNamePrefix="progress-report-trade-filter"
                    menuPortalTarget={
                      typeof document !== "undefined" ? document.body : null
                    }
                    menuPosition="fixed"
                  />
                ) : (
                  <select
                    value={filterColumn ? filters[filterColumn] || "" : ""}
                    onChange={(e) =>
                      handleFilterValueChange(e.target.value)
                    }
                    disabled={!filterColumn}
                    className="rounded border border-gray-300 text-xs py-1.5 pl-2 pr-7 bg-white w-full disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {!filterColumn ? (
                      <option value="">Select a column first</option>
                    ) : (
                      getProgressReportFilterOptions(filterColumn, rows).map(
                        (opt) => (
                          <option
                            key={`${filterColumn}-${opt.value}`}
                            value={opt.value}
                          >
                            {opt.label}
                          </option>
                        ),
                      )
                    )}
                  </select>
                )}
              </label>
            </div>
            <p className="text-xs font-medium text-gray-600 mt-3 mb-2">
              Period
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-0.5 min-w-[11rem]">
                <span className="text-[10px] font-medium text-gray-500">
                  Date
                </span>
                <select
                  value={periodFilter.dateField}
                  onChange={(e) =>
                    handlePeriodFilterChange("dateField", e.target.value)
                  }
                  className="rounded border border-gray-300 text-xs py-1.5 pl-2 pr-7 bg-white min-w-[11rem]"
                >
                  <option value="">Select date…</option>
                  {PROGRESS_REPORT_PERIOD_DATE_FIELDS.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 min-w-[9rem]">
                <span className="text-[10px] font-medium text-gray-500">
                  From
                </span>
                <input
                  type="date"
                  value={periodFilter.from}
                  onChange={(e) =>
                    handlePeriodFilterChange("from", e.target.value)
                  }
                  disabled={!periodFilter.dateField}
                  className="rounded border border-gray-300 text-xs py-1.5 px-2 bg-white disabled:bg-gray-100 disabled:text-gray-400"
                />
              </label>
              <label className="flex flex-col gap-0.5 min-w-[9rem]">
                <span className="text-[10px] font-medium text-gray-500">
                  To
                </span>
                <input
                  type="date"
                  value={periodFilter.to}
                  onChange={(e) =>
                    handlePeriodFilterChange("to", e.target.value)
                  }
                  disabled={!periodFilter.dateField}
                  className="rounded border border-gray-300 text-xs py-1.5 px-2 bg-white disabled:bg-gray-100 disabled:text-gray-400"
                />
              </label>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium text-transparent select-none">
                  &nbsp;
                </span>
                <button
                  type="button"
                  onClick={handleOpenCommissionDetails}
                  className="whitespace-nowrap px-3 py-1.5 rounded-md border border-blue-800 bg-blue-800 text-white text-xs font-medium hover:bg-blue-900"
                >
                  Commission Details
                </button>
              </div>
            </div>
            {filterActiveCount > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {periodFilterActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs text-blue-900">
                    <span>{formatProgressReportPeriodFilterLabel(periodFilter)}</span>
                    <button
                      type="button"
                      onClick={clearPeriodFilter}
                      className="ml-0.5 text-blue-700 hover:text-blue-950 leading-none"
                      aria-label="Remove period filter"
                    >
                      &times;
                    </button>
                  </span>
                )}
                {Object.entries(filters)
                  .filter(([, v]) => v != null && String(v).trim() !== "")
                  .map(([key, value]) => (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs text-blue-900"
                    >
                      <span className="font-medium">
                        {getProgressReportColumnLabel(key)}:
                      </span>
                      <span>
                        {key === "tradeNumber"
                          ? selectedTradeFilterOption?.label ||
                            tradeFilterOptions.find((o) => o.value === value)
                              ?.label ||
                            value
                          : value}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFilter(key)}
                        className="ml-0.5 text-blue-700 hover:text-blue-950 leading-none"
                        aria-label={`Remove ${getProgressReportColumnLabel(key)} filter`}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                <button
                  type="button"
                  onClick={() => {
                    setFilters({});
                    setFilterColumn("");
                    clearPeriodFilter();
                  }}
                  className="text-xs text-blue-800 hover:underline"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-auto px-4 py-3 min-h-0">
          {loading ? (
            <p className="text-sm text-gray-500 py-12 text-center">
              Loading trades…
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-500 py-12 text-center">
              No trades to show.
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-gray-500 py-12 text-center">
              No trades match the selected filters.
            </p>
          ) : (
            <table className="min-w-full table-fixed border border-gray-300 text-xs">
              <thead className="sticky top-0 z-10 bg-gray-100 shadow-sm">
                <tr>
                  {PROGRESS_REPORT_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`border border-gray-300 px-2 py-2 text-left font-semibold text-gray-800 whitespace-nowrap ${getProgressReportColumnCellClass(col.key)}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.rowKey} className="hover:bg-gray-50/80">
                    {PROGRESS_REPORT_COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={`border border-gray-200 p-0 align-top overflow-hidden ${getProgressReportColumnCellClass(col.key)}`}
                      >
                        <ReportCell
                          col={col}
                          row={row}
                          onChange={handleCellChange}
                          selectOptions={columnSelectOptions}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 shrink-0 flex flex-wrap items-center justify-between gap-3 bg-gray-50 rounded-b-xl">
          <span className="text-sm text-gray-600">
            {filterActiveCount > 0
              ? `${filteredRows.length} of ${rows.length} trades`
              : `${rows.length} trade${rows.length === 1 ? "" : "s"}`}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || saving || !rows.length}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-green-700 bg-green-700 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50"
            >
              <FaSave /> {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || !filteredRows.length}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-900 text-white text-sm font-medium hover:bg-blue-950 disabled:opacity-50"
            >
              <FaPrint /> Print
            </button>
          </div>
        </div>
      </div>

      <ProgressReportCommissionDetailsModal
        isOpen={commissionDetailsOpen}
        onClose={() => setCommissionDetailsOpen(false)}
        trades={trades}
      />
    </div>
  );
};

export default ProgressReportModal;
