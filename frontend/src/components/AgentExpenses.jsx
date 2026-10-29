import React, { useCallback, useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { toast } from "react-hot-toast";
import Navbar from "./Navbar";
import FinanceSidebar from "./FinanceSidebar";
import axiosInstance from "../config/axios";
import { scannedAccounts } from "./ChartOfAccountsMenu.jsx";
import {
  EXPENSE_FIELDS,
  computeAgentExpenseTotals,
  formatDisplayDate,
  formatMoney,
  todayIsoLocal,
} from "../utils/agentExpenseUtils";

const emptyLines = () =>
  EXPENSE_FIELDS.reduce((acc, f) => {
    acc[f.key] = "";
    return acc;
  }, {});

const selectStyles = {
  control: (base) => ({
    ...base,
    minHeight: "38px",
    fontSize: "0.875rem",
    borderColor: "#d1d5db",
    boxShadow: "none",
    "&:hover": { borderColor: "#1d4ed8" },
  }),
  menu: (base) => ({ ...base, fontSize: "0.875rem", zIndex: 30 }),
};

const AgentExpenses = () => {
  const [agents, setAgents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [totalsByType, setTotalsByType] = useState([]);
  const [balances, setBalances] = useState({ posted: {}, remaining: {} });
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [showPrintReport, setShowPrintReport] = useState(false);
  const [companyName] = useState("365 Realty Brokerage");

  const [form, setForm] = useState({
    invoiceDate: todayIsoLocal(),
    postDate: todayIsoLocal(),
    aeNumber: "",
    invoiceNumber: "",
    agentId: "",
    glAccount: "",
    taxRate: "13",
    lines: emptyLines(),
  });

  const [reportFilters, setReportFilters] = useState({
    agentId: "",
    from: "",
    to: "",
  });

  const glOptions = useMemo(() => {
    const fromChart = (scannedAccounts || []).map((a) => ({
      value: String(a.acct),
      label: `${a.acct} ${a.description}`,
    }));
    const extras = [
      { value: "15000", label: "15000 Prepaid Expenses" },
      { value: "21200", label: "21200 Garnishment" },
      { value: "44100", label: "44100 Fee Deducted Income" },
      { value: "60199", label: "60199 Equip. Rental - Misc." },
    ];
    const map = new Map();
    [...extras, ...fromChart].forEach((o) => map.set(o.value, o));
    return Array.from(map.values()).sort((a, b) =>
      a.value.localeCompare(b.value, undefined, { numeric: true }),
    );
  }, []);

  const agentOptions = useMemo(
    () =>
      agents.map((a) => ({
        value: a._id,
        label: `${a.employeeNo || ""} - ${a.firstName || ""} ${a.lastName || ""}`.trim(),
        agent: a,
      })),
    [agents],
  );

  const selectedAgentOption =
    agentOptions.find((o) => o.value === form.agentId) || null;
  const selectedGlOption =
    glOptions.find((o) => o.value === form.glAccount) || null;

  const totals = useMemo(
    () => computeAgentExpenseTotals(form.lines, form.taxRate),
    [form.lines, form.taxRate],
  );

  const loadNextNumbers = useCallback(async () => {
    try {
      const res = await axiosInstance.get("/agent-expenses/next-numbers");
      setForm((prev) => ({
        ...prev,
        aeNumber: res.data.aeNumber || "",
        invoiceNumber: res.data.invoiceNumber || prev.invoiceNumber,
      }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadExpenses = useCallback(async () => {
    try {
      const res = await axiosInstance.get("/agent-expenses");
      setExpenses(res.data || []);
    } catch (e) {
      console.error(e);
      toast.error("Could not load agent expenses");
    }
  }, []);

  const loadTotalsByType = useCallback(async (filters = reportFilters) => {
    try {
      const params = {};
      if (filters.agentId) params.agentId = filters.agentId;
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      const res = await axiosInstance.get("/agent-expenses/totals-by-type", {
        params,
      });
      setTotalsByType(res.data || []);
    } catch (e) {
      console.error(e);
      toast.error("Could not load expense totals");
    }
  }, [reportFilters]);

  const loadAgentBalances = useCallback(async (agentId) => {
    if (!agentId) {
      setBalances({ posted: {}, remaining: {} });
      return;
    }
    try {
      const res = await axiosInstance.get(
        `/agent-expenses/balances/${agentId}`,
      );
      setBalances(res.data || { posted: {}, remaining: {} });
    } catch (e) {
      console.error(e);
      setBalances({ posted: {}, remaining: {} });
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const agentsRes = await axiosInstance.get("/agents");
        setAgents(agentsRes.data || []);
        await Promise.all([loadNextNumbers(), loadExpenses(), loadTotalsByType()]);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load agent expenses page");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAgentBalances(form.agentId);
  }, [form.agentId, loadAgentBalances]);

  const setLineAmount = (key, value) => {
    setForm((prev) => ({
      ...prev,
      lines: { ...prev.lines, [key]: value },
    }));
  };

  const handleReset = async () => {
    setForm({
      invoiceDate: todayIsoLocal(),
      postDate: todayIsoLocal(),
      aeNumber: "",
      invoiceNumber: "",
      agentId: "",
      glAccount: "",
      taxRate: "13",
      lines: emptyLines(),
    });
    await loadNextNumbers();
  };

  const handlePost = async () => {
    if (!form.agentId) {
      toast.error("Select an agent");
      return;
    }
    if (!form.glAccount) {
      toast.error("Select a G/L Account");
      return;
    }
    if (totals.total <= 0) {
      toast.error("Enter at least one expense amount");
      return;
    }

    setPosting(true);
    const postedAgentId = form.agentId;
    try {
      const glLabel = selectedGlOption?.label || form.glAccount;
      await axiosInstance.post("/agent-expenses", {
        agentId: form.agentId,
        glAccount: form.glAccount,
        glAccountName: glLabel.replace(/^\d+\s*/, "") || glLabel,
        invoiceDate: form.invoiceDate,
        postDate: form.postDate,
        taxRate: form.taxRate,
        invoiceNumber: form.invoiceNumber,
        lines: EXPENSE_FIELDS.reduce((acc, f) => {
          acc[f.key] = Number(form.lines[f.key]) || 0;
          return acc;
        }, {}),
      });
      toast.success("Agent expense posted to ledger");
      await handleReset();
      await loadExpenses();
      await loadTotalsByType();
      if (postedAgentId) await loadAgentBalances(postedAgentId);
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || "Failed to post expense");
    } finally {
      setPosting(false);
    }
  };

  const handlePrintReport = async () => {
    if (!reportFilters.agentId) {
      toast.error("Select an agent for the report");
      return;
    }
    await loadTotalsByType(reportFilters);
    setShowPrintReport(true);
  };

  const reportPeriodLabel = useMemo(() => {
    if (reportFilters.from || reportFilters.to) {
      const from = reportFilters.from
        ? formatDisplayDate(reportFilters.from)
        : "…";
      const to = reportFilters.to ? formatDisplayDate(reportFilters.to) : "…";
      return `${from} – ${to} (by invoice date)`;
    }
    return "All invoices (by invoice date)";
  }, [reportFilters.from, reportFilters.to]);

  const reportAgent = agents.find((a) => a._id === reportFilters.agentId);
  const reportAgentLabel = reportAgent
    ? `${reportAgent.employeeNo || ""} - ${reportAgent.firstName || ""} ${reportAgent.lastName || ""}`.trim()
    : "";

  const reportInvoices = useMemo(() => {
    if (!reportFilters.agentId) return [];
    return expenses.filter((e) => {
      if (String(e.agentId) !== String(reportFilters.agentId)) return false;
      const inv = e.invoiceDate ? new Date(e.invoiceDate) : null;
      if (reportFilters.from && inv && inv < new Date(`${reportFilters.from}T00:00:00`)) {
        return false;
      }
      if (reportFilters.to && inv && inv > new Date(`${reportFilters.to}T23:59:59`)) {
        return false;
      }
      return true;
    });
  }, [expenses, reportFilters]);

  const reportSummary = useMemo(() => {
    const total = reportInvoices.reduce((s, e) => s + (e.total || 0), 0);
    const applied = reportInvoices.reduce((s, e) => s + (e.applied || 0), 0);
    return {
      total,
      applied,
      balance: Math.round((total - applied) * 100) / 100,
    };
  }, [reportInvoices]);

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="print:hidden">
        <Navbar />
      </div>
      <div className="flex">
        <div className="print:hidden">
          <FinanceSidebar />
        </div>

        <div className="flex-1 p-6 print:p-0">
          <div className="print:hidden max-w-6xl mx-auto space-y-8">
            <div>
              <h1 className="text-2xl font-bold text-blue-900">Agent Expenses</h1>
              <p className="text-sm text-gray-600 mt-1">
                Post office expenses recoverable from agents. Tax is not applied
                to garnishment or bank charges.
              </p>
            </div>

            {/* Entry form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Invoice date
                  </label>
                  <input
                    type="date"
                    value={form.invoiceDate}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, invoiceDate: e.target.value }))
                    }
                    className="border border-gray-300 rounded-md px-3 py-2 w-full text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Defaults to today — change to override.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    AE Number
                  </label>
                  <input
                    type="text"
                    value={form.aeNumber}
                    readOnly
                    className="border border-gray-300 rounded-md px-3 py-2 w-full text-sm bg-gray-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Agent name
                  </label>
                  <Select
                    styles={selectStyles}
                    options={agentOptions}
                    value={selectedAgentOption}
                    onChange={(opt) =>
                      setForm((p) => ({ ...p, agentId: opt?.value || "" }))
                    }
                    placeholder="Select agent..."
                    isClearable
                    isLoading={loading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Invoice #
                  </label>
                  <input
                    type="text"
                    value={form.invoiceNumber}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, invoiceNumber: e.target.value }))
                    }
                    className="border border-gray-300 rounded-md px-3 py-2 w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    G/L Account
                  </label>
                  <Select
                    styles={selectStyles}
                    options={glOptions}
                    value={selectedGlOption}
                    onChange={(opt) =>
                      setForm((p) => ({ ...p, glAccount: opt?.value || "" }))
                    }
                    placeholder="Select G/L Account"
                    isClearable
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Post date
                  </label>
                  <input
                    type="date"
                    value={form.postDate}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, postDate: e.target.value }))
                    }
                    className="border border-gray-300 rounded-md px-3 py-2 w-full text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Defaults to today — change to override.
                  </p>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">
                  Office Expenses
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                  Enter amounts to post a new Agent Expense invoice. Existing AE
                  invoices for this agent appear in the balances tables below.
                </p>

                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <label className="text-sm font-medium text-gray-700">
                    Tax rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.taxRate}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, taxRate: e.target.value }))
                    }
                    className="border border-gray-300 rounded-md px-3 py-1.5 w-24 text-sm"
                  />
                  <span className="text-sm text-gray-500">
                    Applied to taxable expenses (not garnishment or bank charges)
                  </span>
                </div>

                <div className="space-y-3">
                  {EXPENSE_FIELDS.map((field) => {
                    const line = totals.perLine[field.key];
                    const posted = balances.posted?.[field.key] || 0;
                    const remaining = balances.remaining?.[field.key] || 0;
                    return (
                      <div
                        key={field.key}
                        className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start"
                      >
                        <label className="md:col-span-3 text-sm font-medium text-gray-700 pt-2">
                          {field.label}
                          {!field.taxable && (
                            <span className="block text-xs font-normal text-gray-500">
                              No tax
                            </span>
                          )}
                        </label>
                        <div className="md:col-span-4">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Amount"
                            value={form.lines[field.key]}
                            onChange={(e) =>
                              setLineAmount(field.key, e.target.value)
                            }
                            className="border border-gray-300 rounded-md px-3 py-2 w-full text-sm"
                          />
                          {line.base > 0 && field.taxable && (
                            <p className="text-xs text-gray-500 mt-1">
                              + tax {formatMoney(line.hst)} ={" "}
                              {formatMoney(line.total)}
                            </p>
                          )}
                        </div>
                        <div className="md:col-span-5 text-xs text-gray-500 pt-2">
                          Posted {formatMoney(posted)} · Remaining{" "}
                          {formatMoney(remaining)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 rounded-md bg-gray-50 border border-gray-200 p-4 max-w-md">
                  <div className="flex justify-between text-sm">
                    <span>Amount</span>
                    <span>{formatMoney(totals.amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span>HST</span>
                    <span>{formatMoney(totals.hst)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-gray-200">
                    <span>Total</span>
                    <span>{formatMoney(totals.total)}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-3">
                    Other fees: Credit selected G/L (amount) / Debit 12100
                    (total) / Credit 23000 (HST). Commission deduction: Debit
                    12100 (amount) / Debit 23000 (HST) / Credit selected G/L
                    (total). Garnishment &amp; bank charges: no HST.
                  </p>
                </div>

                <div className="flex justify-end gap-3 mt-4">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-50"
                    disabled={posting}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={handlePost}
                    disabled={posting}
                    className="px-5 py-2 rounded-md bg-blue-900 text-white text-sm font-semibold hover:bg-blue-800 disabled:opacity-60"
                  >
                    {posting ? "Posting..." : "Post Expense"}
                  </button>
                </div>
              </div>
            </div>

            {/* Recent table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900">
                Recent Agent Expenses
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Applied = office expenses recovered when saved on a trade
                (Agent Commission). Balance = Total − Applied (remaining).
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      {[
                        "AE #",
                        "Invoice #",
                        "Agent",
                        "G/L",
                        "Invoice Date",
                        "Post Date",
                        "Total",
                        "Applied",
                        "Balance",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left border border-gray-200 font-medium"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="px-3 py-4 text-center text-gray-500"
                        >
                          No agent expenses posted yet.
                        </td>
                      </tr>
                    ) : (
                      expenses.map((row) => (
                        <tr key={row._id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 border border-gray-200">
                            {row.aeNumber}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {row.invoiceNumber}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {row.agentName}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {row.glAccount}
                            {row.glAccountName
                              ? ` ${row.glAccountName}`
                              : ""}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {formatDisplayDate(row.invoiceDate)}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {formatDisplayDate(row.postDate)}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {formatMoney(row.total)}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {formatMoney(row.applied)}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {formatMoney(
                              row.balance ??
                                (row.total || 0) - (row.applied || 0),
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals by type + print filters */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900">
                Expense Totals by Type
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Total / Applied / Balance for each office expense, by agent.
                Applied updates when office expenses are saved on a trade.
              </p>

              <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">
                  Print Expense Report
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Agent
                    </label>
                    <Select
                      styles={selectStyles}
                      options={agentOptions}
                      value={
                        agentOptions.find(
                          (o) => o.value === reportFilters.agentId,
                        ) || null
                      }
                      onChange={(opt) =>
                        setReportFilters((p) => ({
                          ...p,
                          agentId: opt?.value || "",
                        }))
                      }
                      placeholder="Select agent..."
                      isClearable
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      From (invoice date)
                    </label>
                    <input
                      type="date"
                      value={reportFilters.from}
                      onChange={(e) =>
                        setReportFilters((p) => ({
                          ...p,
                          from: e.target.value,
                        }))
                      }
                      className="border border-gray-300 rounded-md px-3 py-2 w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      To (invoice date)
                    </label>
                    <input
                      type="date"
                      value={reportFilters.to}
                      onChange={(e) =>
                        setReportFilters((p) => ({
                          ...p,
                          to: e.target.value,
                        }))
                      }
                      className="border border-gray-300 rounded-md px-3 py-2 w-full text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handlePrintReport}
                    className="px-4 py-2 rounded-md bg-blue-900 text-white text-sm font-semibold hover:bg-blue-800"
                  >
                    Print Report
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Leave dates empty to include all invoices for the selected
                  agent.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      {[
                        "Agent",
                        "Expense",
                        "Total",
                        "Applied",
                        "Balance",
                        "Trades",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left border border-gray-200 font-medium"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {totalsByType.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-4 text-center text-gray-500"
                        >
                          No expense totals yet.
                        </td>
                      </tr>
                    ) : (
                      totalsByType.map((row, idx) => (
                        <tr
                          key={`${row.agentId}-${row.expenseKey}-${idx}`}
                          className="hover:bg-gray-50"
                        >
                          <td className="px-3 py-2 border border-gray-200">
                            {row.agentName}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {row.expense}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {formatMoney(row.total)}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {formatMoney(row.applied)}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {formatMoney(row.balance)}
                          </td>
                          <td className="px-3 py-2 border border-gray-200">
                            {row.trades || ""}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Print preview modal — matches Agent Expense Report layout */}
          {showPrintReport && (
            <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-4 print:static print:inset-auto print:bg-white print:p-0 print:overflow-visible">
              <div className="bg-white w-full max-w-[1100px] my-2 rounded-lg shadow-xl print:shadow-none print:my-0 print:max-w-none print:rounded-none print:w-full">
                <div
                  id="agent-expense-report-print"
                  className="p-5 sm:p-8 text-black bg-white"
                >
                  <div className="text-center mb-3">
                    <div className="text-base font-semibold tracking-tight">
                      {companyName}
                    </div>
                    <div className="text-lg font-bold mt-0.5">
                      Agent Expense Report
                    </div>
                    <div className="text-sm mt-2">Agent: {reportAgentLabel}</div>
                    <div className="text-sm">Period: {reportPeriodLabel}</div>
                    <div className="text-sm">
                      Printed: {formatDisplayDate(new Date())}
                    </div>
                  </div>

                  <hr className="border-gray-300 mb-5" />

                  <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
                    <div className="border border-gray-300 rounded-lg px-3 sm:px-5 py-3 sm:py-4 text-center">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">
                        Total Expenses
                      </div>
                      <div className="text-lg sm:text-xl font-bold mt-1">
                        {formatMoney(reportSummary.total)}
                      </div>
                    </div>
                    <div className="border border-gray-300 rounded-lg px-3 sm:px-5 py-3 sm:py-4 text-center">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">
                        Applied
                      </div>
                      <div className="text-lg sm:text-xl font-bold mt-1">
                        {formatMoney(reportSummary.applied)}
                      </div>
                    </div>
                    <div className="border border-gray-300 rounded-lg px-3 sm:px-5 py-3 sm:py-4 text-center">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">
                        Balance
                      </div>
                      <div className="text-lg sm:text-xl font-bold mt-1">
                        {formatMoney(reportSummary.balance)}
                      </div>
                    </div>
                  </div>

                  <table className="agent-expense-report-table w-full border-collapse table-fixed">
                    <colgroup>
                      <col style={{ width: "6%" }} />
                      <col style={{ width: "6%" }} />
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "7%" }} />
                      <col style={{ width: "6.5%" }} />
                      <col style={{ width: "6.5%" }} />
                      <col style={{ width: "6.5%" }} />
                      <col style={{ width: "6.5%" }} />
                      <col style={{ width: "7%" }} />
                      <col style={{ width: "7%" }} />
                      <col style={{ width: "6%" }} />
                      <col style={{ width: "7%" }} />
                      <col style={{ width: "7%" }} />
                      <col style={{ width: "7%" }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-gray-100">
                        {[
                          "AE #",
                          "Invoice #",
                          "Invoice Date",
                          "Applied Trades",
                          "Desk fee",
                          "Courier fee",
                          "Bank charge",
                          "Other fee",
                          "Commission deduction",
                          "Garnishment",
                          "HST",
                          "Total",
                          "Applied",
                          "Balance",
                        ].map((h) => (
                          <th
                            key={h}
                            className="border border-gray-300 px-0.5 py-1 font-semibold text-gray-800 text-left align-bottom leading-tight"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reportInvoices.length === 0 ? (
                        <tr>
                          <td
                            colSpan={14}
                            className="border border-gray-300 px-2 py-4 text-center text-gray-500"
                          >
                            No invoices for this agent / period.
                          </td>
                        </tr>
                      ) : (
                        reportInvoices.map((row) => (
                          <tr key={row._id}>
                            <td className="border border-gray-300 px-0.5 py-1">
                              {row.aeNumber}
                            </td>
                            <td className="border border-gray-300 px-0.5 py-1">
                              {row.invoiceNumber}
                            </td>
                            <td className="border border-gray-300 px-0.5 py-1">
                              {formatDisplayDate(row.invoiceDate)}
                            </td>
                            <td className="border border-gray-300 px-0.5 py-1 break-words">
                              {(row.appliedTrades || []).join(", ") || "—"}
                            </td>
                            {EXPENSE_FIELDS.map((f) => (
                              <td
                                key={f.key}
                                className="border border-gray-300 px-0.5 py-1 text-right tabular-nums"
                              >
                                {Number(row.lines?.[f.key] || 0).toFixed(2)}
                              </td>
                            ))}
                            <td className="border border-gray-300 px-0.5 py-1 text-right tabular-nums">
                              {Number(row.hst || 0).toFixed(2)}
                            </td>
                            <td className="border border-gray-300 px-0.5 py-1 text-right tabular-nums font-medium">
                              {Number(row.total || 0).toFixed(2)}
                            </td>
                            <td className="border border-gray-300 px-0.5 py-1 text-right tabular-nums">
                              {Number(row.applied || 0).toFixed(2)}
                            </td>
                            <td className="border border-gray-300 px-0.5 py-1 text-right tabular-nums">
                              {Number(
                                row.balance ??
                                  (row.total || 0) - (row.applied || 0),
                              ).toFixed(2)}
                            </td>
                          </tr>
                        ))
                      )}
                      <tr className="bg-gray-50 font-semibold">
                        <td
                          className="border border-gray-300 px-0.5 py-1.5"
                          colSpan={4}
                        >
                          Totals ({reportInvoices.length} invoice
                          {reportInvoices.length === 1 ? "" : "s"})
                        </td>
                        {EXPENSE_FIELDS.map((f) => (
                          <td
                            key={f.key}
                            className="border border-gray-300 px-0.5 py-1.5 text-right tabular-nums"
                          >
                            {reportInvoices
                              .reduce(
                                (s, r) => s + (Number(r.lines?.[f.key]) || 0),
                                0,
                              )
                              .toFixed(2)}
                          </td>
                        ))}
                        <td className="border border-gray-300 px-0.5 py-1.5 text-right tabular-nums">
                          {reportInvoices
                            .reduce((s, r) => s + (Number(r.hst) || 0), 0)
                            .toFixed(2)}
                        </td>
                        <td className="border border-gray-300 px-0.5 py-1.5 text-right tabular-nums">
                          {reportSummary.total.toFixed(2)}
                        </td>
                        <td className="border border-gray-300 px-0.5 py-1.5 text-right tabular-nums">
                          {reportSummary.applied.toFixed(2)}
                        </td>
                        <td className="border border-gray-300 px-0.5 py-1.5 text-right tabular-nums">
                          {reportSummary.balance.toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="px-5 sm:px-8 pb-6 flex gap-2 print:hidden">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-4 py-2 bg-blue-900 text-white rounded hover:bg-blue-800 text-sm font-medium"
                  >
                    Print
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPrintReport(false)}
                    className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>

              <style>{`
                .agent-expense-report-table {
                  font-size: 9px;
                  width: 100%;
                }
                .agent-expense-report-table th,
                .agent-expense-report-table td {
                  word-wrap: break-word;
                  overflow-wrap: anywhere;
                }
                @media print {
                  @page {
                    size: portrait;
                    margin: 0.4in;
                  }
                  body * {
                    visibility: hidden !important;
                  }
                  #agent-expense-report-print,
                  #agent-expense-report-print * {
                    visibility: visible !important;
                  }
                  #agent-expense-report-print {
                    position: absolute !important;
                    left: 0 !important;
                    top: 0 !important;
                    width: 100% !important;
                    padding: 0 !important;
                  }
                  .agent-expense-report-table {
                    font-size: 7.5px !important;
                  }
                }
              `}</style>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentExpenses;
