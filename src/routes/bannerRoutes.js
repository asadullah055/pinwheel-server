const express = require("express");

const { protect, adminOnly } = require("../middleware/authMiddleware");

const { createBanner, getAllBanners, getBannerById, updateBanner, deleteBanner, toggleBannerStatus, updateBannerPriority, getActiveBanners } = require("../controller/bannerController");

const router = express.Router();

// Get all brands
router.post("/create", protect, adminOnly, createBanner);
router.get("/", protect, adminOnly, getAllBanners);
router.get("/:id", protect, adminOnly, getBannerById);
router.put("/:id", protect, adminOnly, updateBanner);
router.delete("/:id", protect, adminOnly, deleteBanner);
router.patch("/:id/toggle-status", protect, adminOnly, toggleBannerStatus);
router.patch("/update-priority", protect, adminOnly, updateBannerPriority);
router.patch("/get-active-banners",  getActiveBanners);

module.exports = router;
