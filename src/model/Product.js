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
    name: { type: String, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    images: [{ type: String, default: null }],
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand" },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    discount: { type: discountSchema, default: null },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    slug: { type: String, default: "" },
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
  if (this.isModified("name")) {
    this.slug = this.name.toLowerCase().replace(/ /g, "-");
  }
  next();
});
ProductSchema.pre("updateOne", function (next) {
  if (this._update.name) {
    this._update.slug = this._update.name.toLowerCase().replace(/ /g, "-");
  }
  next();
});
ProductSchema.pre("findOneAndUpdate", function (next) {
  if (this._update.name) {
    this._update.slug = this._update.name.toLowerCase().replace(/ /g, "-");
  }
  next();
});

ProductSchema.index(
  {
    name: "text",
    description: "text",
    "category.name": "text",
    "brand.name": "text",
  },
  {
    weights: {
      name: 5,
      description: 2,
      "category.name": 3,
      "brand.name": 4,
    },
  }
);
module.exports = mongoose.model("Product", ProductSchema);
