const createError = require("http-errors");
const mongoose = require("mongoose");
const Order = require("../model/Order");
const Product = require("../model/Product");
const { buildInvoiceEmailHtml, buildInvoicePdf } = require("../utils/invoice");
const { successMessage } = require("../utils/response");
const { sendEmail } = require("../utils/sendEmail");

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
        seller: product.creator || null,
        variant: selectedVariant._id,
        sku: selectedVariant.sku,
        attributes: normalizeVariantAttributes(selectedVariant.attributes),
        quantity,
        price: unitPrice,
        regularPrice: Number(selectedVariant.price),
        status: "Pending",
        stockAdjusted: true,
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

    const populatedOrder = await findPopulatedOrderById(order._id, {
      includeInvoiceToken: true,
    });
    await sendOrderInvoiceEmail(populatedOrder);

    return successMessage(res, 201, {
      message: "Order placed successfully",
      order: prepareOrderForResponse(populatedOrder, req, {
        includeInvoiceToken: true,
      }),
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
      .populate("items.seller", "name email")
      .populate("items.product", "productName slug images creator")
      .sort({ createdAt: -1 });

    return successMessage(res, 200, {
      message: "All orders fetched successfully",
      totalOrders: orders.length,
      orders: orders.map((order) => prepareOrderForResponse(order, req)),
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
      $or: [
        { sellers: req.id },
        { "items.seller": req.id },
        { "items.product": { $in: sellerProductIds } },
      ],
    })
      .populate("user", "name email")
      .populate("sellers", "name email")
      .populate("items.seller", "name email")
      .populate("items.product", "productName slug images creator")
      .sort({ createdAt: -1 });
    const sellerOrders = orders
      .map((order) => prepareOrderForResponse(order, req))
      .filter((order) => order.items.length > 0);

    return successMessage(res, 200, {
      message: "Seller orders fetched successfully",
      totalOrders: sellerOrders.length,
      orders: sellerOrders,
    });
  } catch (error) {
    next(error);
  }
};

const getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ user: req.id })
      .populate("user", "name email")
      .populate("sellers", "name email")
      .populate("items.seller", "name email")
      .populate("items.product", "productName slug images creator")
      .sort({ createdAt: -1 });

    return successMessage(res, 200, {
      message: "My orders fetched successfully",
      totalOrders: orders.length,
      orders: orders.map((order) => prepareOrderForResponse(order, req)),
    });
  } catch (error) {
    next(error);
  }
};

const canViewOrder = (order, req) => {
  if (req.role === "admin") return true;

  if (req.role === "seller") {
    return order.items.some((item) => sellerOwnsOrderItem(item, req.id));
  }

  return order.user && order.user._id.toString() === req.id;
};

const findPopulatedOrderById = (id, options = {}) => {
  const query = Order.findById(id);

  if (options.includeInvoiceToken) {
    query.select("+invoiceAccessToken");
  }

  return query
    .populate("user", "name email")
    .populate("sellers", "name email")
    .populate("items.seller", "name email")
    .populate("items.product", "productName slug sku images creator variants");
};

const sellerOwnsOrderItem = (item, sellerId) => {
  if (item.seller && item.seller._id && item.seller._id.toString() === sellerId) {
    return true;
  }

  if (item.seller && item.seller.toString && item.seller.toString() === sellerId) {
    return true;
  }

  return Boolean(
    item.product &&
      item.product.creator &&
      item.product.creator.toString() === sellerId
  );
};

const prepareOrderForResponse = (order, req = {}, options = {}) => {
  const plainOrder = typeof order.toObject === "function" ? order.toObject() : order;
  const responseOrder = { ...plainOrder };

  if (!options.includeInvoiceToken) {
    delete responseOrder.invoiceAccessToken;
  }

  if (req.role !== "seller") {
    return responseOrder;
  }

  const sellerItems = responseOrder.items.filter((item) =>
    sellerOwnsOrderItem(item, req.id)
  );
  const sellerTotalAmount = sellerItems.reduce(
    (total, item) => total + Number(item.price || 0) * Number(item.quantity || 0),
    0
  );

  return {
    ...responseOrder,
    items: sellerItems,
    totalAmount: sellerTotalAmount,
    payableAmount: sellerTotalAmount,
    shippingFee: 0,
  };
};

const getInvoiceRecipientEmail = (order) =>
  order?.customer?.email || order?.user?.email || null;

