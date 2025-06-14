const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    profileImageUrl: { type: String, default: null },
    shopLogo: { type: String, default: null },
    otp: { type: String, default: "0" },
    otpExpires: { type: Date, default: null },
    isVerified: { type: Boolean, default: false },
    role: { type: String, enum: ["seller", "admin"], default: "seller" },
    refreshToken: {
      type: String,
    },
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
