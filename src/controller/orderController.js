const createError = require("http-errors");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { waitUntil } = require("@vercel/functions");
const Order = require("../model/Order");
const Product = require("../model/Product");
const {
  buildInvoiceEmailHtml,
  buildInvoicePdf,
  buildSellerOrderEmailHtml,
} = require("../utils/invoice");
const { successMessage } = require("../utils/response");
const { sendEmail } = require("../utils/sendEmail");
const { getPaymentOptions, buildOrderPayment } = require("../utils/payment");
const { LIMITS, money, parse } = require("../utils/inputSecurity");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toTrimmedString = (value) =>
  value === undefined || value === null ? "" : String(value).trim();

const firstFilled = (...values) =>
  values.map(toTrimmedString).find((value) => value.length > 0) || "";

const normalizeShippingAddress = (shippingAddress) => {
  const fullAddress = firstFilled(
    shippingAddress.fullAddress,
    shippingAddress.street,
    shippingAddress.addressLine,
    shippingAddress.displayAddress,
    shippingAddress.address
  );

  if (!fullAddress) {
    throw createError(400, "Shipping address is required");
  }

  return {
    fullAddress,
  };
};

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
    const checkoutRequestId = req.body.checkoutRequestId;
    const checkoutAccessHash = checkoutRequestId ? checkoutSecretHash(req.body.checkoutAccessToken) : undefined;
    if (checkoutRequestId && (typeof checkoutRequestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutRequestId))) {
      throw createError(400, "Invalid checkout request id");
    }
    if (paymentMethod === "bKash" && !checkoutRequestId) throw createError(400, "Checkout request id is required");
    if (checkoutRequestId) {
      const existingOrder = await Order.findOne({ checkoutRequestId }).select("+invoiceAccessToken +checkoutAccessHash");
      if (existingOrder) {
        authorizeCheckoutRetry(existingOrder, req);
        const populated = await findPopulatedOrderById(existingOrder._id, { includeInvoiceToken: true });
        return successMessage(res, 200, { message: "Order already created", order: prepareOrderForResponse(populated, req, { includeInvoiceToken: true }) });
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw createError(400, "Order items are required");
    }

    if (!shippingAddress || typeof shippingAddress !== "object") {
      throw createError(400, "Shipping address is required");
    }

    const normalizedShippingAddress = normalizeShippingAddress(shippingAddress);

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
      if (!customer.email || !String(customer.email).trim()) {
        throw createError(400, "Customer email is required for invoice email");
      }
    }

    if (
      customer?.email &&
      !EMAIL_PATTERN.test(String(customer.email).trim().toLowerCase())
    ) {
      throw createError(400, "Customer email must be a valid email address");
    }

    let parsedShippingFee = Number(shippingFee ?? 0);
    if (!Number.isFinite(parsedShippingFee) || parsedShippingFee < 0) {
      throw createError(400, "Shipping fee must be a valid non-negative number");
    }

    const normalizedItems = [];
    const sellerIds = new Set();
    const shippingBySeller = new Map();
    const chargeKey = normalizedShippingAddress.fullAddress.toLowerCase().includes("dhaka")
      ? "insideDhaka" : "outsideDhaka";
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
        "productName status variants creator shippingCharge"
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

      if (requestedVariantId !== undefined && !mongoose.isObjectIdOrHexString(requestedVariantId)) {
        throw createError(400, "Invalid variant id");
      }

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
      parse(money.refine((value) => value > 0, "Invalid product price"), unitPrice);

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
      const sellerKey = String(product.creator || product._id);
      const charge = Number(product.shippingCharge?.[chargeKey] ?? (chargeKey === "insideDhaka" ? 80 : 120));
      if (!Number.isFinite(charge) || charge < 0) throw createError(400, "Invalid product delivery charge");
      shippingBySeller.set(sellerKey, Math.max(shippingBySeller.get(sellerKey) || 0, charge));
    }

    const currentShippingFee = Array.from(shippingBySeller.values()).reduce((sum, charge) => sum + charge, 0);
    if (Math.abs(parsedShippingFee - currentShippingFee) > 0.001) {
      throw createError(400, "Delivery charge has changed. Please refresh checkout and review your order.");
    }
    parsedShippingFee = currentShippingFee;
    const payableAmount = totalAmount + parsedShippingFee;
    parse(money, payableAmount);
    if (paymentMethod === "bKash" && (typeof req.body.expectedTotal !== "number" || Math.abs(req.body.expectedTotal - payableAmount) > 0.001 || !Number.isFinite(req.body.expectedTotal))) {
      throw createError(400, "Order price has changed. Please update the products in your cart and review the total before paying.");
    }
    const payment = buildOrderPayment(req.body, payableAmount);
    if (payment.status === "Awaiting Payment") normalizedItems.forEach((item) => { item.status = "Awaiting Payment"; });

    const qtyMap = buildQuantityMap(normalizedItems);
    if ([...qtyMap.values()].some((item) => item.quantity > LIMITS.quantity)) {
      throw createError(400, "Total quantity for one variant exceeds the order limit");
    }
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
      shippingAddress: normalizedShippingAddress,
      ...payment,
      ...(checkoutRequestId ? { checkoutRequestId } : {}),
      ...(checkoutRequestId ? { checkoutAccessHash } : {}),
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
      if (error.code === 11000 && error.keyPattern?.checkoutRequestId) {
        const existing = await Order.findOne({ checkoutRequestId }).select("+checkoutAccessHash");
        if (!existing) throw createError(409, "Checkout is being processed. Please retry");
        authorizeCheckoutRetry(existing, req);
        const populated = await findPopulatedOrderById(existing._id, { includeInvoiceToken: true });
        return successMessage(res, 200, { message: "Order already created", order: prepareOrderForResponse(populated, req, { includeInvoiceToken: true }) });
      }
      if (error.code === 11000 && error.keyPattern?.["bkash.transactionId"]) {
        throw createError(409, "This bKash Transaction ID has already been used for an order");
      }
      throw error;
    }

    const populatedOrder = await findPopulatedOrderById(order._id, {
      includeInvoiceToken: true,
    });
    if (paymentMethod === "Cash on Delivery") queueOrderEmails(populatedOrder);

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
      .populate("sellers", "name email shopName shopLogo mobileNumber")
      .populate("items.seller", "name email shopName shopLogo mobileNumber")
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

