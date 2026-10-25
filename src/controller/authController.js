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
const { generateUniqueSellerId } = require("../utils/sellerIdGenerator");
const { createSecureForm } = require("../utils/secureForm");
const { normalizeEmail, validatePassword, hashOtp, emailFilter, publicUserFields } = require("../utils/authSecurity");
const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require("../helper/cloudinary");

const getFormValue = (value) => {
  const normalizedValue = Array.isArray(value) ? value[0] : value;
  return typeof normalizedValue === "string" ? normalizedValue.trim() : "";
};

const createSlug = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const createUniqueShopUrl = async (shopName, userId) => {
  const baseSlug = createSlug(shopName) || `seller-${userId}`;
  let shopUrl = baseSlug;
  let suffix = 1;

  while (
    await Users.exists({
      _id: { $ne: userId },
      shopUrl,
    })
  ) {
    shopUrl = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return shopUrl;
};

const getOptionalDate = (value) => {
  const normalizedValue = getFormValue(value);
  if (!normalizedValue) return null;

  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isSupportedIdentityFile = (file) =>
  file?.mimetype?.startsWith("image/") || file?.mimetype === "application/pdf";

const register = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = validatePassword(req.body.password);
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) throw createError(400, "Name is required");
    if (await Users.exists(emailFilter(email))) throw createError(409, "User already exists");
    const user = await new Users({ name, email, password, role: "seller", sellerId: await generateUniqueSellerId() }).save();
    return successMessage(res, 201, { user: { _id: user._id, name: user.name, email: user.email, role: user.role }, message: "Registration Success" });
  } catch (error) { next(error.code === 11000 ? createError(409, "User already exists") : error); }
};

const clearOtp = { otp: null, otpExpires: null, otpPurpose: null, otpAttempts: 0 };
const issueOtp = async (user, purpose) => {
  const otp = crypto.randomInt(100000, 1000000).toString();
  const digest = hashOtp(otp);
  const issued = await Users.findOneAndUpdate({
    _id: user._id,
    $or: [{ otpSentAt: { $lte: new Date(Date.now() - 60000) } }, { otpSentAt: null }],
  }, { $set: { otp: digest, otpPurpose: purpose, otpExpires: new Date(Date.now() + 2 * 60 * 1000), otpAttempts: 0, otpSentAt: new Date() } }, { new: true });
  if (!issued) throw createError(429, "Please wait one minute before requesting another code");
  try {
    await sendEmail({ email: user.email, subject: purpose === "reset-password" ? "Password Reset OTP" : "Email Verification OTP",
      html: "<p>Your code is <strong>" + otp + "</strong>. It expires in two minutes.</p>" });
  } catch (error) {
    await Users.updateOne({ _id: user._id, otp: digest }, { $set: clearOtp });
    throw createError(503, "Unable to send the code. Please try again later");
  }
};
const claimOtpAttempt = async (email, otp, purpose) => {
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) throw createError(400, "Enter the six-digit code");
  const user = await Users.findOneAndUpdate({ ...emailFilter(email), otpPurpose: purpose,
    otpExpires: { $gt: new Date() }, otpAttempts: { $lt: 5 },
  }, { $inc: { otpAttempts: 1 } }, { new: true }).select("+otp");
  if (!user || user.otp !== hashOtp(otp)) throw createError(400, "Invalid or expired code. Please request a new one");
  return user;
};
const sendOtp = async (req, res, next) => {
  try {
    const user = await Users.findOne(emailFilter(normalizeEmail(req.body.email)));
    if (user && !user.isVerified) await issueOtp(user, "verify-email");
    return successMessage(res, 200, { message: "If this account needs verification, a code has been sent" });
  } catch (error) { next(error); }
};
const verifyEmail = async (req, res, next) => {
  try {
    const user = await Users.findById(req.id);
    if (!user) throw createError(404, "User not found");
    if (user.isVerified) throw createError(400, "Email already verified");
    await issueOtp(user, "verify-email");
    return successMessage(res, 200, { message: "Verification code sent" });
  } catch (error) { next(error); }
};
const verifyOTP = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await claimOtpAttempt(email, req.body.otp, "verify-email");
    const updated = await Users.findOneAndUpdate({ _id: user._id, otp: user.otp,
      otpPurpose: "verify-email", otpExpires: { $gt: new Date() },
    }, { $set: { ...clearOtp, isVerified: true } });
    if (!updated) throw createError(400, "Invalid or expired code");
    return successMessage(res, 200, { message: "Email verified successfully" });
  } catch (error) { next(error); }
};

const updateProfile = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (req.body.password !== undefined) throw createError(400, "Use the change-password form to update your password");
    const userId = req.id;
    const user = await Users.findById(userId);
    if (!user) {
      throw createError(404, "User not found");
    }
    user.name = name || user.name;
    await user.save();
    successMessage(res, 200, { message: "Profile updated successfully" });
  } catch (error) {
    next(error);
  }
};
// profile details
const profileDetails = async (req, res, next) => {
  try {
    const userId = req.id;
    const user = await Users.findById(userId).select(
      publicUserFields
    );
    if (!user) {
      throw createError(404, "User not found");
    }
    successMessage(res, 200, { user });
  } catch (error) {
    next(error);
  }
};

