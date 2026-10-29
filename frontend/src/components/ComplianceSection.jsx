import React, { useMemo, useState } from "react";
import { COMPLIANCE_TRANSACTION_TYPES } from "../constants/complianceChecklists";
import {
  canRemoveComplianceItem,
  computeComplianceStatusFromChecklist,
  defaultChecklistForType,
} from "../utils/complianceUtils";
import ComplianceDeadlineInput from "./ComplianceDeadlineInput";

function ChecklistGroup({ title, items, transactionType, onToggle, onRemove, disabled }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {title}
      </p>
      <ul className="space-y-2">
        {items.map((item) => {
          const removable = canRemoveComplianceItem(transactionType, item);
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

const ComplianceSection = ({
  transactionType,
  checklist,
  comments,
  deadlineDate,
  onTransactionTypeChange,
  onChecklistChange,
  onCommentsChange,
  onDeadlineChange,
  disabled,
}) => {
  const [newItemText, setNewItemText] = useState("");

  const status = useMemo(
    () => computeComplianceStatusFromChecklist(checklist),
    [checklist],
  );

  const requiredItems = useMemo(
    () => checklist.filter((item) => !item.optional),
    [checklist],
  );
  const optionalItems = useMemo(
    () => checklist.filter((item) => item.optional && !item.isCustom),
    [checklist],
  );
  const customItems = useMemo(
    () => checklist.filter((item) => item.isCustom),
    [checklist],
  );

  const statusBadgeClass =
    status === "Yes"
      ? "bg-green-100 text-green-800"
      : status === "Pending"
        ? "bg-amber-100 text-amber-900"
        : "bg-gray-100 text-gray-700";

  const handleTypeChange = (value) => {
    const nextChecklist = value ? defaultChecklistForType(value) : [];
    onTransactionTypeChange(value, nextChecklist);
  };

  const toggleItem = (id) => {
    onChecklistChange(
      checklist.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item,
      ),
    );
  };

  const removeItem = (id) => {
    const item = checklist.find((i) => i.id === id);
    if (!item || !canRemoveComplianceItem(transactionType, item)) return;
    onChecklistChange(checklist.filter((i) => i.id !== id));
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
    onChecklistChange([
      ...checklist,
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

  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 mb-4">
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
            Transaction type
          </label>
          <select
            value={transactionType || ""}
            onChange={(e) => handleTypeChange(e.target.value)}
            disabled={disabled}
            className="block w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-700 focus:ring-blue-700 disabled:bg-gray-100"
          >
            <option value="">Select transaction type…</option>
            {COMPLIANCE_TRANSACTION_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {transactionType && (
          <div className="space-y-4">
            <ChecklistGroup
              title="Required forms"
              items={requiredItems}
              transactionType={transactionType}
              onToggle={toggleItem}
              onRemove={removeItem}
              disabled={disabled}
            />
            <ChecklistGroup
              title="Optional forms"
              items={optionalItems}
              transactionType={transactionType}
              onToggle={toggleItem}
              onRemove={removeItem}
              disabled={disabled}
            />
            <ChecklistGroup
              title="Additional forms"
              items={customItems}
              transactionType={transactionType}
              onToggle={toggleItem}
              onRemove={removeItem}
              disabled={disabled}
            />
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
                disabled={disabled}
                placeholder="Add custom checklist item…"
                className="flex-1 rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-700 focus:ring-blue-700"
              />
              <button
                type="button"
                onClick={addCustomItem}
                disabled={disabled || !newItemText.trim()}
                className="px-3 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Add item
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Compliance deadline (MM/DD/YYYY)
          </label>
          <ComplianceDeadlineInput
            value={deadlineDate || ""}
            onChange={onDeadlineChange}
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">
            A reminder appears on the dashboard 2 days before this date.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Comments
          </label>
          <textarea
            value={comments || ""}
            onChange={(e) => onCommentsChange(e.target.value)}
            disabled={disabled}
            rows={3}
            placeholder="Enter comments…"
            className="block w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-700 focus:ring-blue-700"
          />
        </div>
      </div>
    </section>
  );
};

export default ComplianceSection;
