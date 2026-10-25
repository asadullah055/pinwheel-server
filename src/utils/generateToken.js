const jwt = require("jsonwebtoken");
const { accessSecretKey, refreshSecretKey } = require("../../secret");
const claims = (user, type) => ({
  id: String(user._id), email: user.email, role: user.role,
  tokenVersion: Number(user.tokenVersion || 0), type,
});
exports.generateAccessToken = async (user) =>
  jwt.sign(claims(user, "access"), accessSecretKey, { algorithm: "HS256", expiresIn: "15m" });
exports.generateRefreshToken = async (user) =>
  jwt.sign(claims(user, "refresh"), refreshSecretKey, { algorithm: "HS256", expiresIn: "30d" });