const getOrderPaymentOptions = (_req, res) => {
  res.set("Cache-Control", "no-store");
  return successMessage(res, 200, getPaymentOptions());
};

const checkoutSecretHash = (secret) => {
  if (typeof secret !== "string" || !/^[a-f\d]{64}$/.test(secret)) throw createError(400, "Checkout access token is required");
  return crypto.createHash("sha256").update(secret).digest("hex");
};
const authorizeCheckoutRetry = (order, req) => {
  const owner = req.id && order.user && String(order.user) === req.id;
  const secret = req.body.checkoutAccessToken;
  const digest = typeof secret === "string" ? checkoutSecretHash(secret) : "";
  const valid = order.checkoutAccessHash && digest.length === order.checkoutAccessHash.length &&
    crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(order.checkoutAccessHash));
  if (!owner && !valid) throw createError(403, "Valid checkout access is required");
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
      .populate("sellers", "name email shopName shopLogo mobileNumber")
      .populate("items.seller", "name email shopName shopLogo mobileNumber")
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
      .populate("sellers", "name email shopName shopLogo mobileNumber")
      .populate("items.seller", "name email shopName shopLogo mobileNumber")
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
    .populate("sellers", "name email shopName shopLogo mobileNumber")
    .populate("items.seller", "name email shopName shopLogo mobileNumber")
    .populate("items.product", "productName slug sku images creator variants");
};

