const mongoose = require("mongoose");
const Order = require("../model/Order");
const Product = require("../model/Product");
const User = require("../model/Users");
const {
  TIMEZONE,
  EXCLUDED_STATUSES,
  getDashboardPeriod,
  fillDailySales,
} = require("../utils/dashboard");
const {
  salesExpression,
  unitsExpression,
  deliveredSalesExpression,
  itemStatusesExpression,
  orderSummaryExpression,
  activeStockExpression,
} = require("../utils/dashboardExpressions");

const emptyMetrics = () => ({
  orders: 0,
  sales: 0,
  salesOrders: 0,
  units: 0,
  deliveredSales: 0,
});
const metricsGroup = {
  $group: {
    _id: null,
    orders: { $sum: 1 },
    sales: { $sum: "$sales" },
    salesOrders: { $sum: { $cond: [{ $gt: ["$sales", 0] }, 1, 0] } },
    units: { $sum: "$units" },
    deliveredSales: { $sum: "$deliveredSales" },
  },
};

// Historical seller IDs take precedence; current ownership only fills legacy gaps.
const sellerScopeStages = (sellerId, productIds) => [
  {
    $match: {
      $or: [
        { "items.seller": sellerId },
        { "items.product": { $in: productIds } },
      ],
    },
  },
  {
    $set: {
      items: {
        $filter: {
          input: { $ifNull: ["$items", []] },
          as: "item",
          cond: {
            $eq: [
              {
                $ifNull: [
                  "$$item.seller",
                  {
                    $cond: [
                      { $in: ["$$item.product", productIds] },
                      sellerId,
                      null,
                    ],
                  },
                ],
              },
              sellerId,
            ],
          },
        },
      },
    },
  },
  { $match: { "items.0": { $exists: true } } },
];

