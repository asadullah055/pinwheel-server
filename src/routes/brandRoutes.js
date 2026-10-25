const { validateRequest } = require("../middleware/inputValidation");
const express = require('express');

const { protect, adminOnly } = require('../middleware/authMiddleware');
const { createBrand, getAllBrands, getBrandById, updateBrand, deleteBrand, dropdownBrands } = require('../controller/brandController');

const router = express.Router();

// Get all brands
router.get("/getAllBrands",  protect, validateRequest("list"), getAllBrands);
router.get("/dropdownBrands", validateRequest("empty"), dropdownBrands);

// Get a single brand by ID
router.get("/:id", validateRequest("id"), getBrandById);

// Create a new brand
router.post("/create",  protect, adminOnly, validateRequest("multipart"), createBrand);

// Update a brand by ID
router.put("/:id", protect, adminOnly, validateRequest("multipartId"), updateBrand);

// Delete a brand by ID
router.delete("/:id", protect, adminOnly, validateRequest("id"), deleteBrand);

module.exports = router;