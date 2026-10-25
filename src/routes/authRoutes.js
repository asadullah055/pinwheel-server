const { validateRequest } = require("../middleware/inputValidation");
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
  updateSellerProfile,
  profileDetails,
  getAllSellers,
  verifyEmail,
} = require("../controller/authController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", validateRequest("register"), register);
router.post("/login", validateRequest("login"), login);
router.get("/refresh", validateRequest("empty"), refreshAccessToken);
router.post("/logout",  protect, validateRequest("empty"), logout);
router.post("/forgot-password", validateRequest("email"), forgotPassword);
router.post("/send-otp", validateRequest("email"), sendOtp);
router.post("/verify-otp", validateRequest("otp"), verifyOTP);
router.put("/update-password",  protect, validateRequest("changePassword"), changePassword);
router.put("/update-profile",  protect, validateRequest("profile"), updateProfile);
router.put("/seller-profile",  protect, validateRequest("multipart"), updateSellerProfile);
router.get("/profile",  protect, validateRequest("empty"), profileDetails);
router.get("/sellers",  protect, validateRequest("empty"), getAllSellers);
router.put("/verify-email",  protect, validateRequest("empty"), verifyEmail);
router.post("/reset-password", validateRequest("resetPassword"), resetPassword);

module.exports = router;
