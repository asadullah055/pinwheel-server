const { validateRequest } = require("../middleware/inputValidation");
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
  getOrderPaymentOptions,
} = require("../controller/orderController");
const { initiateBkashPayment, bkashCallback, getPaymentStatus } = require("../controller/paymentController");
const { protect, optionalProtect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/create",  optionalProtect, validateRequest("order"), createOrder);
router.get("/payment-options", validateRequest("empty"), getOrderPaymentOptions);
router.get("/bkash/callback", validateRequest("callback"), bkashCallback);
router.post("/:id/bkash",  optionalProtect, validateRequest("payment"), initiateBkashPayment);
router.post("/:id/payment-status",  optionalProtect, validateRequest("payment"), getPaymentStatus);
router.get("/all",  protect, validateRequest("empty"), getAllOrders);
router.get("/seller",  protect, validateRequest("empty"), getSellerOrders);
router.get("/my",  protect, validateRequest("empty"), getMyOrders);
router.get("/:id/invoice",  optionalProtect, validateRequest("invoice"), getOrderInvoice);
router.get("/:id",  protect, validateRequest("id"), getOrderById);
router.patch("/:orderId/items/:itemId/status",  protect, validateRequest("itemStatus"), updateOrderItemStatus);
router.patch("/:id/status",  protect, validateRequest("orderStatus"), updateOrderStatus);

module.exports = router;
