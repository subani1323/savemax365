const mongoose = require("mongoose");

const commissionRecallSchema = new mongoose.Schema(
  {
    tradeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trade",
      required: true,
    },
    tradeNumber: {
      type: String,
      required: true,
      default: "",
    },
    agentId: {
      type: String,
      required: true,
    },
    agentName: {
      type: String,
      required: true,
      default: "",
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    recallRef: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    recalledAt: {
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

commissionRecallSchema.index({ tradeId: 1, recallRef: 1 }, { unique: true });

module.exports = mongoose.model("CommissionRecall", commissionRecallSchema);
