const jwt = require("jsonwebtoken");
const createError = require("http-errors");
const { accessSecretKey } = require("../../secret");
const Users = require("../model/Users");

const protect = async (req, res, next) => {
  try {
    const token = req.cookies.accessToken;
 

    if (!token) {
      throw createError(401, "Access token not found. Please log in.");
    }

    // Verify token and extract user data
    const decoded = jwt.verify(token, accessSecretKey);
 

    if (!decoded) {
      throw createError(404, "Invalid Access token. Please Log in");
    }
    req.id = decoded.id;
    req.email = decoded.email;
    req.role = decoded.role;
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

/* const protect = async (req, res, next) => {
  console.log(req);
  
  try {
    const authHeader = await req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      throw createError(401, "Access token not found. Please log in.");

    const token = authHeader.split(" ")[1];
    jwt.verify(token, accessSecretKey, (err, decoded) => {
      if (err) throw createError(401, "Access token not found. Please log in.");
      req.user = decoded;
      next();
    });
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
}; */

const adminOnly = (req, res, next) => {
  if (req.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied, admin only" });
  }
};
module.exports = { protect, adminOnly };
