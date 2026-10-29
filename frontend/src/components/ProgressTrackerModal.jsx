import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "react-toastify";
import axiosInstance from "../config/axios";
import { toCalendarIsoDay } from "../utils/tradeDashboardDates";
import ComplianceSection from "./ComplianceSection";
import {
  buildCompliancePayload,
  resolveComplianceChecklist,
} from "../utils/complianceUtils";

const formatProgressDate = (dateStr) => {
  if (!dateStr) return "—";
  const parts = String(dateStr).trim().split("-");
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d)) {
      const dt = new Date(y, m, d);
      if (!Number.isNaN(dt.getTime())) return dt.toLocaleDateString();
    }
  }
  return String(dateStr);
};

function eftLatestIsoDate(trade) {
  const serverIso = trade?.eftsLatestDateIso;
  if (serverIso && String(serverIso).trim()) return String(serverIso).trim();
  const list = [
    ...(trade.realEstateTrustEFTs || []),
    ...(trade.commissionTrustEFTs || []),
  ];
  let max = null;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    for (const raw of [e.chequeDate, e.date]) {
      if (raw == null) continue;
      const t = new Date(raw).getTime();
      if (!Number.isNaN(t) && (max === null || t > max)) max = t;
    }
  }
  if (max === null) return "";
  const d = new Date(max);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function getDealKind(classification) {
  if (classification === "CO-OPERATING SIDE") return "coop";
  return "listing";
}

function getLifecycleStage(trade) {
  const k = trade?.keyInfo || {};
  if (k.finalizedDate || trade?.isFinalized || k.status === "CLOSED") {
    return "closed";
  }
  if (k.firm === "Yes") return "firm";
  return "conditional";
}

const DEFAULT_PROGRESS = {
  complianceComplete: "No",
  complianceStatus: "No",
  complianceTransactionType: "",
  complianceChecklist: [],
  complianceComments: "",
  complianceDeadlineDate: "",
  depositReceiptIssued: "No",
  depositCoversCommission: "",
  openTRSSent: "No",
  openTRSSentDate: "",
  commissionInvoiceReceived: "No",
  commissionInvoiceReceivedDate: "",
  commissionInvoiceSentListing: "No",
  commissionInvoiceSentListingDate: "",
  commissionInvoiceSentCoop: "No",
  commissionInvoiceSentCoopDate: "",
  closingConfirmationReceived: "No",
  paymentReceivedDate: "",
  paymentConfirmationSentDate: "",
  closedTRSDate: "",
  fileCompleteDate: "",
  invoicedDate: "",
};

function mergeProgress(p) {
  return { ...DEFAULT_PROGRESS, ...(p || {}) };
}

/** Prefer progressTracker; fall back to legacy keyInfo for older trades */
function buildProgressFromTrade(t) {
  const pt = t?.progressTracker || {};
  const k = t?.keyInfo || {};
  const transactionType = pt.complianceTransactionType || "";
  const checklist = resolveComplianceChecklist(
    transactionType,
    pt.complianceChecklist,
  );
  const complianceFields = buildCompliancePayload({
    transactionType,
    checklist,
    comments: pt.complianceComments || "",
    deadlineDate: toCalendarIsoDay(pt.complianceDeadlineDate) || "",
  });
  return mergeProgress({
    ...pt,
    ...complianceFields,
    complianceChecklist: checklist,
    complianceDeadlineDate:
      toCalendarIsoDay(pt.complianceDeadlineDate) || "",
    openTRSSentDate:
      toCalendarIsoDay(pt.openTRSSentDate || pt.openTRSDate) || "",
    commissionInvoiceSentListingDate:
      toCalendarIsoDay(
        pt.commissionInvoiceSentListingDate || pt.invoicedDate,
      ) || "",
    commissionInvoiceSentCoopDate:
      toCalendarIsoDay(pt.commissionInvoiceSentCoopDate) || "",
    commissionInvoiceReceivedDate:
      toCalendarIsoDay(pt.commissionInvoiceReceivedDate) || "",
    paymentReceivedDate:
      toCalendarIsoDay(pt.paymentReceivedDate || k.paymentReceivedDate) || "",
    paymentConfirmationSentDate:
      toCalendarIsoDay(
        pt.paymentConfirmationSentDate || k.paymentConfirmationSentDate,
      ) || "",
    closedTRSDate: toCalendarIsoDay(pt.closedTRSDate || k.closedTRSDate) || "",
    fileCompleteDate:
      toCalendarIsoDay(pt.fileCompleteDate || k.fileCompleteDate) || "",
  });
}

