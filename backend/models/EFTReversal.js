const mongoose = require("mongoose");

const eftReversalSchema = new mongoose.Schema(
  {
    section: {
      type: String,
      enum: [
        "real-estate",
        "commission",
        "general",
        "commission-received",
        "deposit-received",
      ],
      required: true,
    },
    tradeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trade",
      required: false,
    },
    tradeNumber: {
      type: String,
      required: false,
      default: "",
    },
    invoiceNumber: {
      type: String,
      required: false,
      default: "",
    },
    sourceEftNumber: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      default: "",
    },
    chequeDate: {
      type: Date,
      required: false,
    },
    reversedAt: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

eftReversalSchema.index(
  { section: 1, tradeId: 1, sourceEftNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { section: { $ne: "general" } },
  },
);

eftReversalSchema.index(
  { section: 1, invoiceNumber: 1, sourceEftNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { section: "general" },
  },
);

module.exports = mongoose.model("EFTReversal", eftReversalSchema);
