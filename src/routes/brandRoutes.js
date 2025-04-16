const express = require('express');

const { protect, adminOnly } = require('../middleware/authMiddleware');
const { createBrand, getAllBrands, getBrandById, updateBrand, deleteBrand } = require('../controller/brandController');

const router = express.Router();

// Get all brands
router.get('/getAllBrands', getAllBrands);

// Get a single brand by ID
router.get('/:id', getBrandById);

// Create a new brand
router.post('/create', protect, adminOnly, createBrand);

// Update a brand by ID
router.put('/:id',protect, adminOnly, updateBrand);

// Delete a brand by ID
router.delete('/:id',protect, adminOnly, deleteBrand);

module.exports = router;