import React, { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "react-toastify";
import axiosInstance from "../config/axios";
import { LISTING_COMPLIANCE_DEAL_TYPES } from "../constants/listingComplianceChecklists";
import {
  buildListingCompliancePayload,
  canRemoveListingComplianceItem,
  computeListingComplianceStatus,
  defaultListingChecklistForDealType,
  resolveListingComplianceChecklist,
} from "../utils/listingComplianceUtils";
import ComplianceDeadlineInput from "./ComplianceDeadlineInput";

function listingTitle(listing) {
  if (!listing) return "Listing compliance";
  const num = listing.listingNumber ?? "";
  const sn = listing.address?.streetNumber || "";
  const st = listing.address?.streetName || "";
  const addr = [sn, st].filter(Boolean).join(" ");
  return addr ? `#${num} — ${addr}` : `#${num}`;
}

function ChecklistGroup({
  title,
  items,
  dealType,
  onToggle,
  onRemove,
  disabled,
}) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {title}
      </p>
      <ul className="space-y-2">
        {items.map((item) => {
          const removable = canRemoveListingComplianceItem(dealType, item);
          return (
            <li
              key={item.id}
              className="flex items-start gap-2 text-sm text-gray-800"
            >
              <input
                type="checkbox"
                checked={!!item.checked}
                onChange={() => onToggle(item.id)}
                disabled={disabled}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-900 focus:ring-blue-700"
              />
              <span className="flex-1">{item.label}</span>
              {removable && (
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  disabled={disabled}
                  className="text-xs text-red-600 hover:text-red-800 shrink-0"
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ListingComplianceModal = ({
  isOpen,
  listing,
  onClose,
  onSaved,
}) => {
  const [dealType, setDealType] = useState("");
  const [checklist, setChecklist] = useState([]);
  const [comments, setComments] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [newItemText, setNewItemText] = useState("");
  const [saving, setSaving] = useState(false);

  const loadFromListing = useCallback((item) => {
    const c = item?.compliance || {};
    const type = c.dealType || "";
    setDealType(type);
    setChecklist(resolveListingComplianceChecklist(type, c.checklist));
    setComments(c.comments || "");
    setDeadlineDate(c.deadlineDate || "");
  }, []);

  useEffect(() => {
    if (isOpen && listing) loadFromListing(listing);
  }, [isOpen, listing, loadFromListing]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const status = useMemo(
    () => computeListingComplianceStatus(checklist),
    [checklist],
  );

  const requiredItems = useMemo(
    () => checklist.filter((item) => !item.optional),
    [checklist],
  );
  const optionalItems = useMemo(
    () => checklist.filter((item) => item.optional),
    [checklist],
  );

  const statusBadgeClass =
    status === "Completed"
      ? "bg-green-100 text-green-800"
      : status === "Pending"
        ? "bg-amber-100 text-amber-900"
        : "bg-gray-100 text-gray-700";

  const requiredTitle =
    dealType === "sale"
      ? "Required forms for Sale"
      : dealType === "lease"
        ? "Required forms for Lease"
        : "Required forms";

  const handleDealTypeChange = (value) => {
    setDealType(value);
    setChecklist(value ? defaultListingChecklistForDealType(value) : []);
  };

  const toggleItem = (id) => {
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item,
      ),
    );
  };

  const removeItem = (id) => {
    const item = checklist.find((i) => i.id === id);
    if (!item || !canRemoveListingComplianceItem(dealType, item)) return;
    setChecklist((prev) => prev.filter((i) => i.id !== id));
  };

  const addCustomItem = () => {
    const label = newItemText.trim();
    if (!label) return;
    if (
      checklist.some(
        (item) => item.label.toLowerCase() === label.toLowerCase(),
      )
    ) {
      setNewItemText("");
      return;
    }
    setChecklist((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        label,
        checked: false,
        optional: true,
        isCustom: true,
      },
    ]);
    setNewItemText("");
  };

  const handleSave = async () => {
    if (!listing?._id) return;
    if (!dealType) {
      toast.error("Select Lease or Sale.");
      return;
    }
    setSaving(true);
    const compliance = buildListingCompliancePayload({
      dealType,
      checklist,
      comments,
      deadlineDate,
    });
    try {
      const res = await axiosInstance.put(
        `/listings/${listing._id}/compliance`,
        { compliance },
      );
      toast.success("Compliance saved.");
      onSaved?.(res.data);
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Failed to save compliance.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !listing) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-2xl max-w-xl w-full max-h-[min(90vh,720px)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">
              {listingTitle(listing)}
            </h2>
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
          <section className="rounded-lg border border-gray-200 bg-gray-50/80 p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wide">
                Compliance
              </h3>
              <span
                className={`text-xs font-semibold px-2 py-1 rounded-md ${statusBadgeClass}`}
              >
                Compliance: {status}
              </span>
            </div>

            <div className="bg-white rounded-md border border-gray-100 p-3 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Deal type
                </label>
                <select
                  value={dealType || ""}
                  onChange={(e) => handleDealTypeChange(e.target.value)}
                  disabled={saving}
                  className="block w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-700 focus:ring-blue-700"
                >
                  <option value="">Select Lease or Sale…</option>
                  {LISTING_COMPLIANCE_DEAL_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {dealType && (
                <div className="space-y-4">
                  <ChecklistGroup
                    title={requiredTitle}
                    items={requiredItems}
                    dealType={dealType}
                    onToggle={toggleItem}
                    onRemove={removeItem}
                    disabled={saving}
                  />
                  {optionalItems.length > 0 && (
                    <ChecklistGroup
                      title="Optional forms"
                      items={optionalItems}
                      dealType={dealType}
                      onToggle={toggleItem}
                      onRemove={removeItem}
                      disabled={saving}
                    />
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newItemText}
                      onChange={(e) => setNewItemText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomItem();
                        }
                      }}
                      disabled={saving}
                      placeholder="Add custom checklist item…"
                      className="flex-1 rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-700 focus:ring-blue-700"
                    />
                    <button
                      type="button"
                      onClick={addCustomItem}
                      disabled={saving || !newItemText.trim()}
                      className="px-3 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Add item
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Compliance deadline 
                </label>
                <ComplianceDeadlineInput
                  value={deadlineDate || ""}
                  onChange={setDeadlineDate}
                  disabled={saving}
                />
                <p className="text-xs text-gray-500 mt-1">
                  A reminder is added to the dashboard calendar 2 days before
                  this date when you save.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comments
                </label>
                <textarea
                  value={comments || ""}
                  onChange={(e) => setComments(e.target.value)}
                  disabled={saving}
                  rows={3}
                  placeholder="Enter comments…"
                  className="block w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-700 focus:ring-blue-700"
                />
              </div>
            </div>
          </section>
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
            disabled={saving}
            className="px-4 py-2 rounded-md bg-blue-900 text-white text-sm font-medium hover:bg-blue-950 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save compliance"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ListingComplianceModal;
