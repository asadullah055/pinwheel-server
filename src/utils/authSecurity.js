const crypto = require("crypto");
const createError = require("http-errors");

const normalizeEmail = (email) => {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw createError(400, "Please enter a valid email address");
  }
  return email.trim().toLowerCase();
};
const validatePassword = (password) => {
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    throw createError(400, "Password must have at least 8 characters and at most 72 UTF-8 bytes");
  }
  return password;
};
const hashOtp = (otp) => crypto.createHash("sha256").update(otp).digest("hex");
// Match accounts registered before email normalization was introduced.
const emailFilter = (email) => ({ email: new RegExp("^" + email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") });
const publicUserFields = "-password -refreshToken -otp -otpExpires -otpPurpose -otpAttempts -otpSentAt -tokenVersion -unlockToken -loginAttempts -lockUntil";
module.exports = { normalizeEmail, validatePassword, hashOtp, emailFilter, publicUserFields };
