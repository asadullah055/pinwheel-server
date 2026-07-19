const createError = require("http-errors");
const mongoose = require("mongoose");
const Cart = require("../model/Cart");
const Product = require("../model/Product");
const { successMessage } = require("../utils/response");

const isDiscountActive = (variant) => {
  const discountPrice = Number(variant?.discountPrice);
  const regularPrice = Number(variant?.price);

  if (!discountPrice || !regularPrice || discountPrice >= regularPrice) return false;
  if (!variant.discountStartDate && !variant.discountEndDate) return true;

  const now = new Date();
  const startDate = variant.discountStartDate ? new Date(variant.discountStartDate) : null;
  const endDate = variant.discountEndDate ? new Date(variant.discountEndDate) : null;

  if (startDate && Number.isNaN(startDate.getTime())) return false;
  if (endDate && Number.isNaN(endDate.getTime())) return false;
  if (startDate && now < startDate) return false;
  if (endDate && now > endDate) return false;

  return true;
};

const getProductUnitPrice = (product) => {
  if (!Array.isArray(product?.variants) || product.variants.length === 0) {
    return null;
  }

  const activeVariants = product.variants.filter(
    (variant) => Number(variant?.stock) > 0 && Number(variant?.price) > 0
  );

  if (activeVariants.length === 0) {
    return null;
  }

  return Math.min(
    ...activeVariants.map((variant) => {
      return isDiscountActive(variant)
        ? Number(variant.discountPrice)
        : Number(variant.price);
    })
  );
};

const addToCart = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;

    if (!req.id) {
      throw createError(401, "Unauthorized request");
    }

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      throw createError(400, "Valid productId is required");
    }

    const qty = Number(quantity || 1);
    if (!Number.isInteger(qty) || qty < 1) {
      throw createError(400, "Quantity must be a positive integer");
    }

    const product = await Product.findById(productId).select(
      "productName status variants"
    );

    if (!product) {
      throw createError(404, "Product not found");
    }

    if (product.status !== "published") {
      throw createError(400, "Only published products can be added to cart");
    }

    const totalStock = (product.variants || []).reduce(
      (sum, variant) => sum + Number(variant?.stock || 0),
      0
    );

    if (totalStock < qty) {
      throw createError(400, `Only ${totalStock} item(s) available in stock`);
    }

    let cart = await Cart.findOne({ user: req.id });

    if (!cart) {
      cart = await Cart.create({
        user: req.id,
        products: [{ product: product._id, quantity: qty }],
        totalPrice: 0,
      });
    } else {
      const index = cart.products.findIndex(
        (item) => item.product.toString() === productId
      );

      if (index > -1) {
        const newQty = cart.products[index].quantity + qty;
        if (newQty > totalStock) {
          throw createError(400, `Only ${totalStock} item(s) available in stock`);
        }
        cart.products[index].quantity = newQty;
      } else {
        cart.products.push({ product: product._id, quantity: qty });
      }

      await cart.save();
    }

    const fullCart = await Cart.findById(cart._id).populate(
      "products.product",
      "productName slug images variants status"
    );

    let totalPrice = 0;

    for (const item of fullCart.products) {
      const unitPrice = getProductUnitPrice(item.product);
      if (unitPrice) {
        totalPrice += unitPrice * item.quantity;
      }
    }

    fullCart.totalPrice = totalPrice;
    await fullCart.save();

    const populatedCart = await Cart.findById(fullCart._id).populate(
      "products.product",
      "productName slug images variants status"
    );

    return successMessage(res, 200, {
      message: "Product added to cart successfully",
      cart: populatedCart,
    });
  } catch (error) {
    next(error);
  }
};

const getMyCart = async (req, res, next) => {
  try {
    if (!req.id) {
      throw createError(401, "Unauthorized request");
    }

    const cart = await Cart.findOne({ user: req.id }).populate(
      "products.product",
      "productName slug images variants status"
    );

    if (!cart) {
      return successMessage(res, 200, {
        message: "Cart is empty",
        cart: { user: req.id, products: [], totalPrice: 0 },
      });
    }

    let totalPrice = 0;
    for (const item of cart.products) {
      const unitPrice = getProductUnitPrice(item.product);
      if (unitPrice) {
        totalPrice += unitPrice * item.quantity;
      }
    }

    cart.totalPrice = totalPrice;
    await cart.save();

    return successMessage(res, 200, {
      message: "Cart fetched successfully",
      cart,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addToCart,
  getMyCart,
};
