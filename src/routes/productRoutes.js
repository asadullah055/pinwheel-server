const { validateRequest } = require("../middleware/inputValidation");
const express = require("express");
const {

  createProduct,
  deleteProduct,
  getProductById,
  getManagedProductById,
  updateProduct,
  getAllProducts,
  updatePriceAndStock,
  updateStatus,
  getProductImageUploadSignature,
  getPublicProducts,
  getProductBySlug,
} = require("../controller/productController");

const { protect, adminOnly } = require("../middleware/authMiddleware");
const { uploadProductImage } = require("../controller/uploadController");
const router = express.Router();
router.post("/images", protect, validateRequest("multipart"), uploadProductImage);

// Route to get all products
router.get("/getAllProducts",  protect, validateRequest("products"), getAllProducts);
router.get("/publicProducts", validateRequest("publicProducts"), getPublicProducts);
router.post("/image-signature",  protect, validateRequest("empty"), getProductImageUploadSignature);
router.post("/create",  protect, validateRequest("multipart"), createProduct);
router.put("/updatePrice",  protect, validateRequest("quickProduct"), updatePriceAndStock);
router.put("/updateStatus/:id",  protect, validateRequest("productStatus"), updateStatus);
router.get("/slug/:slug", validateRequest("slug"), getProductBySlug);
router.get("/manage/:id",  protect, validateRequest("id"), getManagedProductById);
router.get("/:id", validateRequest("id"), getProductById);
router.put("/:id",  protect, validateRequest("multipartId"), updateProduct);
router.delete("/:id",  protect, adminOnly, validateRequest("id"), deleteProduct);

module.exports = router;