const getAllSellers = async (req, res, next) => {
  try {
    if (req.role !== "admin") {
      throw createError(403, "Only admin can view sellers");
    }

    const sellers = await Users.find({ role: "seller" })
      .select(
        "name email sellerId shopName shopLogo shopUrl mobileNumber shopLocation isVerified holidayMode createdAt"
      )
      .sort({ createdAt: -1 });

    successMessage(res, 200, {
      message: "Sellers fetched successfully",
      totalSellers: sellers.length,
      sellers,
    });
  } catch (error) {
    next(error);
  }
};

const updateSellerProfile = async (req, res, next) => {
  const form = createSecureForm("seller");

  return form.parse(req, async (parseError, fields, files) => {
    if (parseError) {
      return next(parseError);
    }

    try {
      const sellerName = getFormValue(fields.name);
      const shopName = getFormValue(fields.shopName);
      const mobileNumber = getFormValue(fields.mobileNumber);
      const shopLocation = getFormValue(fields.shopLocation);
      const holidayMode = getFormValue(fields.holidayMode) === "true";
      const holidayStartDate = getOptionalDate(fields.holidayStartDate);
      const holidayEndDate = getOptionalDate(fields.holidayEndDate);
      const nationalIdentityCardNo = getFormValue(
        fields.nationalIdentityCardNo
      );
      const bankAccountName = getFormValue(fields.bankAccountName);
      const bankAccountNumber = getFormValue(fields.bankAccountNumber);
      const bankNameOrMfs = getFormValue(fields.bankNameOrMfs);
      const bankRoutingNumber = getFormValue(fields.bankRoutingNumber);
      const bankBranchName = getFormValue(fields.bankBranchName);

      if (!sellerName || !shopName || !mobileNumber || !shopLocation) {
        throw createError(
          400,
          "Seller name, shop name, mobile number and address are required"
        );
      }

      if (!/^[+0-9][0-9\s-]{6,19}$/.test(mobileNumber)) {
        throw createError(400, "Please enter a valid mobile number");
      }

      if (holidayMode && (!holidayStartDate || !holidayEndDate)) {
        throw createError(400, "Holiday mode period is required");
      }

      if (
        holidayMode &&
        holidayStartDate &&
        holidayEndDate &&
        holidayEndDate < holidayStartDate
      ) {
        throw createError(400, "Holiday end date cannot be before start date");
      }

      const user = await Users.findById(req.id);
      if (!user) {
        throw createError(404, "User not found");
      }

      if (!user.sellerId) {
        user.sellerId = await generateUniqueSellerId();
      }

      const uploadedFile = Array.isArray(files.shopLogo)
        ? files.shopLogo[0]
        : files.shopLogo;
      const previousLogo = user.shopLogo;
      const idCopyFrontFile = Array.isArray(files.idCopyFront)
        ? files.idCopyFront[0]
        : files.idCopyFront;
      const idCopyBackFile = Array.isArray(files.idCopyBack)
        ? files.idCopyBack[0]
        : files.idCopyBack;
      const previousIdCopyFront = user.idCopyFrontUrl;
      const previousIdCopyBack = user.idCopyBackUrl;

      if (uploadedFile) {
        if (!uploadedFile.mimetype?.startsWith("image/")) {
          throw createError(400, "Shop logo must be an image file");
        }

        const uploadResult = await uploadToCloudinary(
          uploadedFile.filepath,
          "seller-logos"
        );
        user.shopLogo = uploadResult.secure_url;
      }

      if (idCopyFrontFile) {
        if (!isSupportedIdentityFile(idCopyFrontFile)) {
          throw createError(400, "Front side ID copy must be an image or PDF");
        }

        const uploadResult = await uploadToCloudinary(
          idCopyFrontFile.filepath,
          "seller-id-copies"
        );
        user.idCopyFrontUrl = uploadResult.secure_url;
      }

      if (idCopyBackFile) {
        if (!isSupportedIdentityFile(idCopyBackFile)) {
          throw createError(400, "Back side ID copy must be an image or PDF");
        }

        const uploadResult = await uploadToCloudinary(
          idCopyBackFile.filepath,
          "seller-id-copies"
        );
        user.idCopyBackUrl = uploadResult.secure_url;
      }

      user.name = sellerName;
      user.shopName = shopName;
      user.shopUrl = await createUniqueShopUrl(shopName, user._id);
      user.mobileNumber = mobileNumber;
      user.shopLocation = shopLocation;
      user.holidayMode = holidayMode;
      user.holidayStartDate = holidayMode ? holidayStartDate : null;
      user.holidayEndDate = holidayMode ? holidayEndDate : null;
      user.nationalIdentityCardNo = nationalIdentityCardNo;
      user.bankAccountName = bankAccountName;
      user.bankAccountNumber = bankAccountNumber;
      user.bankNameOrMfs = bankNameOrMfs;
      user.bankRoutingNumber = bankRoutingNumber;
      user.bankBranchName = bankBranchName;
      await user.save();

      if (uploadedFile && previousLogo && previousLogo !== user.shopLogo) {
        await deleteFromCloudinary(previousLogo);
      }

      if (
        idCopyFrontFile &&
        previousIdCopyFront &&
        previousIdCopyFront !== user.idCopyFrontUrl
      ) {
        await deleteFromCloudinary(previousIdCopyFront);
      }

      if (
        idCopyBackFile &&
        previousIdCopyBack &&
        previousIdCopyBack !== user.idCopyBackUrl
      ) {
        await deleteFromCloudinary(previousIdCopyBack);
      }

      const profile = await Users.findById(user._id).select(
        publicUserFields
      );

      return successMessage(res, 200, {
        message: "Seller profile updated successfully",
        user: profile,
      });
    } catch (error) {
      return next(error);
    }
  });
};

