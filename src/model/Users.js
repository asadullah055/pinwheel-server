const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true, select: false },
    profileImageUrl: { type: String, default: null },
    shopLogo: { type: String, default: null },
    shopUrl: { type: String, default: "", trim: true, index: true },
    shopName: { type: String, default: "", trim: true },
    mobileNumber: { type: String, default: "", trim: true },
    shopLocation: { type: String, default: "", trim: true },
    holidayMode: { type: Boolean, default: false },
    holidayStartDate: { type: Date, default: null },
    holidayEndDate: { type: Date, default: null },
    nationalIdentityCardNo: { type: String, default: "", trim: true },
    idCopyFrontUrl: { type: String, default: null },
    idCopyBackUrl: { type: String, default: null },
    bankAccountName: { type: String, default: "", trim: true },
    bankAccountNumber: { type: String, default: "", trim: true },
    bankNameOrMfs: { type: String, default: "", trim: true },
    bankRoutingNumber: { type: String, default: "", trim: true },
    bankBranchName: { type: String, default: "", trim: true },
    otp: { type: String, default: null, select: false },
    otpExpires: { type: Date, default: null },
    otpPurpose: { type: String, enum: ["verify-email", "reset-password", null], default: null },
    otpAttempts: { type: Number, default: 0 },
    otpSentAt: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0, select: false },
    isVerified: { type: Boolean, default: false },
    role: { type: String, enum: ["seller", "admin"], default: "seller" },
    refreshToken: {
      type: String,
    },
    sellerId: { type: Number, default: null },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    unlockToken: { type: String, default: null },

  },
  { timestamps: true, versionKey: false }
);
UserSchema.pre("save", function (next) {
  const user = this;
  if (!user.isModified("password")) return next();
  bcrypt.genSalt(10, (err, salt) => {
    if (err) return next(err);
    bcrypt.hash(user.password, salt, (err, hash) => {
      if (err) return next(err);
      user.password = hash;
      next();
    });
  });
});
UserSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};
module.exports = mongoose.model("User", UserSchema);
