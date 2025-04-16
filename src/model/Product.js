const mongoose = require("mongoose");

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
    variants: [
      {
        name: { type: String, required: true },// color or size
        value: { type: String, required: true },// red or small
        price: { type: Number, required: true },
        stock: { type: Number, default: 0 },
        discount: { type: discountSchema, default: null },
        sku: { type: String, required: true },

      }
    ],

    description: { type: String, required: true },
    price: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    discount: { type: discountSchema, default: null },
    productType: {
      type: String,
      enum: ["simple_product", "variable_product"],
      required: true,
    },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    slug: { type: String, default: "" },
    status: {
      type: String,
      enum: ["published", "unpublished"],
      required: true,
    },
  },
  { timestamps: true, versionKey: false }
);
module.exports = mongoose.model("Product", ProductSchema);

