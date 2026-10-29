import {
  COMPLIANCE_CHECKLIST_BY_TYPE,
  getDefaultLabelsForType,
  slugifyComplianceLabel,
} from "../constants/complianceChecklists";

export function computeComplianceStatusFromChecklist(items = []) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return "No";
  const checkedCount = list.filter((item) => item?.checked).length;
  if (checkedCount === 0) return "No";
  if (checkedCount === list.length) return "Yes";
  return "Pending";
}

/** Map progress-report status to legacy complianceComplete (Trade Dashboard). */
export function complianceStatusToComplete(status) {
  if (status === "Yes") return "Complete";
  if (status === "Pending") return "Outstanding";
  return "No";
}

function labelToItem(label, optional) {
  return {
    id: slugifyComplianceLabel(label),
    label,
    checked: false,
    isCustom: false,
    optional: !!optional,
  };
}

export function defaultChecklistForType(transactionType) {
  const { required, optional } = getDefaultLabelsForType(transactionType);
  return [
    ...required.map((label) => labelToItem(label, false)),
    ...optional.map((label) => labelToItem(label, true)),
  ];
}

function inferOptionalFlag(transactionType, label) {
  const { optional } = getDefaultLabelsForType(transactionType);
  const lower = String(label || "").trim().toLowerCase();
  return optional.some((l) => l.toLowerCase() === lower);
}

function normalizeSavedItem(item, transactionType) {
  if (!item || typeof item !== "object") return null;
  const label = String(item.label || "").trim();
  if (!label) return null;
  const optional =
    item.isCustom === true ||
    item.optional === true ||
    (item.optional !== false && inferOptionalFlag(transactionType, label));
  return {
    id: String(item.id || slugifyComplianceLabel(label)),
    label,
    checked: item.checked === true,
    isCustom: item.isCustom === true,
    optional,
  };
}

/** Merge saved checklist with defaults when type is known. */
export function resolveComplianceChecklist(transactionType, savedItems) {
  if (!transactionType) {
    return [];
  }

  const defaults = defaultChecklistForType(transactionType);
  const saved = (savedItems || [])
    .map((item) => normalizeSavedItem(item, transactionType))
    .filter(Boolean);

  if (saved.length === 0) return defaults;

  const savedById = new Map(saved.map((item) => [item.id, item]));
  const mergedDefaults = defaults
    .filter((def) => {
      if (savedById.has(def.id)) return true;
      if (def.optional) return false;
      return true;
    })
    .map((def) => {
      const hit = savedById.get(def.id);
      if (hit) {
        savedById.delete(def.id);
        return { ...def, checked: hit.checked };
      }
      return def;
    });

  const extras = saved.filter((item) => {
    if (item.isCustom) return true;
    return !defaults.some((d) => d.id === item.id);
  });

  return [...mergedDefaults, ...extras];
}

export function canRemoveComplianceItem(_transactionType, item) {
  if (!item) return false;
  return item.optional === true || item.isCustom === true;
}

export function buildCompliancePayload({
  transactionType,
  checklist,
  comments,
  deadlineDate,
}) {
  const status = computeComplianceStatusFromChecklist(checklist);
  return {
    complianceTransactionType: transactionType || "",
    complianceChecklist: checklist || [],
    complianceComments: comments || "",
    complianceDeadlineDate: deadlineDate || "",
    complianceStatus: status,
    complianceComplete: complianceStatusToComplete(status),
  };
}
