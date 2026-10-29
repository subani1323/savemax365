const mongoose = require("mongoose");

const KeyInfoSchema = new mongoose.Schema(
  {
    listingNumber: String,
    tradeNumber: { type: mongoose.Schema.Types.Mixed, required: false }, // Number (e.g. 279) or String (e.g. "279-A")
    status: String,
    streetNumber: String,
    streetName: String,
    unit: String,
    city: String,
    province: String,
    postalCode: String,
    offerDate: String,
    firmDate: String,
    closeDate: String,
    entryDate: String,
    finalizedDate: String,
    sellPrice: String,
    mlsNumber: String,
    propertyType: String,
    dealType: String,
    weManage: String,
    classification: String,
    firm: String,
    listCommission: String,
    sellCommission: String,
    preConstructionInstallments: Number, // 2 or 3 when pre-construction (stored on -A trade)
    /** When true, allow creating new EFTs even if EFTs already exist for the trade */
    voided: { type: Boolean, default: false },
  },
  { _id: false }
);

const ConditionSchema = new mongoose.Schema(
  {
    conditionText: { type: String, required: true },
    dueDate: { type: String, required: true },
    conditionMetDate: { type: String, default: "" },
  },
  { _id: false }
);

const PersonSchema = new mongoose.Schema(
  {
    type: String,
    firstName: String,
    lastName: String,
    email: String,
    primaryPhone: String,
    cellPhone: String,
    address: String,
    end: String,
    companyName: String,
  },
  { _id: false }
);

const BrokerSchema = new mongoose.Schema(
  {
    type: String,
    firstName: String,
    lastName: String,
    company: String,
    email: String,
    payBroker: String,
    end: String,
    primaryPhone: String,
    chargedHST: String,
    address: String,
    streetNumber: String,
    streetName: String,
    unitNumber: String,
    province: String,
    postalCode: String,
    sellingAmount: String,
    tax: String,
    total: String,
  },
  { _id: false }
);

const TrustRecordSchema = new mongoose.Schema(
  {
    weHold: String,
    heldBy: String,
    received: String,
    depositDate: String,
    receivedFrom: String,
    amount: String,
    reference: String,
    paymentType: String,
    currency: String,
    earnInterest: String,
    // Add more fields if needed
  },
  { _id: false }
);

const CommissionSchema = new mongoose.Schema(
  {
    saleClosingRows: Array,
    commissionIncomeRows: Array,
    outsideBrokersRows: Array,
    // Add more fields if needed
  },
  { _id: false }
);

const AgentCommissionSchema = new mongoose.Schema(
  {
    agentId: String,
    agentName: String,
    classification: String,
    transactionType: String, // "LISTING" or "SELLING" for AGENT DOUBLE ENDER
    ytdCommission: String,
    awardAmount: String,
    percentage: Number,
    amount: String,
    feeInfo: String,
    feesDeducted: String,
    tax: String,
    taxOnFees: String,
    total: String,
    totalFees: String,
    netCommission: String,
    lead: String,
    buyerRebateIncluded: String,
    buyerRebateAmount: String,
    officeExpenseAmounts: {
      deskFee: { type: Number, default: 0 },
      courierFee: { type: Number, default: 0 },
      bankCharge: { type: Number, default: 0 },
      otherFee: { type: Number, default: 0 },
      commissionDeduction: { type: Number, default: 0 },
      garnishment: { type: Number, default: 0 },
    },
    officeExpensesEnabled: { type: Boolean, default: false },
    officeExpenseTaxRate: { type: Number, default: 13 },
    officeExpenseSelected: {
      deskFee: { type: Boolean, default: false },
      courierFee: { type: Boolean, default: false },
      bankCharge: { type: Boolean, default: false },
      otherFee: { type: Boolean, default: false },
      commissionDeduction: { type: Boolean, default: false },
      garnishment: { type: Boolean, default: false },
    },
  },
  { _id: false }
);

const ComplianceChecklistItemSchema = new mongoose.Schema(
  {
    id: String,
    label: String,
    checked: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false },
    optional: { type: Boolean, default: false },
  },
  { _id: false },
);

const ProgressTrackerSchema = new mongoose.Schema(
  {
    complianceComplete: String,
    complianceStatus: String,
    complianceTransactionType: String,
    complianceChecklist: [ComplianceChecklistItemSchema],
    complianceComments: String,
    complianceDeadlineDate: String,
    depositReceiptIssued: String,
    depositCoversCommission: String,
    openTRSSent: String,
    openTRSSentDate: String,
    commissionInvoiceReceived: String,
    commissionInvoiceReceivedDate: String,
    commissionInvoiceSentListing: String,
    commissionInvoiceSentListingDate: String,
    commissionInvoiceSentCoop: String,
    commissionInvoiceSentCoopDate: String,
    closingConfirmationReceived: String,
    paymentReceivedDate: String,
    paymentConfirmationSentDate: String,
    closedTRSDate: String,
    fileCompleteDate: String,
    invoicedDate: String,
    action: String,
    followUpDate: String,
    notes: String,
    tradeCategory: String,
  },
  { _id: false }
);

const TradeSchema = new mongoose.Schema(
  {
    tradeNumber: { type: mongoose.Schema.Types.Mixed, required: true, unique: true }, // Number (e.g. 279) or String (e.g. "279-A")
    keyInfo: KeyInfoSchema,
    people: [PersonSchema],
    outsideBrokers: [BrokerSchema],
    trustRecords: [TrustRecordSchema],
    commission: CommissionSchema,
    agentCommissionList: [AgentCommissionSchema],
    progressTracker: ProgressTrackerSchema,
    conditions: [ConditionSchema],
    // EFT References
    realEstateTrustEFTs: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RealEstateTrustEFT",
      },
    ],
    commissionTrustEFTs: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "CommissionTrustEFT",
      },
    ],
    isFinalized: { type: Boolean, default: false },
    // User-set tax rate (e.g. 0.05 for 5%, 0.13 for 13%). When set, used for commission/agent HST calculations and EFTs.
    customTaxRate: { type: Number, required: false },
    /** Pad notes on Trade Details (name + timestamp + text). */
    tradeNotes: [
      {
        text: { type: String, default: "" },
        authorName: { type: String, default: "" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Trade", TradeSchema);
