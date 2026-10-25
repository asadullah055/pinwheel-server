const { validateRequest } = require("../middleware/inputValidation");
const express = require("express");
const {
  getAllCategories,
  createCategory,
  deleteCategory,
  getCategoryById,
  updateCategory,
  dropdownCategories,
} = require("../controller/categoryController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

// Route to get all categories
router.get("/getAllCategory", validateRequest("list"), getAllCategories);

router.get("/dropdownCategories", validateRequest("empty"), dropdownCategories);

// Route to get a single category by ID
router.get("/:id", validateRequest("id"), getCategoryById);

// Route to create a new category
router.post("/create",  protect, adminOnly, validateRequest("multipart"), createCategory);

// Route to update a category by ID
router.put("/:id", protect, adminOnly, validateRequest("multipartId"), updateCategory);

// Route to delete a category by ID
router.delete("/:id",  protect, adminOnly, validateRequest("id"),deleteCategory);

module.exports = router;
