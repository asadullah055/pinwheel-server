const express = require("express");
const {
  register,
  login,
  logout,
  refreshAccessToken,
  forgotPassword,
  sendOtp,
  resetPassword,
  verifyOTP,
  changePassword,
  updateProfile,
  profileDetails,
  verifyEmail,
} = require("../controller/authController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/refresh", refreshAccessToken);
router.post("/logout", protect, logout);
router.post("/forgot-password", forgotPassword);
router.post("send-otp", sendOtp);
router.post("/verify-otp", verifyOTP);
router.put("/update-password", protect, changePassword);
router.put("/update-profile", protect, updateProfile);
router.get("/profile", protect, profileDetails);
router.put('verify-email', protect, verifyEmail);
router.post("/reset-password", resetPassword);

module.exports = router;
