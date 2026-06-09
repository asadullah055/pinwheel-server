const createError = require("http-errors");
const mongoose = require("mongoose");
const Order = require("../model/Order");
const Product = require("../model/Product");
const { successMessage } = require("../utils/response");

const requiredAddressFields = ["street", "city", "state", "postalCode", "country"];

const ORDER_STATUSES = [
  "Pending",
  "Processing",
  "Confirm",
  "Shipped",
  "Delivered",
  "Cancelled",
  "Returned",
  "Refunded",
  "Failed",
  "Completed",
  "Awaiting Payment",
];

const createOrder = async (req, res, next) => {
  try {
    const { items, shippingAddress, paymentMethod, customer, shippingFee } = req.body;
    const isLoggedIn = Boolean(req.id);

    if (!Array.isArray(items) || items.length === 0) {
      throw createError(400, "Order items are required");
    }

    if (!shippingAddress || typeof shippingAddress !== "object") {
      throw createError(400, "Shipping address is required");
    }

    for (const field of requiredAddressFields) {
      const value = shippingAddress[field];
      if (!value || typeof value !== "string" || !value.trim()) {
        throw createError(400, `Shipping address ${field} is required`);
      }
    }

    if (!paymentMethod) {
      throw createError(400, "Payment method is required");
    }

    if (!isLoggedIn) {
      if (!customer || typeof customer !== "object") {
        throw createError(400, "Guest customer information is required");
      }
      if (!customer.name || !String(customer.name).trim()) {
        throw createError(400, "Customer name is required for guest order");
      }
      if (!customer.phone || !String(customer.phone).trim()) {
        throw createError(400, "Customer phone is required for guest order");
      }
    }

    const parsedShippingFee = Number(shippingFee ?? 0);
    if (!Number.isFinite(parsedShippingFee) || parsedShippingFee < 0) {
      throw createError(400, "Shipping fee must be a valid non-negative number");
    }

    const normalizedItems = [];
    const sellerIds = new Set();
    let totalAmount = 0;

    for (const item of items) {
      const productId = item?.product;
      const quantity = Number(item?.quantity);

      if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        throw createError(400, "Invalid product id in order items");
      }

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw createError(400, "Each order item must have a valid quantity");
      }

      const product = await Product.findById(productId).select(
        "productName status variants creator"
      );

      if (!product) {
        throw createError(404, "One or more products not found");
      }

      if (product.status !== "published") {
        throw createError(400, `${product.productName} is not available for ordering`);
      }

      if (!Array.isArray(product.variants) || product.variants.length === 0) {
        throw createError(400, `${product.productName} has no purchasable variant`);
      }

      const activeVariants = product.variants.filter(
        (variant) =>
          variant?.availability !== false &&
          Number(variant?.price) > 0 &&
          Number(variant?.stock) > 0
      );

      if (activeVariants.length === 0) {
        throw createError(400, `${product.productName} is out of stock`);
      }

      const requestedVariantId = item?.variant || item?.variantId;
      let selectedVariant = null;

      if (requestedVariantId && mongoose.Types.ObjectId.isValid(requestedVariantId)) {
        selectedVariant = activeVariants.find(
          (variant) => variant._id.toString() === requestedVariantId.toString()
        );
      } else if (activeVariants.length === 1) {
        selectedVariant = activeVariants[0];
      }

      if (!selectedVariant) {
        throw createError(400, `${product.productName} selected variant is not available`);
      }

      const selectedVariantStock = Number(selectedVariant.stock || 0);
      if (quantity > selectedVariantStock) {
        throw createError(
          400,
          `${product.productName} has only ${selectedVariantStock} items in stock`
        );
      }

      const unitPrice = getVariantUnitPrice(selectedVariant);

      normalizedItems.push({
        product: product._id,
        variant: selectedVariant._id,
        sku: selectedVariant.sku,
        attributes: normalizeVariantAttributes(selectedVariant.attributes),
        quantity,
        price: unitPrice,
      });

      if (product.creator) {
        sellerIds.add(product.creator.toString());
      }

      totalAmount += unitPrice * quantity;
    }

    const payableAmount = totalAmount + parsedShippingFee;

    const qtyMap = buildQuantityMap(normalizedItems);
    const adjustedStockItems = [];
    try {
      for (const adjustment of qtyMap.values()) {
        await decreaseVariantStock(
          adjustment.productId,
          adjustment.variantId,
          adjustment.quantity
        );
        adjustedStockItems.push(adjustment);
      }
    } catch (error) {
      await rollbackStockAdjustments(adjustedStockItems);
      throw error;
    }

    const orderPayload = {
      items: normalizedItems,
      sellers: Array.from(sellerIds),
      totalAmount,
      shippingFee: parsedShippingFee,
      payableAmount,
      stockAdjusted: true,
      shippingAddress: {
        street: shippingAddress.street.trim(),
        city: shippingAddress.city.trim(),
        state: shippingAddress.state.trim(),
        postalCode: shippingAddress.postalCode.trim(),
        country: shippingAddress.country.trim(),
        division: shippingAddress.division
          ? String(shippingAddress.division).trim()
          : shippingAddress.state.trim(),
        district: shippingAddress.district
          ? String(shippingAddress.district).trim()
          : shippingAddress.city.trim(),
        upazila: shippingAddress.upazila
          ? String(shippingAddress.upazila).trim()
          : undefined,
        area: shippingAddress.area
          ? String(shippingAddress.area).trim()
          : shippingAddress.postalCode.trim(),
      },
      paymentMethod,
    };

    if (customer && typeof customer === "object") {
      orderPayload.customer = {
        name: customer.name ? String(customer.name).trim() : undefined,
        phone: customer.phone ? String(customer.phone).trim() : undefined,
        email: customer.email ? String(customer.email).trim().toLowerCase() : null,
      };
    }

    if (isLoggedIn) {
      orderPayload.user = req.id;
    } else {
      orderPayload.customer = {
        name: String(customer.name).trim(),
        phone: String(customer.phone).trim(),
        email: customer.email ? String(customer.email).trim().toLowerCase() : null,
      };
    }

    let order;
    try {
      order = await Order.create(orderPayload);
    } catch (error) {
      await rollbackStockAdjustments(adjustedStockItems);
      throw error;
    }

    const populatedOrder = await Order.findById(order._id)
      .populate("user", "name email")
      .populate("sellers", "name email")
      .populate("items.product", "productName slug images creator");

    return successMessage(res, 201, {
      message: "Order placed successfully",
      order: populatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

const getAllOrders = async (req, res, next) => {
  try {
    if (req.role !== "admin") {
      throw createError(403, "Only admin can view all orders");
    }

    const orders = await Order.find({})
      .populate("user", "name email")
      .populate("sellers", "name email")
      .populate("items.product", "productName slug images creator")
      .sort({ createdAt: -1 });

    return successMessage(res, 200, {
      message: "All orders fetched successfully",
      totalOrders: orders.length,
      orders,
    });
  } catch (error) {
    next(error);
  }
};

const getSellerOrders = async (req, res, next) => {
  try {
    if (req.role !== "seller") {
      throw createError(403, "Only seller can view seller orders");
    }

    const sellerProducts = await Product.find({ creator: req.id }).select("_id");
    const sellerProductIds = sellerProducts.map((p) => p._id);

    const orders = await Order.find({
      $or: [{ sellers: req.id }, { "items.product": { $in: sellerProductIds } }],
    })
      .populate("user", "name email")
      .populate("sellers", "name email")
      .populate("items.product", "productName slug images creator")
      .sort({ createdAt: -1 });

    return successMessage(res, 200, {
      message: "Seller orders fetched successfully",
      totalOrders: orders.length,
      orders,
    });
  } catch (error) {
    next(error);
  }
};

const buildQuantityMap = (items) => {
  const qtyMap = new Map();

  for (const item of items) {
    const productId = item.product.toString();
    const variantId = item.variant ? item.variant.toString() : null;
    const key = `${productId}:${variantId || "legacy"}`;
    const qty = Number(item.quantity || 0);
    const current = qtyMap.get(key);

    qtyMap.set(key, {
      productId,
      variantId,
      quantity: (current?.quantity || 0) + qty,
    });
  }

  return qtyMap;
};

const getVariantUnitPrice = (variant) => {
  const discountPrice = Number(variant.discountPrice);
  return discountPrice > 0 ? discountPrice : Number(variant.price);
};

const normalizeVariantAttributes = (attributes) => {
  if (!attributes) return {};
  if (attributes instanceof Map) return Object.fromEntries(attributes);
  if (typeof attributes.toObject === "function") return attributes.toObject();
  return { ...attributes };
};

const decreaseVariantStock = async (productId, variantId, quantity) => {
  const result = await Product.updateOne(
    {
      _id: productId,
      status: "published",
      variants: {
        $elemMatch: {
          _id: variantId,
          availability: { $ne: false },
          stock: { $gte: quantity },
        },
      },
    },
    {
      $inc: {
        "variants.$.stock": -quantity,
      },
    }
  );

  if (result.modifiedCount !== 1) {
    throw createError(400, "Selected product variant is out of stock");
  }
};

const increaseVariantStock = async (productId, variantId, quantity) => {
  await Product.updateOne(
    {
      _id: productId,
      "variants._id": variantId,
    },
    {
      $inc: {
        "variants.$.stock": quantity,
      },
    }
  );
};

const increaseLegacyProductStock = async (productId, quantity) => {
  const product = await Product.findById(productId).select("variants");

  if (!product || !Array.isArray(product.variants) || product.variants.length === 0) {
    return;
  }

  const firstVariant = product.variants[0];
  firstVariant.stock = Number(firstVariant.stock || 0) + Number(quantity || 0);
  await product.save();
};

const increaseStockAdjustment = async (adjustment) => {
  if (adjustment.variantId) {
    await increaseVariantStock(
      adjustment.productId,
      adjustment.variantId,
      adjustment.quantity
    );
    return;
  }

  await increaseLegacyProductStock(adjustment.productId, adjustment.quantity);
};

const rollbackStockAdjustments = async (adjustments) => {
  await Promise.all(adjustments.map((adjustment) => increaseStockAdjustment(adjustment)));
};

const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !ORDER_STATUSES.includes(status)) {
      throw createError(400, "Valid order status is required");
    }

    const order = await Order.findById(id).populate("items.product", "creator");

    if (!order) {
      throw createError(404, "Order not found");
    }

    if (req.role !== "admin" && req.role !== "seller") {
      throw createError(403, "Only admin or seller can update order status");
    }

    if (req.role === "seller") {
      const sellerOwnsAnyProduct = order.items.some(
        (item) => item.product && item.product.creator && item.product.creator.toString() === req.id
      );

      if (!sellerOwnsAnyProduct) {
        throw createError(403, "You can only update status for your own product orders");
      }
    }

    if (order.status === status) {
      return successMessage(res, 200, {
        message: "Order status already set",
        order,
      });
    }

    const qtyMap = buildQuantityMap(order.items);


    if (status === "Cancelled" && order.stockAdjusted) {
      for (const adjustment of qtyMap.values()) {
        await increaseStockAdjustment(adjustment);
      }
      order.stockAdjusted = false;
    }

    order.status = status;
    await order.save();

    const updatedOrder = await Order.findById(order._id)
      .populate("user", "name email")
      .populate("sellers", "name email")
      .populate("items.product", "productName slug images creator");

    return successMessage(res, 200, {
      message: "Order status updated successfully",
      order: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrder,
  getAllOrders,
  getSellerOrders,
  updateOrderStatus,
};