const sendOrderInvoiceEmail = async (order) => {
  const email = getInvoiceRecipientEmail(order);

  if (!email) return;

  try {
    const pdfBuffer = await buildInvoicePdf(prepareOrderForResponse(order, { role: "customer" }));

    await sendEmail({
      email,
      subject: `Cartout invoice ${getOrderNumberForEmail(order)}`,
      html: buildInvoiceEmailHtml(order),
      attachments: [
        {
          filename: getInvoiceFilename(order),
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    const sentAt = new Date();
    order.invoiceEmailSentAt = sentAt;
    order.invoiceEmailError = null;
    await Order.updateOne(
      { _id: order._id },
      { $set: { invoiceEmailSentAt: sentAt, invoiceEmailError: null } }
    );
  } catch (error) {
    order.invoiceEmailError = error.message || "Failed to send invoice email";
    try {
      await Order.updateOne(
        { _id: order._id },
        { $set: { invoiceEmailError: order.invoiceEmailError } }
      );
    } catch (updateError) {
      console.log("failed to store invoice email status", updateError);
    }
  }
};

const getOrderNumberForEmail = (order) =>
  order?.orderNumber ? `#${order.orderNumber}` : `#${String(order?._id || "").slice(-8)}`;

const getInvoiceFilename = (order) => {
  const invoiceNumber = order?.orderNumber || String(order?._id || "").slice(-8);
  return `cartout-invoice-${invoiceNumber}.pdf`;
};

const hasInvoiceTokenAccess = (order, token) =>
  Boolean(token && order?.invoiceAccessToken && token === order.invoiceAccessToken);

const getOrderInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw createError(400, "Invalid order id");
    }

    const order = await findPopulatedOrderById(id, { includeInvoiceToken: true });

    if (!order) {
      throw createError(404, "Order not found");
    }

    const tokenHasAccess = hasInvoiceTokenAccess(order, req.query?.token);
    if (!tokenHasAccess && !req.id) {
      throw createError(401, "Please log in or use a valid invoice link");
    }

    if (!tokenHasAccess && !canViewOrder(order, req)) {
      throw createError(403, "You are not allowed to view this invoice");
    }

    const invoiceOrder = tokenHasAccess
      ? prepareOrderForResponse(order, { role: "customer" })
      : prepareOrderForResponse(order, req);
    const scopeLabel = req.role === "seller" && !tokenHasAccess ? "Seller Copy" : "";
    const pdfBuffer = await buildInvoicePdf(invoiceOrder, { scopeLabel });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${getInvoiceFilename(order)}"`,
      "Content-Length": pdfBuffer.length,
    });
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw createError(400, "Invalid order id");
    }

    const order = await findPopulatedOrderById(id);

    if (!order) {
      throw createError(404, "Order not found");
    }

    if (!canViewOrder(order, req)) {
      throw createError(403, "You are not allowed to view this order");
    }

    return successMessage(res, 200, {
      message: "Order fetched successfully",
      order: prepareOrderForResponse(order, req),
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
  const regularPrice = Number(variant.price);

  if (!discountPrice || !regularPrice || discountPrice >= regularPrice) {
    return regularPrice;
  }

  if (!variant.discountStartDate && !variant.discountEndDate) {
    return discountPrice;
  }

  const now = new Date();
  const startDate = variant.discountStartDate ? new Date(variant.discountStartDate) : null;
  const endDate = variant.discountEndDate ? new Date(variant.discountEndDate) : null;

  if (startDate && Number.isNaN(startDate.getTime())) return regularPrice;
  if (endDate && Number.isNaN(endDate.getTime())) return regularPrice;
  if (startDate && now < startDate) return regularPrice;
  if (endDate && now > endDate) return regularPrice;

  return discountPrice;
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

const updateOrderItemStatus = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(itemId)) {
      throw createError(400, "Invalid order or item id");
    }

    if (!status || !ORDER_STATUSES.includes(status)) {
      throw createError(400, "Valid item status is required");
    }

    const order = await Order.findById(orderId)
      .populate("items.seller", "name email")
      .populate("items.product", "productName slug images creator");

    if (!order) {
      throw createError(404, "Order not found");
    }

    const item = order.items.id(itemId);

    if (!item) {
      throw createError(404, "Order item not found");
    }

    if (req.role !== "admin" && req.role !== "seller") {
      throw createError(403, "Only admin or seller can update item status");
    }

    if (req.role === "seller" && !sellerOwnsOrderItem(item, req.id)) {
      throw createError(403, "You can only update your own product status");
    }

    const previousStatus = item.status || order.status || "Pending";
    const wasStockAdjusted = item.stockAdjusted !== false;

    if (status === previousStatus) {
      return successMessage(res, 200, {
        message: "Item status already set",
        order: prepareOrderForResponse(order, req),
      });
    }

    if (status === "Cancelled" && previousStatus !== "Cancelled" && wasStockAdjusted) {
      await increaseStockAdjustment({
        productId: item.product._id || item.product,
        variantId: item.variant || null,
        quantity: item.quantity,
      });
      item.stockAdjusted = false;
    }

    if (previousStatus === "Cancelled" && status !== "Cancelled" && item.stockAdjusted === false) {
      if (!item.variant) {
        throw createError(400, "Cannot restore legacy item without variant information");
      }

      await decreaseVariantStock(
        item.product._id || item.product,
        item.variant,
        Number(item.quantity || 0)
      );
      item.stockAdjusted = true;
    }

    item.status = status;
    await order.save({ validateBeforeSave: false });

    const updatedOrder = await findPopulatedOrderById(order._id);

    return successMessage(res, 200, {
      message: "Item status updated successfully",
      order: prepareOrderForResponse(updatedOrder, req),
    });
  } catch (error) {
    next(error);
  }
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

    if (req.role !== "admin") {
      throw createError(403, "Only admin can update full order status");
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
    order.items.forEach((item) => {
      item.status = status;
    });
    await order.save({ validateBeforeSave: false });

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
  getMyOrders,
  getOrderById,
  getOrderInvoice,
  updateOrderItemStatus,
  updateOrderStatus,
};


