import {
  getListingComplianceLabels,
  slugifyListingComplianceLabel,
} from "../constants/listingComplianceChecklists";

export function computeListingComplianceStatus(items = []) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return "No";
  const checkedCount = list.filter((item) => item?.checked).length;
  if (checkedCount === 0) return "No";
  if (checkedCount === list.length) return "Completed";
  return "Pending";
}

function labelToItem(label, optional, isCustom = false) {
  return {
    id: isCustom ? `custom-${slugifyListingComplianceLabel(label)}-${Date.now()}` : slugifyListingComplianceLabel(label),
    label,
    checked: false,
    optional: !!optional,
    isCustom,
  };
}

export function defaultListingChecklistForDealType(dealType) {
  const { required, optional } = getListingComplianceLabels(dealType);
  return [
    ...required.map((label) => labelToItem(label, false)),
    ...optional.map((label) => labelToItem(label, true)),
  ];
}

function inferOptionalFlag(dealType, label) {
  const { optional } = getListingComplianceLabels(dealType);
  const lower = String(label || "").trim().toLowerCase();
  return optional.some((l) => l.toLowerCase() === lower);
}

function normalizeSavedItem(item, dealType) {
  if (!item || typeof item !== "object") return null;
  const label = String(item.label || "").trim();
  if (!label) return null;
  const optional =
    item.optional === true ||
    item.isCustom === true ||
    (item.optional !== false && inferOptionalFlag(dealType, label));
  return {
    id: String(item.id || slugifyListingComplianceLabel(label)),
    label,
    checked: item.checked === true,
    optional,
    isCustom: item.isCustom === true,
  };
}

export function resolveListingComplianceChecklist(dealType, savedItems) {
  if (!dealType) return [];

  const defaults = defaultListingChecklistForDealType(dealType);
  const saved = (savedItems || [])
    .map((item) => normalizeSavedItem(item, dealType))
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

export function canRemoveListingComplianceItem(_dealType, item) {
  if (!item) return false;
  return item.optional === true || item.isCustom === true;
}

export function buildListingCompliancePayload({
  dealType,
  checklist,
  comments,
  deadlineDate,
}) {
  const status = computeListingComplianceStatus(checklist);
  return {
    dealType: dealType || "",
    checklist: checklist || [],
    comments: comments || "",
    deadlineDate: deadlineDate || "",
    status,
  };
}

export function getListingComplianceDisplayStatus(listing) {
  const compliance = listing?.compliance;
  if (!compliance) return "No";
  if (compliance.status) return compliance.status;
  if (compliance.dealType && compliance.checklist?.length) {
    return computeListingComplianceStatus(compliance.checklist);
  }
  return "No";
}

export function listingComplianceStatusBadgeClass(status) {
  if (status === "Completed") return "bg-green-100 text-green-800";
  if (status === "Pending") return "bg-amber-100 text-amber-900";
  return "bg-gray-100 text-gray-700";
}
