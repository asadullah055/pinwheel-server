const Order = require("../model/Order");
const Product = require("../model/Product");
const User = require("../model/Users");
const {
  TIMEZONE,
  EXCLUDED_STATUSES,
  getDashboardPeriod,
  fillDailySales,
  emptyMetrics,
} = require("../utils/dashboard");

const { salesExpression } = require("../utils/dashboardExpressions");

const metricsGroup = {
  $group: {
    _id: null,
    orders: { $sum: 1 },
    sales: { $sum: "$sales" },
    salesOrders: { $sum: { $cond: [{ $gt: ["$sales", 0] }, 1, 0] } },
    recordedPayments: { $sum: { $ifNull: ["$paidAmount", 0] } },
    outstanding: {
      $sum: {
        $cond: [
          { $in: ["$status", EXCLUDED_STATUSES] },
          0,
          {
            $max: [
              {
                $subtract: [
                  { $ifNull: ["$payableAmount", 0] },
                  { $ifNull: ["$paidAmount", 0] },
                ],
              },
              0,
            ],
          },
        ],
      },
    },
  },
};

const getAdminOverview = async (req, res, next) => {
  try {
    // Also guard the controller so it cannot be reused without the role check.
    if (req.role !== "admin")
      return res.status(403).json({ message: "Access denied, admin only" });
    const period = getDashboardPeriod(req.query.range);
    const currentMatch = { createdAt: { $gte: period.start, $lt: period.end } };
    const previousMatch = {
      createdAt: { $gte: period.previousStart, $lt: period.previousEnd },
    };
    const [orderResults, catalogResults, sellerResults, attentionResults] =
      await Promise.all([
        Order.aggregate([
          { $match: { $or: [currentMatch, previousMatch] } },
          { $set: { sales: salesExpression } },
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
                {
                  $group: {
                    _id: { $ifNull: ["$status", "Pending"] },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1, _id: 1 } },
              ],
              buyers: [
                { $match: currentMatch },
                {
                  $lookup: {
                    from: User.collection.name,
                    localField: "user",
                    foreignField: "_id",
                    as: "buyer",
                  },
                },
                {
                  $set: {
                    buyerEmail: {
                      $toLower: {
                        $trim: {
                          input: {
                            $ifNull: [
                              "$customer.email",
                              {
                                $ifNull: [
                                  { $arrayElemAt: ["$buyer.email", 0] },
                                  "",
                                ],
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
                {
                  $group: {
                    _id: {
                      $cond: [
                        { $ne: ["$buyerEmail", ""] },
                        { $concat: ["email:", "$buyerEmail"] },
                        {
                          $cond: [
                            { $ne: [{ $ifNull: ["$user", null] }, null] },
                            { $concat: ["user:", { $toString: "$user" }] },
                            {
                              $cond: [
                                {
                                  $ne: [
                                    { $ifNull: ["$customer.phone", ""] },
                                    "",
                                  ],
                                },
                                { $concat: ["phone:", "$customer.phone"] },
                                { $concat: ["order:", { $toString: "$_id" }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
                { $count: "count" },
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
                    paymentStatus: 1,
                    payableAmount: 1,
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
                    name: { $arrayElemAt: ["$product.productName", 0] },
                    image: {
                      $arrayElemAt: [
                        { $arrayElemAt: ["$product.images", 0] },
                        0,
                      ],
                    },
                  },
                },
              ],
              topSellers: [
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
                  $lookup: {
                    from: Product.collection.name,
                    localField: "items.product",
                    foreignField: "_id",
                    as: "product",
                  },
                },
                {
                  $set: {
                    sellerId: {
                      $ifNull: [
                        "$items.seller",
                        { $arrayElemAt: ["$product.creator", 0] },
                      ],
                    },
                  },
                },
                { $match: { sellerId: { $ne: null } } },
                {
                  $group: {
                    _id: "$sellerId",
                    quantity: { $sum: "$items.quantity" },
                    sales: {
                      $sum: { $multiply: ["$items.price", "$items.quantity"] },
                    },
                  },
                },
                { $sort: { sales: -1, _id: 1 } },
                { $limit: 5 },
                {
                  $lookup: {
                    from: User.collection.name,
                    localField: "_id",
                    foreignField: "_id",
                    as: "seller",
                  },
                },
                {
                  $project: {
                    quantity: 1,
                    sales: 1,
                    shopName: { $arrayElemAt: ["$seller.shopName", 0] },
                    name: { $arrayElemAt: ["$seller.name", 0] },
                  },
                },
              ],
            },
          },
        ]),
        Product.aggregate([
          {
            $set: {
              activeStock: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: { $ifNull: ["$variants", []] },
                        as: "variant",
                        cond: { $ne: ["$$variant.availability", false] },
                      },
                    },
                    as: "variant",
                    in: { $max: [0, { $ifNull: ["$$variant.stock", 0] }] },
                  },
                },
              },
            },
          },
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    published: {
                      $sum: {
                        $cond: [{ $eq: ["$status", "published"] }, 1, 0],
                      },
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
        User.aggregate([
          { $match: { role: "seller" } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              unverified: {
                $sum: { $cond: [{ $eq: ["$isVerified", true] }, 0, 1] },
              },
              newSellers: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ["$createdAt", period.start] },
                        { $lt: ["$createdAt", period.end] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
        // Operational alerts cover all time, so older work never disappears with a filter.
        Order.aggregate([
          {
            $group: {
              _id: null,
              pending: {
                $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] },
              },
              returns: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        { $eq: ["$status", "Returned"] },
                        {
                          $in: ["Returned", { $ifNull: ["$items.status", []] }],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              failedPayments: {
                $sum: { $cond: [{ $eq: ["$paymentStatus", "Failed"] }, 1, 0] },
              },
            },
          },
        ]),
      ]);
    const orders = orderResults[0] || {};
    const catalog = catalogResults[0] || {};
    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      period,
      generatedAt: new Date(),
      current: { ...emptyMetrics(), ...orders.current?.[0] },
      previous: { ...emptyMetrics(), ...orders.previous?.[0] },
      daily: fillDailySales(orders.daily || [], period),
      statuses: orders.statuses || [],
      recentOrders: orders.recent || [],
      topProducts: orders.topProducts || [],
      topSellers: orders.topSellers || [],
      buyers: orders.buyers?.[0]?.count || 0,
      catalog: {
        total: 0,
        published: 0,
        unpublished: 0,
        outOfStock: 0,
        lowStock: 0,
        ...catalog.totals?.[0],
        ...catalog.stockCounts?.[0],
      },
      stockAlerts: catalog.stockAlerts || [],
      sellers: { total: 0, unverified: 0, newSellers: 0, ...sellerResults[0] },
      attention: {
        pending: 0,
        returns: 0,
        failedPayments: 0,
        ...attentionResults[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAdminOverview };
