const mongoose = require("mongoose");
const { MetaDataSchema } = require("./MetaData");

const discountSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },
    value: {
      type: Number,
      required: true,
    },
  },
  {
    _id: false,
    versionKey: false,
  }
);

const ProductSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    images: [{ type: String, default: null }],
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand" },
    description: { type: String, required: true },
    shortDescription: { type: String, default: null },
    regularPrice: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    discountPrice: { type: Number, default: null },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    slug: { type: String, default: "" },
    packageHeight: { type: String, default: null },
    packageWeight: { type: String, default: null },
    packageWidth: { type: String, default: null },
    packageLength: { type: String, default: null },
    // tags: [{ type: String, default: null }],
    warrantyPolicy: { type: String, default: null },
    warrantyTime: { type: String, default: null },
    warrantyType: { type: String, default: null },
    status: {
      type: String,
      enum: ["published", "unpublished"],
      default: "unpublished",
    },
    metaData: {
      type: MetaDataSchema,
      default: {},
    },
  },
  { timestamps: true, versionKey: false }
);
ProductSchema.pre("save", function (next) {
  if (this.isModified("title")) {
    this.slug = this.title.toLowerCase().replace(/ /g, "-");
  }
  next();
});
ProductSchema.pre("updateOne", function (next) {
  if (this._update.title) {
    this._update.slug = this._update.title.toLowerCase().replace(/ /g, "-");
  }
  next();
});
ProductSchema.pre("findOneAndUpdate", function (next) {
  if (this._update.title) {
    this._update.slug = this._update.title.toLowerCase().replace(/ /g, "-");
  }
  next();
});


ProductSchema.index(
  {
    title: "text",
    description: "text",
    "category.name": "text",
    "brand.name": "text",
  },
  {
    weights: {
      title: 5,
      description: 2,
      "category.name": 3,
      "brand.name": 4,
    },
  }
);
module.exports = mongoose.model("Product", ProductSchema);
