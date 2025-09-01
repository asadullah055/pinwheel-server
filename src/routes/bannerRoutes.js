const express = require("express");

const { protect, adminOnly } = require("../middleware/authMiddleware");

const { createBanner } = require("../controller/bannerController");

const router = express.Router();

// Get all brands
router.post("/create", protect, adminOnly, createBanner);

module.exports = router;
