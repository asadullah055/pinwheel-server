const { validateRequest } = require("../middleware/inputValidation");
const express = require("express");
const { addToCart, getMyCart } = require("../controller/cartController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/add",  protect, validateRequest("cart"), addToCart);
router.get("/my-cart",  protect, validateRequest("empty"), getMyCart);

module.exports = router;
