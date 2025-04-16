const express = require("express");
const {
  getAllCategories,
  createCategory,
  deleteCategory,
  getCategoryById,
  updateCategory,
} = require("../controller/categoryController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

// Route to get all categories
router.get("/getAllCategory", getAllCategories);

// Route to get a single category by ID
router.get("/:id", getCategoryById);

// Route to create a new category
router.post("/create", protect, adminOnly, createCategory);

// Route to update a category by ID
router.put("/:id",protect, adminOnly, updateCategory);

// Route to delete a category by ID
router.delete("/:id", protect, adminOnly,deleteCategory);

module.exports = router;
