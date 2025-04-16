const mongoose = require("mongoose");
const { MetaDataSchema } = require("./MetaData");
const BrandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    image: { type: String, default: null },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    slug: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    metaData: {
      type: MetaDataSchema,
      default: {},
    },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Brand", BrandSchema);
