const mongoose = require("mongoose");
const { MetaDataSchema } = require("./MetaData");

const CategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    image: { type: String, default: null },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    slug: { type: String, default: "" },
    metaData: {
      type: MetaDataSchema,
      default: {},
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Category", CategorySchema);
