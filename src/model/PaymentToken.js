const mongoose = require("mongoose");

// Shared by all serverless instances; never returned by any public endpoint.
module.exports = mongoose.model("PaymentToken", new mongoose.Schema({
  _id: String,
  idToken: String,
  refreshToken: String,
  expiresAt: Date,
  refreshExpiresAt: Date,
  lockUntil: Date,
  nextAttemptAt: Date,
}, { versionKey: false }));
