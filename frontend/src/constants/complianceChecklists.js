/** Transaction types and default compliance checklist items for Progress Tracker. */

export const COMPLIANCE_TRANSACTION_TYPES = [
  { value: "offer-lease", label: "Offer for Lease" },
  { value: "offer-sale", label: "Offer for Sale" },
  { value: "cooperating-lease", label: "Cooperating - Lease" },
  { value: "cooperating-sale", label: "Cooperating - Sale" },
  { value: "pre-construction", label: "Pre - Construction" },
];

/** Required and optional forms per transaction type. */
export const COMPLIANCE_CHECKLIST_BY_TYPE = {
  "offer-sale": {
    required: [
      "APS",
      "Schedule A",
      "Schedule B",
      "Confirmation of Corporation",
      "Deposit slip",
      "Deposit receipt",
      "Buyer Lawyer information",
      "Seller lawyer information",
    ],
    optional: [
      "Reco Information Guide",
      "Waiver / NOF",
      "Amendment",
      "Sellers void cheque and email",
      "Mutual release",
    ],
  },
  "offer-lease": {
    required: [
      "Lease agreement",
      "Schedule A",
      "Schedule B",
      "Confirmation of Corporation",
      "Deposit slip",
      "Deposit receipt",
      "OTA",
    ],
    optional: [
      "Reco Information Guide",
      "Waiver / NOF",
      "Amendment",
      "Rental application",
      "Landlord void cheque",
    ],
  },
  "cooperating-sale": {
    required: [
      "Reco Information Guide",
      "Form 801",
      "FINTRAC",
      "Buyer representation agreement",
      "APS",
      "Schedule A",
      "Schedule B",
      "Confirmation of Corporation",
      "Deposit slip",
      "Deposit receipt",
      "Buyer Lawyer information",
      "Seller lawyer information",
    ],
    optional: ["Waiver / NOF", "Amendment", "Mutual release"],
  },
  "cooperating-lease": {
    required: [
      "Reco Information Guide",
      "Lease agreement",
      "Schedule A",
      "Schedule B",
      "Confirmation of Corporation",
      "Deposit slip",
      "Deposit receipt",
      "OTA",
    ],
    optional: ["Waiver / NOF", "Amendment", "Rental application"],
  },
  "pre-construction": {
    required: ["Referral agreement with builder", "APS"],
    optional: [
      "Referral agreement with other brokerage",
      "TCS",
      "RECO Information Guide",
      "FINTRAC",
    ],
  },
};

export function complianceTypeLabel(value) {
  return (
    COMPLIANCE_TRANSACTION_TYPES.find((t) => t.value === value)?.label || ""
  );
}

export function slugifyComplianceLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getDefaultLabelsForType(transactionType) {
  const config = COMPLIANCE_CHECKLIST_BY_TYPE[transactionType];
  if (!config) return { required: [], optional: [] };
  return {
    required: config.required || [],
    optional: config.optional || [],
  };
}
