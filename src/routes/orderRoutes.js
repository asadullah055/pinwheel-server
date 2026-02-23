const express = require("express");
const {
  createOrder,
  getAllOrders,
  getSellerOrders,
  updateOrderStatus,
} = require("../controller/orderController");
const { protect, optionalProtect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/create", optionalProtect, createOrder);
router.get("/all", protect, getAllOrders);
router.get("/seller", protect, getSellerOrders);
router.patch("/:id/status", protect, updateOrderStatus);

module.exports = router;
