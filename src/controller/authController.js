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
const { sendEmail } = require("../utils/sendEmail");
const crypto = require("crypto");

const register = async (req, res, next) => {
  try {
    const { email, password, name, role } = req.body;
    const newUser = new Users({
      name,
      email,
      password,
      role,
    });
    const exitEmail = await Users.exists({ email: email });
    const exitUser = await Users.exists({ email: email, role: role });
    if (exitUser || exitEmail) {
      throw createError(409, "User Already Exit");
    }
    const user = await newUser.save();
    successMessage(res, 200, { user, message: "Registration Success" });
  } catch (error) {
    next(error);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    const { email } = req.params;
    const user = await Users.findOne({ email });
    if (!user) {
      throw createError(404, "User not found");
    }
    if (user.isVerified === true) {
      throw createError(400, "Email already verified");
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await Users.findByIdAndUpdate(user._id, {
      otp,
      otpExpires: Date.now() + 2 * 60 * 1000, // OTP expires in 2 minutes
    });
    const emailData = {
      email: user.email,
      subject: "Email Verification OTP",
      html: `<p>Your OTP for email verification is <strong>${otp}</strong></p>`,
    };
    // sendEmail(email, otp);
    const sendEmail = await sendEmail(emailData);
    if (!sendEmail) {
      throw createError(500, "Failed to send OTP email");
    }
    successMessage(res, 200, {
      message: "OTP sent to your email",
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};
// verify OTP
const verifyOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.params;
    const user = await Users.findOne({ email });
    if (!user) {
      throw createError(404, "User not found");
    }
    if (user.otp !== otp) {
      throw createError(400, "Invalid OTP");
    }
    if (user.otpExpires < Date.now()) {
      throw createError(400, "OTP expired. Please request a new one.");
    }
    await Users.findByIdAndUpdate(
      user._id,
      { isVerified: true, otp: "0", otpExpires: null },
      { new: true }
    );

    successMessage(res, 200, {
      message: "Email verified successfully",
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

// send OTP for email verification
const sendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await Users.findOne({ email });
    if (!user) {
      throw createError(404, "User not found");
    }
    if (user.isVerified === true) {
      throw createError(400, "Email already verified");
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await Users.findByIdAndUpdate(user._id, {
      otp,
      otpExpires: Date.now() + 2 * 60 * 1000, // OTP expires in 2 minutes
    });
    const emailData = {
      email: user.email,
      subject: "Email Verification OTP",
      html: `<p>Your OTP for email verification is <strong>${otp}</strong></p>`,
    };
    // sendEmail(email, otp);
    const sendEmail = await sendEmail(emailData);
    if (!sendEmail) {
      throw createError(500, "Failed to send OTP email");
    }
    successMessage(res, 200, {
      message: "OTP sent to your email",
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const userId = req.user._id;
    const user = await Users.findById(userId);
    if (!user) {
      throw createError(404, "User not found");
    }
    if (email) {
      const existingUser = await Users.findOne({ email });
      if (existingUser && existingUser._id.toString() !== userId.toString()) {
        throw createError(409, "Email already in use");
      }
    }
    user.name = name || user.name;
    user.email = email || user.email;
    if (password) {
      user.password = password;
    }
    await user.save();
    successMessage(res, 200, { message: "Profile updated successfully" });
  } catch (error) {
    console.log(error);
    next(error);
  }
};
// profile details
const profileDetails = async (req, res, next) => {
  try {
    const userId = req.id;
    const user = await Users.findById(userId).select(
      "-password -createdAt -updatedAt -refreshToken -otp"
    );
    if (!user) {
      throw createError(404, "User not found");
    }
    successMessage(res, 200, { user });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

// change password get full code same times
const changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const userId = req.id;
    const user = await Users.findById({ _id: userId }).select("+password");
    if (!user) {
      throw createError(404, "User not found");
    }
    const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isPasswordValid) {
      throw createError(401, "Invalid old password.");
    }
    if (newPassword !== confirmPassword) {
      throw createError(400, "New password and confirm password do not match.");
    }

    await Users.findByIdAndUpdate(
      userId,
      { password: newPassword },
      { new: true }
    );
    successMessage(res, 200, {
      message: "Password changed successfully",
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await Users.findOne({ email }).select(
      "+password +loginAttempts +lockUntil +unlockToken"
    );

    if (!user) {
      throw createError(401, "Invalid email or password.");
    }

    if (user.lockUntil && user.lockUntil > Date.now()) {
      throw createError(
        403,
        `Account is locked until ${user.lockUntil.toLocaleString()}`
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      // increment attempts
      const updates = { $inc: { loginAttempts: 1 } };
      // if this was the 3rd bad try, set lockUntil + send email
      if (user.loginAttempts + 1 >= 3) {
        const lockUntil = new Date(Date.now() + 30 * 60 * 1000);
        const unlockToken = crypto.randomBytes(32).toString("hex");
        updates.$set = { lockUntil, unlockToken };
        const unlockLink = `${process.env.CLIENT_URL}/unlock-account?token=${unlockToken}&email=${user.email}`;
        const emailData = {
          email: user.email,
          subject: "Account Locked – Unlock Link",
          html: `
            <p>Your account has been locked due to 3 failed login attempts.</p>
            <p><a href="${unlockLink}">Click here to unlock your account</a></p>
          `,
        };
        await sendEmail(emailData);
      }
      await Users.updateOne({ _id: user._id }, updates);
      throw createError(401, "Invalid email or password.");
    }

    await Users.updateOne(
      { _id: user._id },
      {
        $set: {
          loginAttempts: 0,
          lockUntil: null,
          unlockToken: null,
        },
      }
    );

    const accessToken = await generateAccessToken(user);

    const refreshToken = await generateRefreshToken(user);

    sendToken(res, accessToken, refreshToken);
    const userWithoutPassword = await Users.findById(user._id).select(
      "-password -createdAt -updatedAt -refreshToken -otp"
    );
    successMessage(res, 200, {
      user: userWithoutPassword,
      message: "Login success",
    });
  } catch (err) {
    console.log(err);
    next(err);
  }
};

const unlockAccount = async (req, res, next) => {
  try {
    const { email, token } = req.query;
    const user = await Users.findOne({ email });
    if (!user || user.unlockToken !== token) {
      throw createError(400, "Invalid or expired unlock token");
    }
    await Users.updateOne(
      { email },
      {
        $set: {
          loginAttempts: 0,
          lockUntil: null,
          unlockToken: null,
        },
      }
    );
    successMessage(res, 200, {
      message: "Account successfully unlocked. You can now login.",
    });
  } catch (error) {
    next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await Users.findOne({ email });
    if (!user) {
      throw createError(404, "User not found");
    }
    // generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const updatedUser = await Users.findByIdAndUpdate(user._id, {
      otp,
      otpExpires: Date.now() + 2 * 60 * 1000, // OTP expires in 2 minutes
    });
    const emailData = {
      email: user.email,
      subject: "Password Reset OTP",
      html: `<p>Your OTP for password reset is <strong>${otp}</strong></p>`,
    };
    // sendEmail(email, otp);
    const sendEmail = await sendEmail(emailData);
    if (!sendEmail) {
      throw createError(500, "Failed to send OTP email");
    }
    successMessage(res, 200, {
      message: "OTP sent to your email",
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};
const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await Users.findOne({ email });
    if (!user) {
      throw createError(404, "User not found");
    }
    if (user.otp !== otp) {
      throw createError(400, "Invalid OTP");
    }
    if (user.otpExpires < Date.now()) {
      throw createError(400, "OTP expired. Please request a new one.");
    }
    const updatedUser = await Users.findByIdAndUpdate(
      user._id,
      { password: newPassword, otp: "0", otpExpires: null },
      { new: true }
    );
    if (!updatedUser) {
      throw createError(500, "Failed to update password");
    }
    successMessage(res, 200, {
      message: "Password reset successfully",
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

const logout = async (req, res, next) => {
  console.log("Logout called");

  try {
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    successMessage(res, 200, { message: "Logout successfully" });
  } catch (error) {
    console.log(error);

    next(error);
  }
};

const refreshAccessToken = async (req, res) => {
  console.log("Refresh Access Token called");

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

module.exports = {
  register,
  login,
  logout,
  refreshAccessToken,
  updateProfile,
  profileDetails,
  changePassword,
  verifyEmail,
  verifyOTP,
  forgotPassword,
  resetPassword,
  unlockAccount,
  sendOtp,
};
