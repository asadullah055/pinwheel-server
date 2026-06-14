const express = require("express");
const {
  createOrder,
  getAllOrders,
  getMyOrders,
  getOrderById,
  getOrderInvoice,
  getSellerOrders,
  updateOrderItemStatus,
  updateOrderStatus,
} = require("../controller/orderController");
const { protect, optionalProtect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/create", optionalProtect, createOrder);
router.get("/all", protect, getAllOrders);
router.get("/seller", protect, getSellerOrders);
router.get("/my", protect, getMyOrders);
router.get("/:id/invoice", optionalProtect, getOrderInvoice);
router.get("/:id", protect, getOrderById);
router.patch("/:orderId/items/:itemId/status", protect, updateOrderItemStatus);
router.patch("/:id/status", protect, updateOrderStatus);

module.exports = router;