const getSellerOverview = async (req, res, next) => {
  try {
    if (req.role !== "seller")
      return res.status(403).json({ message: "Access denied, seller only" });
    if (typeof req.id !== "string" || !/^[a-f\d]{24}$/i.test(req.id)) {
      return res
        .status(401)
        .json({ message: "Invalid seller session. Please log in again." });
    }
    const period = getDashboardPeriod(req.query.range);
    const sellerId = new mongoose.Types.ObjectId(req.id);
    const shop = await User.findOne({ _id: sellerId, role: "seller" })
      .select("shopName holidayMode isVerified")
      .lean();
    if (!shop)
      return res.status(403).json({ message: "Seller account is unavailable" });
    const ownedProducts = await Product.find({ creator: sellerId })
      .select("_id")
      .lean();
    const productIds = ownedProducts.map((product) => product._id);
    const scope = sellerScopeStages(sellerId, productIds);
    const currentMatch = { createdAt: { $gte: period.start, $lt: period.end } };
    const previousMatch = {
      createdAt: { $gte: period.previousStart, $lt: period.previousEnd },
    };

    const [orderRows, catalogRows, attentionRows] = await Promise.all([
      Order.aggregate([
        { $match: { $or: [currentMatch, previousMatch] } },
        ...scope,
        {
          $set: {
            items: {
              $map: {
                input: "$items",
                as: "item",
                in: {
                  $mergeObjects: [
                    "$$item",
                    {
                      status: {
                        $ifNull: [
                          "$$item.status",
                          { $ifNull: ["$status", "Pending"] },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        {
          $set: {
            sales: salesExpression,
            units: unitsExpression,
            deliveredSales: deliveredSalesExpression,
            status: orderSummaryExpression,
          },
        },
        {
          $facet: {
            current: [{ $match: currentMatch }, metricsGroup],
            previous: [{ $match: previousMatch }, metricsGroup],
            daily: [
              { $match: currentMatch },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      date: "$createdAt",
                      format: "%Y-%m-%d",
                      timezone: TIMEZONE,
                    },
                  },
                  sales: { $sum: "$sales" },
                  orders: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
            statuses: [
              { $match: currentMatch },
              { $group: { _id: "$status", count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
            ],
            recent: [
              { $match: currentMatch },
              { $sort: { createdAt: -1, _id: -1 } },
              { $limit: 6 },
              {
                $lookup: {
                  from: User.collection.name,
                  localField: "user",
                  foreignField: "_id",
                  as: "buyer",
                },
              },
              {
                $project: {
                  orderNumber: 1,
                  createdAt: 1,
                  status: 1,
                  customerName: {
                    $ifNull: [
                      "$customer.name",
                      {
                        $ifNull: [
                          { $arrayElemAt: ["$buyer.name", 0] },
                          "Guest Customer",
                        ],
                      },
                    ],
                  },
                  itemCount: { $sum: "$items.quantity" },
                  productValue: {
                    $sum: {
                      $map: {
                        input: "$items",
                        as: "item",
                        in: { $multiply: ["$$item.price", "$$item.quantity"] },
                      },
                    },
                  },
                },
              },
            ],
            topProducts: [
              { $match: currentMatch },
              { $unwind: "$items" },
              {
                $match: {
                  $expr: {
                    $not: [
                      {
                        $in: [
                          { $ifNull: ["$items.status", "$status"] },
                          EXCLUDED_STATUSES,
                        ],
                      },
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: "$items.product",
                  quantity: { $sum: "$items.quantity" },
                  sales: {
                    $sum: { $multiply: ["$items.price", "$items.quantity"] },
                  },
                },
              },
              { $sort: { sales: -1, quantity: -1, _id: 1 } },
              { $limit: 5 },
              {
                $lookup: {
                  from: Product.collection.name,
                  localField: "_id",
                  foreignField: "_id",
                  as: "product",
                },
              },
              {
                $project: {
                  quantity: 1,
                  sales: 1,
                  // A sold product may have been removed or transferred since the order.
                  editable: {
                    $eq: [{ $arrayElemAt: ["$product.creator", 0] }, sellerId],
                  },
                  name: {
                    $cond: [
                      {
                        $eq: [
                          { $arrayElemAt: ["$product.creator", 0] },
                          sellerId,
                        ],
                      },
                      { $arrayElemAt: ["$product.productName", 0] },
                      null,
                    ],
                  },
                },
              },
            ],
          },
        },
      ]),
      Product.aggregate([
        { $match: { creator: sellerId } },
        { $set: { activeStock: activeStockExpression } },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  published: {
                    $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] },
                  },
                  unpublished: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "unpublished"] }, 1, 0],
                    },
                  },
                },
              },
            ],
            stockCounts: [
              { $match: { status: "published" } },
              {
                $group: {
                  _id: null,
                  outOfStock: {
                    $sum: { $cond: [{ $lte: ["$activeStock", 0] }, 1, 0] },
                  },
                  lowStock: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gt: ["$activeStock", 0] },
                            { $lte: ["$activeStock", 5] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            stockAlerts: [
              { $match: { status: "published", activeStock: { $lte: 5 } } },
              { $sort: { activeStock: 1, _id: 1 } },
              { $limit: 5 },
              { $project: { productName: 1, sku: 1, stock: "$activeStock" } },
            ],
          },
        },
      ]),
      Order.aggregate([
        ...scope,
        { $set: { statuses: itemStatusesExpression } },
        {
          $group: {
            _id: null,
            pending: {
              $sum: { $cond: [{ $in: ["Pending", "$statuses"] }, 1, 0] },
            },
            processing: {
              $sum: { $cond: [{ $in: ["Processing", "$statuses"] }, 1, 0] },
            },
            returns: {
              $sum: { $cond: [{ $in: ["Returned", "$statuses"] }, 1, 0] },
            },
          },
        },
      ]),
    ]);
    const orders = orderRows[0] || {};
    const catalog = catalogRows[0] || {};
    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      period,
      generatedAt: new Date(),
      shop: {
        name: shop.shopName || "Your shop",
        holidayMode: Boolean(shop.holidayMode),
        isVerified: Boolean(shop.isVerified),
      },
      current: { ...emptyMetrics(), ...orders.current?.[0] },
      previous: { ...emptyMetrics(), ...orders.previous?.[0] },
      daily: fillDailySales(orders.daily || [], period),
      statuses: orders.statuses || [],
      recentOrders: orders.recent || [],
      topProducts: orders.topProducts || [],
      catalog: {
        total: 0,
        published: 0,
        unpublished: 0,
        lowStock: 0,
        outOfStock: 0,
        ...catalog.totals?.[0],
        ...catalog.stockCounts?.[0],
      },
      stockAlerts: catalog.stockAlerts || [],
      attention: { pending: 0, processing: 0, returns: 0, ...attentionRows[0] },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSellerOverview };
