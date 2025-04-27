const express = require("express");
const {
  getAllProducts,
  createProduct,
  deleteProduct,
  getProductById,
  updateProduct,
} = require("../controller/productController");

const { protect, adminOnly } = require("../middleware/authMiddleware");
const router = express.Router();

// Route to get all products
/* router.get("/getAllProduct", getAllProducts);   
router.get("/:id", getProductById);  */
router.post("/create", protect, adminOnly, createProduct); 
/* router.put("/:id", protect, adminOnly, updateProduct); 
router.delete("/:id", protect, adminOnly, deleteProduct);  */

module.exports = router;