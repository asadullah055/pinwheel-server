const mongoose = require("mongoose");

const sellerSchema = new mongoose.Schema(
  {
    shopName: {
      type: String,
      required: true,
      trim: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    shopLogo: {
      type: String, // Image URL / Cloudinary URL
      default: null,
    },
    businessType: {
      type: String,
      enum: ["Individual", "Company"],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Seller", sellerSchema);
