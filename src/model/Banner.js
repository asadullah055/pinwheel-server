const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema(
  {
    bannerType: {
      type: String,
      required: true,
      trim: true,
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
