const express = require("express");
const { register, login, logout, refreshAccessToken } = require("../controller/authController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/refresh", refreshAccessToken);
router.post("/logout", protect, logout);
module.exports = router;