function tradeTitle(trade) {
  if (!trade) return "Progress tracker";
  const tn = trade.tradeNumber ?? trade.keyInfo?.tradeNumber ?? "";
  const sn = trade.keyInfo?.streetNumber || "";
  const st = trade.keyInfo?.streetName || "";
  const addr = [sn, st].filter(Boolean).join(" ");
  return addr ? `Trade #${tn} — ${addr}` : `Trade #${tn}`;
}

const SelectRow = ({ label, value, onChange, options, disabled }) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-2 border-b border-gray-100 last:border-0">
    <span className="text-sm text-gray-700 shrink-0 pr-2">{label}</span>
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="block w-full sm:w-48 rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-700 focus:ring-blue-700 disabled:bg-gray-100"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

const ReadOnlyRow = ({ label, value }) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-2 border-b border-gray-100 last:border-0">
    <span className="text-sm text-gray-700">{label}</span>
    <span className="text-sm font-medium text-gray-900 text-right break-all">
      {value}
    </span>
  </div>
);

const DateRow = ({ label, value, onChange }) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-2 border-b border-gray-100 last:border-0">
    <span className="text-sm text-gray-700 shrink-0 pr-2">{label}</span>
    <input
      type="date"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full sm:w-48 rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-700 focus:ring-blue-700"
    />
  </div>
);

const Section = ({ title, children }) => (
  <section className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 mb-4 last:mb-0">
    <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wide mb-3">
      {title}
    </h3>
    <div className="bg-white rounded-md border border-gray-100 px-3 py-1">
      {children}
    </div>
  </section>
);

