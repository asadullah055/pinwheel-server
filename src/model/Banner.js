const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema(
  {
    bannerType: {
      type: String,
      required: true,
      trim: true,
      enum: ["main", "side"],
    },
    bannerURL: {
      type: String,
      required: true,
    },
    targetUrl: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    priority: {
      type: Number,
      default: 0,
      min: 0,
      max: 10000,
      validate: Number.isSafeInteger,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);
module.exports = mongoose.model("Banner", bannerSchema);
