const { EXCLUDED_STATUSES } = require("./dashboard");

const sumItems = (value, statuses, exclude = false) => ({
  $sum: {
    $map: {
      input: { $ifNull: ["$items", []] },
      as: "item",
      in: {
        $cond: [
          {
            $in: [
              {
                $ifNull: ["$$item.status", { $ifNull: ["$status", "Pending"] }],
              },
              statuses,
            ],
          },
          exclude ? 0 : value,
          exclude ? value : 0,
        ],
      },
    },
  },
});

const itemValue = {
  $multiply: [
    { $ifNull: ["$$item.price", 0] },
    { $ifNull: ["$$item.quantity", 0] },
  ],
};
const salesExpression = sumItems(itemValue, EXCLUDED_STATUSES, true);
const unitsExpression = sumItems(
  { $ifNull: ["$$item.quantity", 0] },
  EXCLUDED_STATUSES,
  true,
);
const deliveredSalesExpression = sumItems(itemValue, [
  "Delivered",
  "Completed",
]);

const itemStatusesExpression = {
  $setUnion: [
    {
      $map: {
        input: { $ifNull: ["$items", []] },
        as: "item",
        in: { $ifNull: ["$$item.status", { $ifNull: ["$status", "Pending"] }] },
      },
    },
    [],
  ],
};

const orderSummaryExpression = {
  $let: {
    vars: { statuses: itemStatusesExpression },
    in: {
      $cond: [
        { $eq: [{ $size: "$$statuses" }, 1] },
        { $arrayElemAt: ["$$statuses", 0] },
        "Mixed",
      ],
    },
  },
};

const activeStockExpression = {
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
};

module.exports = {
  salesExpression,
  unitsExpression,
  deliveredSalesExpression,
  itemStatusesExpression,
  orderSummaryExpression,
  activeStockExpression,
};
