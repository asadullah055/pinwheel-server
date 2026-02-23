const jwt = require("jsonwebtoken");
const createError = require("http-errors");
const { accessSecretKey } = require("../../secret");

const protect = async (req, res, next) => {
  try {
    const token = req.cookies.accessToken;

    if (!token) {
      throw createError(401, "Access token not found. Please log in.");
    }

    const decoded = jwt.verify(token, accessSecretKey);

    if (!decoded) {
      throw createError(404, "Invalid Access token. Please Log in");
    }

    req.id = decoded.id;
    req.email = decoded.email;
    req.role = decoded.role;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return next(createError(401, "This session has expired. Please log in."));
    }
    if (error.name === "JsonWebTokenError") {
      return next(createError(401, "Invalid token. Access denied."));
    }
    next(error);
  }
};

const optionalProtect = (req, res, next) => {
  try {
    const token = req.cookies?.accessToken;

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, accessSecretKey);

    if (decoded) {
      req.id = decoded.id;
      req.email = decoded.email;
      req.role = decoded.role;
    }

    return next();
  } catch (error) {
    return next();
  }
};

const adminOnly = (req, res, next) => {
  if (req.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied, admin only" });
  }
};

module.exports = { protect, optionalProtect, adminOnly };
