const express = require("express");
const {
  
  createProduct,
  deleteProduct,
  getProductById,
  updateProduct,
  getAllProducts,
  updatePriceAndStock,
} = require("../controller/productController");

const { protect, adminOnly } = require("../middleware/authMiddleware");
const router = express.Router();

// Route to get all products
router.get("/getAllProducts", protect, adminOnly, getAllProducts);   
router.get("/:id",protect, adminOnly, getProductById); 
router.post("/create", protect, adminOnly, createProduct); 
router.put("/updatePrice", protect, adminOnly, updatePriceAndStock); 
router.put("/:id", protect, adminOnly, updateProduct); 
router.delete("/:id", protect, adminOnly, deleteProduct);  

module.exports = router;