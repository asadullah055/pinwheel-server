const express = require("express");
const {
  
  createProduct,
  deleteProduct,
  getProductById,
  updateProduct,
  getAllProducts,
  updatePriceAndStock,
  updateStatus,
  getProductImageUploadSignature,
  getPublicProducts,
  getProductBySlug,
} = require("../controller/productController");

const { protect, adminOnly } = require("../middleware/authMiddleware");
const router = express.Router();

// Route to get all products
router.get("/getAllProducts", protect, getAllProducts);   
router.get("/publicProducts",  getPublicProducts);   
router.post("/image-signature", protect, getProductImageUploadSignature);
router.post("/create", protect, createProduct); 
router.put("/updatePrice", protect, updatePriceAndStock); 
router.put("/updateStatus/:id", protect, updateStatus); 
router.get("/slug/:slug", getProductBySlug);  
router.get("/:id", getProductById); 
router.put("/:id", protect, updateProduct); 
router.delete("/:id", protect, adminOnly, deleteProduct);  

module.exports = router;
