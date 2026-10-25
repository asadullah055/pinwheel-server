const { validateRequest } = require("../middleware/inputValidation");
const express = require("express");

const { protect, adminOnly } = require("../middleware/authMiddleware");

const { createBanner, getAllBanners, getBannerById, updateBanner, deleteBanner, toggleBannerStatus, updateBannerPriority, getActiveBanners } = require("../controller/bannerController");

const router = express.Router();

// Get all brands
router.get("/get-active-banner", validateRequest("empty"), getActiveBanners);
router.post("/create",  protect, adminOnly, validateRequest("multipart"), createBanner);
router.get("/",  protect, adminOnly, validateRequest("banners"), getAllBanners);
router.get("/:id",  protect, adminOnly, validateRequest("id"), getBannerById);
router.put("/:id",  protect, adminOnly, validateRequest("multipartId"), updateBanner);
router.delete("/:id",  protect, adminOnly, validateRequest("id"), deleteBanner);
router.patch("/:id/toggle-status",  protect, adminOnly, validateRequest("id"), toggleBannerStatus);
router.patch("/update-priority",  protect, adminOnly, validateRequest("priorities"), updateBannerPriority);

module.exports = router;
