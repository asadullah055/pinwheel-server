const createError = require("http-errors");
const Users = require("../model/Users");
const bcrypt = require("bcryptjs");
const { successMessage } = require("../util/response");
const jwt = require("jsonwebtoken");
// Generate JWT Token

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

const register = async (req, res, next) => {
  try {
    const { email, password, name, profileImageUrl, shopLogo } = req.body;
    const newUser = new Users({
      name,
      email,
      password,
      profileImageUrl,
      shopLogo,
    });
    const exitUser = await Users.exists({ email: email });
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
    let options = {
      maxAge: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // would expire in 7days
      httpOnly: true, // The cookie is only accessible by the web server
      secure: true,
      sameSite: "None",
    };
    const token = generateToken(user._id);
    res.cookie("accessToken", token, options);
    successMessage(res, 200, {
      token,
      message: "Login success",
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};
const logout = async (req, res, next) => {
  try {
    console.log(req);
    
    res.clearCookie("accessToken");
    successMessage(res, 200, { message: "Logout successfully" });
  } catch (error) {
    next(error);
  }
};
module.exports = { register, login, logout };
