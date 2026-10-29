const mongoose = require("mongoose");

const EXPENSE_LINE_KEYS = [
  "deskFee",
  "courierFee",
  "bankCharge",
  "otherFee",
  "commissionDeduction",
  "garnishment",
];

const applicationSchema = new mongoose.Schema(
  {
    tradeNumber: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 },
    lines: {
      deskFee: { type: Number, default: 0 },
      courierFee: { type: Number, default: 0 },
      bankCharge: { type: Number, default: 0 },
      otherFee: { type: Number, default: 0 },
      commissionDeduction: { type: Number, default: 0 },
      garnishment: { type: Number, default: 0 },
    },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const agentExpenseSchema = new mongoose.Schema(
  {
    aeNumber: { type: String, required: true, unique: true },
    invoiceNumber: { type: String, required: true },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      required: true,
    },
    agentEmployeeNo: Number,
    agentName: { type: String, required: true },
    glAccount: { type: String, required: true },
    glAccountName: { type: String, default: "" },
    invoiceDate: { type: Date, required: true },
    postDate: { type: Date, required: true },
    taxRate: { type: Number, default: 13 },
    lines: {
      deskFee: { type: Number, default: 0 },
      courierFee: { type: Number, default: 0 },
      bankCharge: { type: Number, default: 0 },
      otherFee: { type: Number, default: 0 },
      commissionDeduction: { type: Number, default: 0 },
      garnishment: { type: Number, default: 0 },
    },
    amount: { type: Number, default: 0 },
    hst: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    applied: { type: Number, default: 0 },
    appliedTrades: { type: [String], default: [] },
    applications: { type: [applicationSchema], default: [] },
  },
  { timestamps: true }
);

agentExpenseSchema.virtual("balance").get(function () {
  return Math.round(((this.total || 0) - (this.applied || 0)) * 100) / 100;
});

agentExpenseSchema.methods.recomputeApplied = function () {
  const apps = this.applications || [];
  this.applied =
    Math.round(
      apps.reduce((s, a) => s + (Number(a.amount) || 0), 0) * 100,
    ) / 100;
  this.appliedTrades = [
    ...new Set(
      apps
        .map((a) => String(a.tradeNumber || "").trim())
        .filter(Boolean),
    ),
  ];
};

agentExpenseSchema.set("toJSON", { virtuals: true });
agentExpenseSchema.set("toObject", { virtuals: true });

const agentExpenseCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: "agentExpenseCounter" },
  seq: { type: Number, default: 1000 },
  invoiceSeq: { type: Number, default: 6000 },
});

agentExpenseCounterSchema.statics.getNextNumbers = async function () {
  const counter = await this.findByIdAndUpdate(
    { _id: "agentExpenseCounter" },
    { $inc: { seq: 1, invoiceSeq: 1 } },
    { new: true, upsert: true }
  );
  return {
    aeNumber: `AE${counter.seq}`,
    invoiceNumber: String(counter.invoiceSeq),
  };
};

agentExpenseCounterSchema.statics.peekNextNumbers = async function () {
  let counter = await this.findById("agentExpenseCounter");
  if (!counter) {
    counter = new this({
      _id: "agentExpenseCounter",
      seq: 1000,
      invoiceSeq: 6000,
    });
    await counter.save();
  }
  return {
    aeNumber: `AE${(counter.seq || 1000) + 1}`,
    invoiceNumber: String((counter.invoiceSeq || 6000) + 1),
  };
};

const AgentExpense = mongoose.model("AgentExpense", agentExpenseSchema);
const AgentExpenseCounter = mongoose.model(
  "AgentExpenseCounter",
  agentExpenseCounterSchema
);

module.exports = {
  AgentExpense,
  AgentExpenseCounter,
  EXPENSE_LINE_KEYS,
};
