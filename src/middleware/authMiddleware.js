const jwt = require("jsonwebtoken");
const createError = require("http-errors");
const { secretKey } = require("../../secret");
const Users = require("../model/Users");

const protect = async (req, res, next) => {
  try {
    const token = req.cookies.accessToken;

    if (!token) {
      throw createError(401, "Access token not found. Please log in.");
    }

    // Verify token and extract user data
    const decoded = jwt.verify(token, secretKey);
    const user = await Users.findById(decoded.id).select("-password");
    req.id = user.id;
    req.email = user.email;
    req.role = user.role;
    next();
  } catch (error) {
    console.log(error);

    if (error.name === "TokenExpiredError") {
      return next(createError(401, "This session has expired. Please log in."));
    }
    if (error.name === "JsonWebTokenError") {
      return next(createError(401, "Invalid token. Access denied."));
    }
    next(error);
  }
};
const adminOnly = (req, res, next) => {
  if (req.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied, admin only" });
  }
};
module.exports = { protect, adminOnly };
