const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const createError = require("http-errors");
const Users = require("../model/Users");
const { accessSecretKey } = require("../../secret");

const authenticate = async (req) => {
  const token = req.cookies?.accessToken;
  if (!token) throw createError(401, "Please log in");
  let decoded;
  try { decoded = jwt.verify(token, accessSecretKey, { algorithms: ["HS256"] }); }
  catch { throw createError(401, "Invalid or expired session. Please log in"); }
  if (decoded.type !== "access" || !Number.isInteger(decoded.tokenVersion) || !mongoose.isObjectIdOrHexString(decoded.id)) {
    throw createError(401, "Invalid session. Please log in");
  }
  const user = await Users.findById(decoded.id).select("email role +tokenVersion");
  if (!user || Number(user.tokenVersion || 0) !== decoded.tokenVersion) {
    throw createError(401, "Session revoked. Please log in");
  }
  req.id = String(user._id);
  req.email = user.email;
  req.role = user.role;
  req.user = user;
};
const protect = async (req, res, next) => {
  try { await authenticate(req); next(); } catch (error) { next(error); }
};
const optionalProtect = async (req, res, next) => {
  if (!req.cookies?.accessToken) return next();
  try { await authenticate(req); return next(); }
  catch (error) { return error.status === 401 ? next() : next(error); }
};
const adminOnly = (req, res, next) =>
  req.role === "admin" ? next() : next(createError(403, "Access denied, admin only"));
module.exports = { protect, optionalProtect, adminOnly };