const ProgressTrackerModal = ({ isOpen, onClose, tradeId }) => {
  const [trade, setTrade] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(() => mergeProgress());
  const [saving, setSaving] = useState(false);
  const [complianceSaving, setComplianceSaving] = useState(false);
  const complianceSaveTimer = useRef(null);
  const skipComplianceAutoSave = useRef(false);
  const complianceInitialized = useRef(false);

  const load = useCallback(async () => {
    if (!tradeId) return;
    setLoading(true);
    try {
      const res = await axiosInstance.get(`/trades/${tradeId}/with-efts`);
      setTrade(res.data);
      setProgress(buildProgressFromTrade(res.data));
    } catch (e) {
      console.error(e);
      toast.error("Could not load trade for progress tracker.");
      setTrade(null);
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  useEffect(() => {
    if (isOpen && tradeId) {
      load();
    } else if (!isOpen) {
      setTrade(null);
      setProgress(mergeProgress());
      complianceInitialized.current = false;
    }
  }, [isOpen, tradeId, load]);

  useEffect(() => {
    complianceInitialized.current = false;
  }, [tradeId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const dealKind = useMemo(
    () => getDealKind(trade?.keyInfo?.classification),
    [trade],
  );
  const stage = useMemo(
    () => (trade ? getLifecycleStage(trade) : ""),
    [trade],
  );

  const depositCoversYes = progress.depositCoversCommission === "Yes";

  const persistProgress = useCallback(
    async (payload, { silent = false, complianceOnly = false } = {}) => {
      if (!trade?._id) return null;
      if (complianceOnly) setComplianceSaving(true);
      else setSaving(true);
      const body = { ...payload };
      if (depositCoversYes) body.commissionInvoiceSentListing = "N/A";
      try {
        const res = await axiosInstance.put(`/trades/${trade._id}`, {
          progressTracker: body,
        });
        skipComplianceAutoSave.current = true;
        setProgress(buildProgressFromTrade(res.data));
        if (!silent) toast.success(complianceOnly ? "Compliance saved." : "Progress saved.");
        return res.data;
      } catch (e) {
        console.error(e);
        toast.error(
          complianceOnly ? "Failed to save compliance." : "Failed to save progress.",
        );
        return null;
      } finally {
        if (complianceOnly) setComplianceSaving(false);
        else setSaving(false);
      }
    },
    [trade?._id, depositCoversYes],
  );

  const scheduleComplianceSave = useCallback(
    (nextProgress) => {
      if (complianceSaveTimer.current) {
        clearTimeout(complianceSaveTimer.current);
      }
      complianceSaveTimer.current = setTimeout(() => {
        const complianceFields = buildCompliancePayload({
          transactionType: nextProgress.complianceTransactionType,
          checklist: nextProgress.complianceChecklist,
          comments: nextProgress.complianceComments,
          deadlineDate: nextProgress.complianceDeadlineDate,
        });
        persistProgress(
          { ...nextProgress, ...complianceFields },
          { silent: true, complianceOnly: true },
        );
      }, 600);
    },
    [persistProgress],
  );

  useEffect(() => {
    return () => {
      if (complianceSaveTimer.current) clearTimeout(complianceSaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (skipComplianceAutoSave.current) {
      skipComplianceAutoSave.current = false;
      return;
    }
    if (!trade?._id || loading) return;
    if (!complianceInitialized.current) {
      complianceInitialized.current = true;
      return;
    }
    scheduleComplianceSave(progress);
  }, [
    progress.complianceTransactionType,
    progress.complianceChecklist,
    progress.complianceComments,
    progress.complianceDeadlineDate,
    trade?._id,
    loading,
    scheduleComplianceSave,
  ]);

  const setField = (field, value) => {
    setProgress((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "depositCoversCommission" && value === "Yes") {
        next.commissionInvoiceSentListing = "N/A";
      }
      if (field === "depositCoversCommission" && value !== "Yes") {
        if (prev.commissionInvoiceSentListing === "N/A") {
          next.commissionInvoiceSentListing = "No";
        }
      }
      if (field === "openTRSSent" && value !== "Yes") {
        next.openTRSSentDate = "";
      }
      if (field === "commissionInvoiceReceived" && value === "No") {
        next.commissionInvoiceReceivedDate = "";
      }
      if (
        field === "commissionInvoiceSentListing" &&
        value !== "Yes" &&
        value !== "N/A"
      ) {
        next.commissionInvoiceSentListingDate = "";
      }
      if (field === "commissionInvoiceSentCoop" && value !== "Yes") {
        next.commissionInvoiceSentCoopDate = "";
      }
      return next;
    });
  };

  const handleComplianceTransactionTypeChange = (transactionType, checklist) => {
    const complianceFields = buildCompliancePayload({
      transactionType,
      checklist,
      comments: progress.complianceComments,
      deadlineDate: progress.complianceDeadlineDate,
    });
    setProgress((prev) => ({
      ...prev,
      complianceTransactionType: transactionType,
      complianceChecklist: checklist,
      ...complianceFields,
    }));
  };

  const handleComplianceChecklistChange = (checklist) => {
    const complianceFields = buildCompliancePayload({
      transactionType: progress.complianceTransactionType,
      checklist,
      comments: progress.complianceComments,
      deadlineDate: progress.complianceDeadlineDate,
    });
    setProgress((prev) => ({
      ...prev,
      complianceChecklist: checklist,
      ...complianceFields,
    }));
  };

  const handleComplianceCommentsChange = (comments) => {
    setProgress((prev) => ({ ...prev, complianceComments: comments }));
  };

  const handleComplianceDeadlineChange = (deadlineDate) => {
    setProgress((prev) => ({ ...prev, complianceDeadlineDate: deadlineDate }));
  };

  const handleSave = async () => {
    if (!trade?._id) return;
    await persistProgress({ ...progress });
  };

  if (!isOpen) return null;

  const k = trade?.keyInfo || {};
  const eftDate = trade ? eftLatestIsoDate(trade) : "";
  const stageLabel =
    stage === "closed" ? "Closed" : stage === "firm" ? "Firm" : "Conditional";
  const dealKindLabel =
    dealKind === "coop" ? "Co-operating deal" : "Listing-side deal";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-tracker-modal-title"
        className="bg-white rounded-xl shadow-2xl max-w-xl w-full max-h-[min(90vh,720px)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2
              id="progress-tracker-modal-title"
              className="text-lg font-bold text-gray-900 truncate"
            >
              {loading ? "Loading…" : tradeTitle(trade)}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Full checklist for this trade. Manual items save here; dates come
              from Trade Key Info and linked EFTs.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Close"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
              Loading trade…
            </div>
          )}

          {!loading && trade && (
            <>
              <div className="flex flex-wrap gap-2 mb-4 text-xs">
                <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-800">
                  {dealKindLabel}
                </span>
                <span className="px-2 py-1 rounded-md bg-blue-50 text-blue-900 font-medium">
                  Current stage: {stageLabel}
                </span>
                <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-700">
                  {k.classification || "—"}
                </span>
              </div>
              {k.classification === "AGENT DOUBLE ENDER" && (
                <p className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
                  Agent Double Ender: checklist below uses listing-side rules.
                </p>
              )}

              <ComplianceSection
                transactionType={progress.complianceTransactionType}
                checklist={progress.complianceChecklist || []}
                comments={progress.complianceComments}
                deadlineDate={progress.complianceDeadlineDate}
                onTransactionTypeChange={handleComplianceTransactionTypeChange}
                onChecklistChange={handleComplianceChecklistChange}
                onCommentsChange={handleComplianceCommentsChange}
                onDeadlineChange={handleComplianceDeadlineChange}
                disabled={saving || complianceSaving}
              />

              {dealKind === "listing" && (
                <>
                  <Section title="Listing — conditional">
                    <SelectRow
                      label="Deposit receipt issued"
                      value={progress.depositReceiptIssued}
                      onChange={(v) => setField("depositReceiptIssued", v)}
                      options={[
                        { value: "No", label: "No" },
                        { value: "Yes", label: "Yes" },
                      ]}
                    />
                    <SelectRow
                      label="Deposit covers commission"
                      value={progress.depositCoversCommission || ""}
                      onChange={(v) => setField("depositCoversCommission", v)}
                      options={[
                        { value: "", label: "—" },
                        { value: "No", label: "No" },
                        { value: "Yes", label: "Yes" },
                      ]}
                    />
                  </Section>

                  <Section title="Listing — firm">
                    <SelectRow
                      label="Open TRS sent"
                      value={progress.openTRSSent}
                      onChange={(v) => setField("openTRSSent", v)}
                      options={[
                        { value: "No", label: "No" },
                        { value: "Yes", label: "Yes" },
                      ]}
                    />
                    <DateRow
                      label="Open TRS — date"
                      value={progress.openTRSSentDate}
                      onChange={(v) => setField("openTRSSentDate", v)}
                    />
                    <SelectRow
                      label="Commission invoice received"
                      value={progress.commissionInvoiceReceived}
                      onChange={(v) => setField("commissionInvoiceReceived", v)}
                      options={[
                        { value: "No", label: "No" },
                        { value: "Requested", label: "Requested" },
                        { value: "Yes", label: "Yes" },
                      ]}
                    />
                    <DateRow
                      label="Commission invoice received — date"
                      value={progress.commissionInvoiceReceivedDate}
                      onChange={(v) =>
                        setField("commissionInvoiceReceivedDate", v)
                      }
                    />
                    <SelectRow
                      label="Commission invoice sent"
                      value={
                        depositCoversYes
                          ? "N/A"
                          : progress.commissionInvoiceSentListing === "Yes" ||
                              progress.commissionInvoiceSentListing === "No"
                            ? progress.commissionInvoiceSentListing
                            : "No"
                      }
                      onChange={(v) =>
                        setField("commissionInvoiceSentListing", v)
                      }
                      disabled={depositCoversYes}
                      options={
                        depositCoversYes
                          ? [{ value: "N/A", label: "N/A" }]
                          : [
                              { value: "No", label: "No" },
                              { value: "Yes", label: "Yes" },
                            ]
                      }
                    />
                    <DateRow
                      label="Commission invoice sent — date"
                      value={progress.commissionInvoiceSentListingDate}
                      onChange={(v) =>
                        setField("commissionInvoiceSentListingDate", v)
                      }
                    />
                  </Section>

                  <Section title="Listing — closed">
                    <SelectRow
                      label="Closing confirmation received"
                      value={progress.closingConfirmationReceived}
                      onChange={(v) =>
                        setField("closingConfirmationReceived", v)
                      }
                      options={[
                        { value: "No", label: "No" },
                        { value: "Yes", label: "Yes" },
                      ]}
                    />
                    <ReadOnlyRow
                      label="Deal finalized — date"
                      value={formatProgressDate(k.finalizedDate)}
                    />
                    <ReadOnlyRow
                      label="EFTs issued — date (latest)"
                      value={formatProgressDate(eftDate)}
                    />
                    <DateRow
                      label="Payment confirmation sent — date"
                      value={progress.paymentConfirmationSentDate}
                      onChange={(v) =>
                        setField("paymentConfirmationSentDate", v)
                      }
                    />
                    <DateRow
                      label="Closed TRS — date"
                      value={progress.closedTRSDate}
                      onChange={(v) => setField("closedTRSDate", v)}
                    />
                    <DateRow
                      label="File complete — date"
                      value={progress.fileCompleteDate}
                      onChange={(v) => setField("fileCompleteDate", v)}
                    />
                  </Section>
                </>
              )}

              {dealKind === "coop" && (
                <>
                  <Section title="Co-op — conditional">
                    <p className="text-xs text-gray-500 py-2">
                      Compliance is tracked in the section above.
                    </p>
                  </Section>

                  <Section title="Co-op — firm">
                    <SelectRow
                      label="Open TRS sent"
                      value={progress.openTRSSent}
                      onChange={(v) => setField("openTRSSent", v)}
                      options={[
                        { value: "No", label: "No" },
                        { value: "Yes", label: "Yes" },
                      ]}
                    />
                    <DateRow
                      label="Open TRS — date"
                      value={progress.openTRSSentDate}
                      onChange={(v) => setField("openTRSSentDate", v)}
                    />
                    <SelectRow
                      label="Commission invoice sent"
                      value={progress.commissionInvoiceSentCoop}
                      onChange={(v) => setField("commissionInvoiceSentCoop", v)}
                      options={[
                        { value: "No", label: "No" },
                        { value: "Yes", label: "Yes" },
                      ]}
                    />
                    <DateRow
                      label="Commission invoice sent — date"
                      value={progress.commissionInvoiceSentCoopDate}
                      onChange={(v) =>
                        setField("commissionInvoiceSentCoopDate", v)
                      }
                    />
                  </Section>

                  <Section title="Co-op — closed">
                    <DateRow
                      label="Payment received — date"
                      value={progress.paymentReceivedDate}
                      onChange={(v) => setField("paymentReceivedDate", v)}
                    />
                    <ReadOnlyRow
                      label="Deal finalized — date"
                      value={formatProgressDate(k.finalizedDate)}
                    />
                    <ReadOnlyRow
                      label="EFTs issued — date (latest)"
                      value={formatProgressDate(eftDate)}
                    />
                    <DateRow
                      label="Payment confirmation sent — date"
                      value={progress.paymentConfirmationSentDate}
                      onChange={(v) =>
                        setField("paymentConfirmationSentDate", v)
                      }
                    />
                    <DateRow
                      label="Closed TRS — date"
                      value={progress.closedTRSDate}
                      onChange={(v) => setField("closedTRSDate", v)}
                    />
                    <DateRow
                      label="File complete — date"
                      value={progress.fileCompleteDate}
                      onChange={(v) => setField("fileCompleteDate", v)}
                    />
                  </Section>
                </>
              )}
            </>
          )}

          {!loading && !trade && tradeId && (
            <p className="text-sm text-red-600 py-8 text-center">
              Trade could not be loaded.
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 shrink-0 flex gap-3 justify-end bg-gray-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || complianceSaving || loading || !trade}
            className="px-4 py-2 rounded-md bg-blue-900 text-white text-sm font-medium hover:bg-blue-950 disabled:opacity-50"
          >
            {saving ? "Saving…" : complianceSaving ? "Saving compliance…" : "Save progress"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProgressTrackerModal;
