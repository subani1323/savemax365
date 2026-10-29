export const LISTING_COMPLIANCE_DEAL_TYPES = [
  { value: "lease", label: "Lease" },
  { value: "sale", label: "Sale" },
];

export const LISTING_COMPLIANCE_CHECKLIST_BY_TYPE = {
  lease: {
    required: [
      "Listing agreement",
      "MLS data sheet",
      "RECO",
      "Appointment instruction",
      "MLS Listing Sheet",
    ],
    optional: ["Amendment to listing"],
  },
  sale: {
    required: [
      "Listing agreement",
      "MLS data sheet",
      "RECO",
      "FINTRAC",
      "Appointment instruction",
      "MLS Listing Sheet",
    ],
    optional: ["Amendment to listing"],
  },
};

export function slugifyListingComplianceLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getListingComplianceLabels(dealType) {
  const config = LISTING_COMPLIANCE_CHECKLIST_BY_TYPE[dealType];
  if (!config) return { required: [], optional: [] };
  return {
    required: config.required || [],
    optional: config.optional || [],
  };
}
