const createError = require("http-errors");
const Users = require("../model/Users");
const bcrypt = require("bcryptjs");
const { successMessage } = require("../utils/response");
const jwt = require("jsonwebtoken");
// const { accessSecretKey } = require("../../secret");
const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utils/generateToken");
const sendToken = require("../utils/sendToken");
const { refreshSecretKey } = require("../../secret");

const register = async (req, res, next) => {
  try {
    const { email, password, name, profileImageUrl, shopLogo, role } = req.body;
    const newUser = new Users({
      name,
      email,
      password,
      profileImageUrl,
      shopLogo,
      role,
    });
    const exitUser = await Users.exists({ email: email, role: role });
    if (exitUser) {
      throw createError(409, "User Already Exit");
    }
    const user = await newUser.save();
    successMessage(res, 200, { user, message: "Registration Success" });
  } catch (error) {
    console.log(error);
    next(error);
  }
};
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await Users.findOne({ email }).select("+password");
    if (!user) {
      throw createError(401, "Invalid email or password.");
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw createError(401, "Invalid email or password.");
    }

    const accessToken = await generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user);
   
    sendToken(res, accessToken, refreshToken);

    successMessage(res, 200, {
      user,
      message: "Login success",
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};
const logout = async (req, res, next) => {
  try {
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    successMessage(res, 200, { message: "Logout successfully" });
  } catch (error) {
    next(error);
  }
};

const refreshAccessToken = async (req, res) => {
  const token = req.cookies.refreshToken;
  

  if (!token) {
    throw createError(401, "Token Not Found");
  }

  try {
    const decoded = jwt.verify(token, refreshSecretKey);
    const user = await Users.findById(decoded.id);

    if (!user) throw createError(404, "User Not found");

    const newAccessToken = await generateAccessToken(user);
    sendToken(res, newAccessToken, token);
    successMessage(res, 200, {
      accessToken: newAccessToken,
      message: "token refresh success",
    });
  } catch (err) {
    res.clearCookie("refreshToken", {
      httpOnly: true,
      sameSite: "Strict",
      secure: true,
    });
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ message: "Session expired. Please log in again." });
    }
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports = { register, login, logout, refreshAccessToken };
