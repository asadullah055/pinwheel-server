const express = require("express");
const { addToCart, getMyCart } = require("../controller/cartController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/add", protect, addToCart);
router.get("/my-cart", protect, getMyCart);

module.exports = router;
