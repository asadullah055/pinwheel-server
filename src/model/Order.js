const mongoose = require("mongoose");

const orderCounterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    seq: { type: Number, default: 999 },
  },
  { versionKey: false }
);

const OrderCounter =
  mongoose.models.OrderCounter ||
  mongoose.model("OrderCounter", orderCounterSchema);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: Number,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    sellers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    customer: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true, default: null },
    },
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        variant: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
        },
        sku: {
          type: String,
          trim: true,
        },
        attributes: {
          type: Map,
          of: String,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        price: {
          type: Number,
          required: true,
        },
      },
    ],
    totalAmount: {
      type: Number,
      required: true,
    },
    shippingFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    payableAmount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "Pending",
        "Processing",
        "Confirm",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Returned",
        "Refunded",
        "Failed",
        "Completed",
        "Awaiting Payment",
      ],
      default: "Pending",
    },
    stockAdjusted: {
      type: Boolean,
      default: false,
    },
    shippingAddress: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, required: true },
      division: { type: String, trim: true },
      district: { type: String, trim: true },
      upazila: { type: String, trim: true },
      area: { type: String, trim: true },
    },
    paymentMethod: {
      type: String,
      enum: ["Credit Card", "PayPal", "Cash on Delivery"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Failed"],
      default: "Pending",
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.pre("save", async function (next) {
  try {
    if (!this.isNew || this.orderNumber) return next();

    const counter = await OrderCounter.findOneAndUpdate(
      { _id: "orderNumber" },
      [
        {
          $set: {
            seq: { $add: [{ $ifNull: ["$seq", 999] }, 1] },
          },
        },
      ],
      {
        new: true,
        upsert: true,
      }
    );

    this.orderNumber = counter.seq;
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("Order", orderSchema);
