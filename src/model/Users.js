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
    role: { type: String, enum: ['user', 'admin'], default: "user" },
    refreshToken: {
      type: String,
    },
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
module.exports = mongoose.model("User", UserSchema);
