const { validateRequest } = require("../middleware/inputValidation");
const router = require("express").Router();
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { getAdminOverview } = require("../controller/dashboardController");
const {
  getSellerOverview,
} = require("../controller/sellerDashboardController");

router.get("/overview",  protect, adminOnly, validateRequest("dashboard"), getAdminOverview);
router.get("/seller-overview",  protect, validateRequest("dashboard"), getSellerOverview);

module.exports = router;
