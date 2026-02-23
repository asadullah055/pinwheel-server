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
        (variant) => Number(variant?.price) > 0 && Number(variant?.stock) > 0
      );

      if (activeVariants.length === 0) {
        throw createError(400, `${product.productName} is out of stock`);
      }

      const totalStock = activeVariants.reduce(
        (sum, variant) => sum + Number(variant.stock || 0),
        0
      );

      if (quantity > totalStock) {
        throw createError(
          400,
          `${product.productName} has only ${totalStock} items in stock`
        );
      }

      const unitPrice = Math.min(
        ...activeVariants.map((variant) => {
          const discountPrice = Number(variant.discountPrice);
          return discountPrice > 0 ? discountPrice : Number(variant.price);
        })
      );

      normalizedItems.push({
        product: product._id,
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
    for (const [productId, quantity] of qtyMap.entries()) {
      await decreaseProductStock(productId, quantity);
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
      },
      paymentMethod,
    };

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
      for (const [productId, quantity] of qtyMap.entries()) {
        await increaseProductStock(productId, quantity);
      }
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
    const qty = Number(item.quantity || 0);
    qtyMap.set(productId, (qtyMap.get(productId) || 0) + qty);
  }

  return qtyMap;
};

const decreaseProductStock = async (productId, quantity) => {
  const product = await Product.findById(productId).select("productName variants");

  if (!product) {
    throw createError(404, "Product not found while updating stock");
  }

  let totalStock = 0;
  for (const variant of product.variants || []) {
    totalStock += Number(variant.stock || 0);
  }

  if (quantity > totalStock) {
    throw createError(
      400,
      `${product.productName} does not have enough stock for confirmation`
    );
  }

  let remaining = quantity;

  for (const variant of product.variants || []) {
    if (remaining <= 0) break;

    const currentStock = Number(variant.stock || 0);
    const deduct = Math.min(currentStock, remaining);

    variant.stock = currentStock - deduct;
    remaining -= deduct;
  }

  await product.save();
};

const increaseProductStock = async (productId, quantity) => {
  const product = await Product.findById(productId).select("variants");

  if (!product) {
    throw createError(404, "Product not found while restoring stock");
  }

  if (!Array.isArray(product.variants) || product.variants.length === 0) {
    throw createError(400, "Cannot restore stock: product has no variants");
  }

  const firstVariant = product.variants[0];
  firstVariant.stock = Number(firstVariant.stock || 0) + Number(quantity || 0);

  await product.save();
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
      for (const [productId, quantity] of qtyMap.entries()) {
        await increaseProductStock(productId, quantity);
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