const sellerOwnsOrderItem = (item, sellerId) => {
  if (item.seller) {
    return String(item.seller._id || item.seller) === String(sellerId);
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
  if (responseOrder.bkash) {
    responseOrder.bkash = { ...responseOrder.bkash };
    ["signature", "callbackToken", "lockId", "lockUntil", "executeStartedAt", "checkoutUrl"].forEach((key) => delete responseOrder.bkash[key]);
  }
  delete responseOrder.checkoutRequestId;
  delete responseOrder.checkoutAccessHash;
  responseOrder.dueAmount = Math.max(Number(plainOrder.payableAmount || 0) - Number(plainOrder.paidAmount || 0), 0);

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
    // The merchant payment belongs to the whole order, not an individual seller.
    paymentAmount: undefined,
    paidAmount: undefined,
    dueAmount: undefined,
    bkash: undefined,
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

const getSellerOrderGroups = (order) => {
  const groups = new Map();

  for (const item of order?.items || []) {
    const seller = item?.seller;
    const sellerId = seller?._id?.toString?.() || seller?.toString?.();
    const email = seller?.email ? String(seller.email).trim().toLowerCase() : "";

    if (!sellerId || !email || !EMAIL_PATTERN.test(email)) continue;

    if (!groups.has(sellerId)) {
      groups.set(sellerId, { sellerId, seller, email, items: [] });
    }

    groups.get(sellerId).items.push(item);
  }

  return [...groups.values()];
};

const sendSellerOrderNotifications = async (order) => {
  const sellerGroups = getSellerOrderGroups(order);

  if (sellerGroups.length === 0) {
    await Order.updateOne(
      { _id: order._id },
      { $set: { sellerNotificationError: "No seller email recipient found" } }
    );
    return;
  }

  const results = [];

  // Generate seller PDFs sequentially to avoid launching several Chromium
  // instances at once for a multi-seller order. The customer invoice job can
  // still run alongside this task.
  for (const { sellerId, seller, email, items } of sellerGroups) {
    try {
      const sellerOrder = prepareOrderForResponse(order, {
        role: "seller",
        id: sellerId,
      });
      const pdfBuffer = await buildInvoicePdf(sellerOrder, {
        scopeLabel: "Seller Copy",
      });

      await sendEmail({
        email,
        subject: `New Cartout order ${getOrderNumberForEmail(order)}`,
        html: buildSellerOrderEmailHtml(order, seller, items),
        attachments: [
          {
            filename: getInvoiceFilename(order),
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });
      results.push({ status: "fulfilled" });
    } catch (reason) {
      results.push({ status: "rejected", reason });
      console.log("seller invoice email failed", reason);
    }
  }

  const failedResults = results.filter((result) => result.status === "rejected");

  if (failedResults.length > 0) {
    const errorMessage = `${failedResults.length} of ${sellerGroups.length} seller notification emails failed`;
    await Order.updateOne(
      { _id: order._id },
      { $set: { sellerNotificationSentAt: null, sellerNotificationError: errorMessage } }
    );
    console.log(errorMessage);
    return;
  }

  const sentAt = new Date();
  order.sellerNotificationSentAt = sentAt;
  await Order.updateOne(
    { _id: order._id },
    { $set: { sellerNotificationSentAt: sentAt, sellerNotificationError: null } }
  );
};

const queueOrderEmails = (order) => {
  const run = async () => {
    const results = await Promise.allSettled([
      sendOrderInvoiceEmail(order),
      sendSellerOrderNotifications(order),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        console.log("failed to queue order email", result.reason);
      }
    }
  };

  // Vercel may freeze the function as soon as the response is sent. Register
  // the email task with the request lifecycle so it can finish in the
  // background without delaying the order confirmation response.
  if (process.env.VERCEL) {
    waitUntil(run());
    return;
  }

  if (typeof setImmediate === "function") {
    setImmediate(run);
    return;
  }

  setTimeout(run, 0);
};

const getDocumentId = (value) => {
  if (!value) return null;

  if (value._id) return value._id.toString();
  if (value.$oid) return value.$oid.toString();

  return value.toString();
};

const buildQuantityMap = (items) => {
  const qtyMap = new Map();

  for (const item of items) {
    const productId = getDocumentId(item.product);
    const variantId = getDocumentId(item.variant);

    if (!productId) {
      throw createError(400, "Order item product information is missing");
    }

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

const decreaseVariantStock = async (productId, variantId, quantity, session) => {
  const result = await Product.updateOne({ _id: productId, status: "published",
    variants: { $elemMatch: { _id: variantId, availability: { $ne: false }, stock: { $gte: quantity } } },
  }, { $inc: { "variants.$.stock": -quantity, __v: 1 } }, { session });
  if (result.modifiedCount !== 1) throw createError(400, "Selected product variant is out of stock");
};
const increaseVariantStock = async (productId, variantId, quantity, session) => {
  const result = await Product.updateOne({ _id: productId, "variants._id": variantId },
    { $inc: { "variants.$.stock": quantity, __v: 1 } }, { session });
  if (result.modifiedCount !== 1) throw createError(409, "Cannot restore stock: the ordered variant no longer exists");
};
const increaseLegacyProductStock = async (productId, quantity, session) => {
  const product = await Product.findById(productId).select("variants").session(session || null);
  if (!product || !Array.isArray(product.variants) || product.variants.length === 0) {
    throw createError(409, "Cannot restore stock: product no longer exists");
  }
  product.variants[0].stock = Number(product.variants[0].stock || 0) + Number(quantity || 0);
  await product.save({ session });
};
const increaseStockAdjustment = async (adjustment, session) => {
  if (adjustment.variantId) {
    return increaseVariantStock(adjustment.productId, adjustment.variantId, adjustment.quantity, session);
  }
  return increaseLegacyProductStock(adjustment.productId, adjustment.quantity, session);
};

const rollbackStockAdjustments = async (adjustments) => {
  await Promise.all(adjustments.map((adjustment) => increaseStockAdjustment(adjustment)));
};

const checkUnpaidBkashStatus = (order, status, itemOnly = false) => {
  if (order.paymentMethod !== "bKash" || Number(order.paidAmount) > 0) return;
  if (status === "Awaiting Payment") return;
  if (!itemOnly && status === "Cancelled" &&
      (!order.bkash?.paymentId || order.bkash.createdAt < new Date(Date.now() - 24 * 60 * 60 * 1000)) &&
      !(order.bkash?.lockUntil > new Date())) return;
  throw createError(409, "This bKash order is awaiting payment. An unpaid order can only be cancelled as a whole after its active payment session expires (24 hours).");
};

// Inventory and order status commit together. Driver retries re-read current state,
// preventing concurrent cancellations from restoring the same reservation twice.
const transitionOrder = async (req, itemOnly) => {
  const id = itemOnly ? req.params.orderId : req.params.id;
  const status = req.body.status;
  if (!mongoose.isObjectIdOrHexString(id) || (itemOnly && !mongoose.isObjectIdOrHexString(req.params.itemId))) {
    throw createError(400, "Invalid order or item id");
  }
  if (!ORDER_STATUSES.includes(status)) throw createError(400, "Valid status is required");
  if (itemOnly ? !["admin", "seller"].includes(req.role) : req.role !== "admin") {
    throw createError(403, itemOnly ? "Only admin or seller can update item status" : "Only admin can update full order status");
  }
  await mongoose.connection.transaction(async (session) => {
    const order = await Order.findById(id).session(session).populate("items.product", "creator");
    if (!order) throw createError(404, "Order not found");
    let items = order.items;
    if (itemOnly) {
      const item = order.items.id(req.params.itemId);
      if (!item) throw createError(404, "Order item not found");
      if (req.role === "seller" && !sellerOwnsOrderItem(item, req.id)) {
        throw createError(403, "You can only update your own product status");
      }
      items = [item];
    }
    checkUnpaidBkashStatus(order, status, itemOnly);
    const restoring = items.filter((item) => status === "Cancelled" && item.stockAdjusted !== false);
    const reserving = items.filter((item) => status !== "Cancelled" && item.stockAdjusted === false);
    for (const adjustment of buildQuantityMap(restoring).values()) {
      await increaseStockAdjustment(adjustment, session);
    }
    for (const adjustment of buildQuantityMap(reserving).values()) {
      if (!adjustment.variantId) throw createError(400, "Cannot restore legacy item without variant information");
      await decreaseVariantStock(adjustment.productId, adjustment.variantId, adjustment.quantity, session);
    }
    for (const item of items) {
      item.status = status;
      item.stockAdjusted = status !== "Cancelled";
    }
    if (!itemOnly) order.status = status;
    order.stockAdjusted = order.items.some((item) => item.stockAdjusted !== false);
    await order.save({ session, validateBeforeSave: false });
  });
  return id;
};
const updateOrderItemStatus = async (req, res, next) => {
  try {
    const id = await transitionOrder(req, true);
    return successMessage(res, 200, { message: "Item status updated successfully",
      order: prepareOrderForResponse(await findPopulatedOrderById(id), req) });
  } catch (error) { next(error); }
};
const updateOrderStatus = async (req, res, next) => {
  try {
    const id = await transitionOrder(req, false);
    return successMessage(res, 200, { message: "Order status updated successfully",
      order: prepareOrderForResponse(await findPopulatedOrderById(id), req) });
  } catch (error) { next(error); }
};

module.exports = {
  getOrderPaymentOptions,
  findPopulatedOrderById,
  prepareOrderForResponse,
  queueOrderEmails,
  createOrder,
  getAllOrders,
  getSellerOrders,
  getMyOrders,
  getOrderById,
  getOrderInvoice,
  updateOrderItemStatus,
  updateOrderStatus,
};


