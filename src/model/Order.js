const crypto = require("crypto");
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
    checkoutRequestId: { type: String, unique: true, sparse: true, select: false },
    checkoutAccessHash: { type: String, select: false },
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
        seller: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
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
        regularPrice: {
          type: Number,
          default: null,
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
          default: true,
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
      fullAddress: { type: String, required: true, trim: true },
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      country: { type: String, trim: true },
      division: { type: String, trim: true },
      district: { type: String, trim: true },
      upazila: { type: String, trim: true },
      area: { type: String, trim: true },
    },
    paymentMethod: {
      type: String,
      enum: ["Credit Card", "PayPal", "Cash on Delivery", "bKash"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Partially Paid", "Paid", "Failed"],
      default: "Pending",
    },
    paymentPlan: { type: String, enum: ["COD", "Full", "Advance"], default: "COD" },
    paymentAmount: { type: Number, min: 0, default: 0 },
    paidAmount: { type: Number, min: 0, default: 0 },
    bkash: {
      senderNumber: { type: String, trim: true },
      transactionId: { type: String, trim: true, uppercase: true },
      paymentId: { type: String },
      checkoutUrl: { type: String },
      signature: { type: String, select: false },
      callbackToken: { type: String, select: false },
      executeStartedAt: { type: Date, default: null },
      lockUntil: { type: Date, default: null },
      lockId: { type: String, select: false },
      createdAt: { type: Date },
    },
    paymentVerifiedAt: { type: Date, default: null },
    invoiceAccessToken: {
      type: String,
      default: () => crypto.randomBytes(24).toString("hex"),
      select: false,
      index: true,
    },
    invoiceEmailSentAt: {
      type: Date,
      default: null,
    },
    invoiceEmailError: {
      type: String,
      default: null,
    },
    sellerNotificationSentAt: {
      type: Date,
      default: null,
    },
    sellerNotificationError: {
      type: String,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// A transaction can only fund one order, including concurrent submissions.
orderSchema.index({ createdAt: -1 });
orderSchema.index({ "items.seller": 1, createdAt: -1 });
orderSchema.index({ "items.product": 1, createdAt: -1 });
orderSchema.index(
  { "bkash.transactionId": 1 },
  { unique: true, partialFilterExpression: { "bkash.transactionId": { $type: "string" } } }
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