// change password get full code same times
const changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    validatePassword(newPassword);
    if (newPassword !== confirmPassword) throw createError(400, "Passwords do not match");
    if (typeof oldPassword !== "string") throw createError(400, "Old password is required");
    const user = await Users.findById(req.id).select("+password");
    if (!user || !await bcrypt.compare(oldPassword, user.password)) throw createError(401, "Invalid old password");
    const updated = await Users.findOneAndUpdate({ _id: user._id, password: user.password }, {
      $set: { password: await bcrypt.hash(newPassword, 10), ...clearOtp, refreshToken: null }, $inc: { tokenVersion: 1 },
    }, { new: true, runValidators: true });
    if (!updated) throw createError(409, "Credentials changed. Please log in again");
    sendToken.clear(res);
    return successMessage(res, 200, { message: "Password changed. Please log in again" });
  } catch (error) { next(error); }
};

const login = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;
    if (typeof password !== "string" || !password) throw createError(400, "Password is required");
    const user = await Users.findOne(emailFilter(email)).select(
      "+password +loginAttempts +lockUntil +unlockToken +tokenVersion"
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
        await Users.updateOne({ _id: user._id }, updates);
        try { await sendEmail(emailData); } catch { /* Lockout is already persisted. */ }
        throw createError(401, "Invalid email or password.");
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
      publicUserFields
    );
    successMessage(res, 200, {
      user: userWithoutPassword,
      message: "Login success",
    });
  } catch (err) {
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
    const user = await Users.findOne(emailFilter(normalizeEmail(req.body.email)));
    if (user) await issueOtp(user, "reset-password");
    return successMessage(res, 200, { message: "If this account exists, a password reset code has been sent" });
  } catch (error) { next(error); }
};
const resetPassword = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = validatePassword(req.body.newPassword);
    const user = await claimOtpAttempt(email, req.body.otp, "reset-password");
    const updated = await Users.findOneAndUpdate({ _id: user._id, otp: user.otp,
      otpPurpose: "reset-password", otpExpires: { $gt: new Date() },
    }, { $set: { password: await bcrypt.hash(password, 10), ...clearOtp, refreshToken: null,
      loginAttempts: 0, lockUntil: null, unlockToken: null }, $inc: { tokenVersion: 1 } }, { new: true, runValidators: true });
    if (!updated) throw createError(400, "Invalid or expired code");
    sendToken.clear(res);
    return successMessage(res, 200, { message: "Password reset successfully. Please log in" });
  } catch (error) { next(error); }
};
const logout = async (req, res, next) => {
  try {
    // Revoke all account sessions, including copied access/refresh tokens.
    await Users.updateOne({ _id: req.id }, { $inc: { tokenVersion: 1 }, $set: { refreshToken: null } });
    sendToken.clear(res);
    return successMessage(res, 200, { message: "Logged out successfully" });
  } catch (error) { next(error); }
};
const refreshAccessToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) throw createError(401, "Please log in");
    const decoded = jwt.verify(token, refreshSecretKey, { algorithms: ["HS256"] });
    if (decoded.type !== "refresh" || !Number.isInteger(decoded.tokenVersion)) throw createError(401, "Invalid session");
    const user = await Users.findById(decoded.id).select("+tokenVersion");
    if (!user || Number(user.tokenVersion || 0) !== decoded.tokenVersion) throw createError(401, "Session revoked");
    sendToken(res, await generateAccessToken(user), token);
    res.set("Cache-Control", "no-store");
    return successMessage(res, 200, { message: "Session refreshed" });
  } catch (error) {
    sendToken.clear(res);
    if (["JsonWebTokenError", "TokenExpiredError", "CastError"].includes(error.name) || error.status === 401) {
      return next(createError(401, "Invalid or expired session. Please log in"));
    }
    next(error);
  }
};

module.exports = {
  register,
  login,
  logout,
  refreshAccessToken,
  updateProfile,
  updateSellerProfile,
  profileDetails,
  getAllSellers,
  changePassword,
  verifyEmail,
  verifyOTP,
  forgotPassword,
  resetPassword,
  unlockAccount,
  sendOtp,
};
