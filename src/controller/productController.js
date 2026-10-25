const createError = require("http-errors");
const mongoose = require("mongoose");
const { reconcileVariants } = require("../utils/productVariants");

const { successMessage } = require("../utils/response");
const Product = require("../model/Product");
const Brand = require("../model/Brand");
const Category = require("../model/Category");
const { createSecureForm } = require("../utils/secureForm");
const { verifyProductImages } = require("./uploadController");
const {
  uploadToCloudinary,
} = require("../helper/cloudinary");
const {
  generateUniqueSKU,
  generateVariantSKUs,
} = require("../utils/skuGenerator.js");

const DEFAULT_INSIDE_DHAKA_SHIPPING = 80;
const DEFAULT_OUTSIDE_DHAKA_SHIPPING = 120;
const MAX_PRODUCT_IMAGES = 8;

const getFieldValue = (value) => (Array.isArray(value) ? value[0] : value);

const parseOptionalNumber = (value, fallback) => {
  value = getFieldValue(value);
  if (typeof value === "string") value = value.trim();
  if (value === undefined || value === null || value === "") return fallback;

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : NaN;
};

const normalizeShippingCharge = (
  insideDhaka,
  outsideDhaka,
  fallback = {}
) => {
  const parsedInsideDhaka = parseOptionalNumber(
    insideDhaka,
    fallback.insideDhaka ?? DEFAULT_INSIDE_DHAKA_SHIPPING
  );
  const parsedOutsideDhaka = parseOptionalNumber(
    outsideDhaka,
    fallback.outsideDhaka ?? DEFAULT_OUTSIDE_DHAKA_SHIPPING
  );

  if (parsedInsideDhaka < 0 || parsedOutsideDhaka < 0) {
    throw createError(400, "Shipping charge must be a valid non-negative number");
  }

  if (!Number.isFinite(parsedInsideDhaka) || !Number.isFinite(parsedOutsideDhaka)) {
    throw createError(400, "Shipping charge must be a valid number");
  }

  return {
    insideDhaka: parsedInsideDhaka,
    outsideDhaka: parsedOutsideDhaka,
  };
};

const parseExistingImages = (value, fallback = []) => {
  if (value === undefined || value === null) return fallback;

  const values = Array.isArray(value) ? value : [value];
  const images = [];

  for (const item of values) {
    try {
      const parsed = JSON.parse(item);
      const parsedImages = Array.isArray(parsed) ? parsed : [parsed];
      images.push(
        ...parsedImages
          .filter((image) => typeof image === "string")
          .map((image) => image.trim())
          .filter(Boolean)
      );
    } catch {
      if (typeof item === "string" && item.trim()) images.push(item.trim());
    }
  }

  return [...new Set(images)];
};

const validateProductImageCount = (images) => {
  if (images.length > MAX_PRODUCT_IMAGES) {
    throw createError(
      400,
      `A product can have a maximum of ${MAX_PRODUCT_IMAGES} images`
    );
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getSkuSearchTerms = (value) => {
  const terms = [value];
  const withoutLabel = value.replace(/^sku[-:\s]*/i, "").trim();

  if (withoutLabel && withoutLabel !== value) {
    terms.push(withoutLabel);
  }

  return [...new Set(terms)];
};

const normalizeDiscountFields = (variant, index) => {
  if (variant.discountPrice === "" || variant.discountPrice === null) {
    delete variant.discountPrice;
  } else if (variant.discountPrice !== undefined) {
    variant.discountPrice = Number(variant.discountPrice);
  }

  const hasStartDate = Boolean(variant.discountStartDate);
  const hasEndDate = Boolean(variant.discountEndDate);

  if (!hasStartDate && !hasEndDate) {
    delete variant.discountStartDate;
    delete variant.discountEndDate;
    return;
  }

  if (!variant.discountPrice) {
    throw createError(
      400,
      `Variant ${index + 1}: Discount price is required for discount timing`
    );
  }

  if (!hasStartDate || !hasEndDate) {
    throw createError(
      400,
      `Variant ${index + 1}: Discount start and end dates are both required`
    );
  }

  const startDate = new Date(variant.discountStartDate);
  const endDate = new Date(variant.discountEndDate);
  endDate.setHours(23, 59, 59, 999);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw createError(400, `Variant ${index + 1}: Invalid discount date`);
  }

  if (endDate < startDate) {
    throw createError(
      400,
      `Variant ${index + 1}: Discount end date must be after start date`
    );
  }

  variant.discountStartDate = startDate;
  variant.discountEndDate = endDate;
};

const getProductImageUploadSignature = async (req, res, next) => {
  next(createError(410, "Use the validated product image upload endpoint"));
};


const createProduct = async (req, res, next) => {
  const form = createSecureForm("productCreate");

  return form.parse(req, async (err, fields, files) => {
    if (err) return next(err);

    try {
      // Extract fields from form
      let {
        productName,
        description,
        shortDescription,
        category,
        brand,
        slug,
        weight,
        length,
        width,
        height,
        warrantyPolicy,
        warrantyTime,
        warrantyType,
        shippingInsideDhaka,
        shippingOutsideDhaka,
        status,
        seoTitle,
        seoContent,
        attributes,
        variants,
        existingImages,
      } = fields;

      // Trim strings
      productName = productName?.trim();
      description = description?.trim();
      shortDescription = shortDescription?.trim();
      seoTitle = seoTitle?.trim();
      seoContent = seoContent?.trim();
      status = status || "unpublished";

      // Convert numeric fields
      const convert = (val) => (val ? Number(val) : undefined);
      weight = convert(weight);
      length = convert(length);
      width = convert(width);
      height = convert(height);
      const shippingCharge = normalizeShippingCharge(
        shippingInsideDhaka,
        shippingOutsideDhaka
      );

      // Validate dimensions
      for (const [key, val] of Object.entries({
        weight,
        length,
        width,
        height,
      })) {
        if (val !== undefined && (isNaN(val) || val <= 0))
          return next(
            createError(400, `${key} must be a valid positive number`)
          );
      }

      // Required field check
      if (
        !productName ||
        !description ||
        !category ||
        !brand
      ) {
        return next(
          createError(
            400,
            "Product name, description, category, and brand are required"
          )
        );
      }

      // Parse attributes (main product attributes)
      let parsedAttributes = [];
      if (attributes) {
        try {
          parsedAttributes = JSON.parse(attributes);
          if (!Array.isArray(parsedAttributes)) {
            return next(createError(400, "Attributes must be an array"));
          }
        } catch (e) {
          return next(createError(400, "Invalid attributes format"));
        }
      }

      // Parse variants
      let parsedVariants = [];
      if (variants) {
        try {
          parsedVariants = JSON.parse(variants);

          if (!Array.isArray(parsedVariants)) {
            return next(createError(400, "Variants must be an array"));
          }

          // Loop through each variant for validation & conversion
          for (let i = 0; i < parsedVariants.length; i++) {
            const variant = parsedVariants[i];

            // Convert numbers
            variant.price = Number(variant.price);
            variant.stock = Number(variant.stock);
            normalizeDiscountFields(variant, i);

            // Validation
            if (isNaN(variant.price) || variant.price <= 0) {
              return next(createError(400, `Variant ${i + 1}: Invalid price`));
            }
            if (isNaN(variant.stock) || variant.stock < 0) {
              return next(createError(400, `Variant ${i + 1}: Invalid stock`));
            }
            if (
              variant.discountPrice !== undefined &&
              (isNaN(variant.discountPrice) || variant.discountPrice < 0)
            ) {
              return next(
                createError(400, `Variant ${i + 1}: Invalid discount price`)
              );
            }
            if (
              variant.discountPrice &&
              variant.discountPrice >= variant.price
            ) {
              return next(
                createError(
                  400,
                  `Variant ${i + 1}: Discount price must be less than price`
                )
              );
            }

            variant.attributes = variant.attributes || {};

            // Availability
            variant.availability = variant.availability;
          }
        } catch (e) {
          if (e.status || e.statusCode) return next(e);
          return next(createError(400, "Invalid variants format"));
        }
      }

      if (parsedVariants.length === 0)
        return next(createError(400, "At least one variant is required"));

      // Check for existing product
      if (!await Category.exists({ _id: category, status: "active" }) || !await Brand.exists({ _id: brand, status: "active" })) {
        throw createError(400, "Choose an active category and brand");
      }
      const existingProduct = await Product.findOne({
        productName: { $regex: `^${escapeRegex(productName)}$`, $options: "i" },
      });

      if (existingProduct)
        return next(createError(400, "Product with this name already exists"));

      // 🔥 Generate variant SKUs (auto-generate if not provided)

      parsedVariants = await generateVariantSKUs(parsedVariants);

      // Handle image upload
      let imageUrls = parseExistingImages(existingImages, []);
      await verifyProductImages(imageUrls, req.id);
      if (files.images) {
        const allowedTypes = [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/webp",
        ];
        const images = Array.isArray(files.images)
          ? files.images
          : [files.images];

        validateProductImageCount([...imageUrls, ...images]);

        for (const img of images) {
          if (!allowedTypes.includes(img.mimetype))
            return next(
              createError(400, `${img.originalFilename}: Invalid image type`)
            );
        }

        const uploadedImageUrls = await Promise.all(
          images.map(async (img) => {
            const result = await uploadToCloudinary(img.filepath, "products");
            return result.url;
          })
        );

        imageUrls = [...imageUrls, ...uploadedImageUrls];
      }

      imageUrls = [...new Set(imageUrls)];
      validateProductImageCount(imageUrls);
      if (imageUrls.length === 0) throw createError(400, "At least one product image is required");

      // Generate main SKU

      const mainSKU = await generateUniqueSKU();

      // Create final product object
      const productData = {
        productName,
        category,
        brand,
        description,
        shortDescription,
        creator: req.id,
        slug:
          slug ||
          productName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
        images: imageUrls,
        weight,
        length,
        width,
        height,
        warrantyType: warrantyType || "no warranty",
        warrantyTime: warrantyType === "no warranty" ? "" : warrantyTime,
        warrantyPolicy: warrantyType === "no warranty" ? "" : warrantyPolicy,
        shippingCharge,
        sku: mainSKU,
        status,
        seoTitle,
        seoContent,
        attributes: parsedAttributes,
        variants: parsedVariants,
      };

      const newProduct = new Product(productData);
      const savedProduct = await newProduct.save();

      const populated = await Product.findById(savedProduct._id)
        .populate("category", "name")
        .populate("brand", "name")
        .populate("creator", "name email shopName");

      return successMessage(res, 201, {
        message: "Product created successfully",
        product: populated,
      });
    } catch (error) {
      console.error("Product creation error:", error);
      if (error.status || error.statusCode) return next(error);
      next(createError(500, error.message || "Failed to create product"));
    }
  });
};

const getAllProducts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const skuQuery = getFieldValue(req.query.sku);
    const skuSearch =
      req.role === "admin" && typeof skuQuery === "string"
        ? skuQuery.trim()
        : "";

    let filter = {};

    if (req.id) {
      if (req.role === "seller") {
        filter.creator = req.id;
      }
    } else {
      filter.status = "published";
    }

    if (skuSearch) {
      const skuConditions = getSkuSearchTerms(skuSearch).flatMap((term) => {
        const skuRegex = new RegExp(escapeRegex(term), "i");
        return [{ sku: skuRegex }, { "variants.sku": skuRegex }];
      });

      filter.$or = skuConditions;
    }

    if (req.id && ["published", "unpublished"].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const totalProducts = await Product.countDocuments(filter);

    const products = await Product.find(filter)
      .populate("category", "name")
      .populate("brand", "name")
      .populate("creator", "name email shopName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    if (!products || products.length === 0) {
      return successMessage(res, 200, {
        message: "No Products found",
        products: [],
        totalProducts: 0,
      });
    }
    // console.log(products);
    return successMessage(res, 200, {
      message: "Products fetched successfully",
      products,
      totalProducts,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};
const getPublicProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;
    const categoryId = String(req.query.category || "").trim();
    const search = String(req.query.search || req.query.q || "").trim().slice(0, 100);

    const filter = { status: "published", variants: { $elemMatch: { availability: true } } };

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw createError(400, "Invalid category id");
      }

      filter.category = categoryId;
    }

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), "i");
      const [brandIds, categoryIds] = await Promise.all([
        Brand.find({ name: searchRegex }).distinct("_id"),
        Category.find({ name: searchRegex }).distinct("_id"),
      ]);

      filter.$or = [
        { productName: searchRegex },
        { description: searchRegex },
        { shortDescription: searchRegex },
        { sku: searchRegex },
        { "variants.sku": searchRegex },
        { brand: { $in: brandIds } },
        { category: { $in: categoryIds } },
      ];
    }

    // Cards do not need descriptions, gallery images, or brand/category documents.
    // Count and page queries are independent and can run concurrently.
    const [totalProducts, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .select("productName slug creator shippingCharge variants._id variants.price variants.discountPrice variants.discountStartDate variants.discountEndDate variants.stock variants.availability variants.attributes")
        .slice("images", 1)
        .populate("creator", "name shopName")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return successMessage(res, 200, {
      message: products.length ? "Products fetched successfully" : "No Products found",
      products,
      totalProducts,
      page,
      totalPages: Math.ceil(totalProducts / limit),
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

// get product by id
const getProductById = async (req, res, next) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) throw createError(400, "Invalid product id");
    const product = await Product.findOne({ _id: req.params.id, status: "published" })
      .populate("category", "name").populate("brand", "name")
      .populate("creator", "name shopName shopUrl shopLogo sellerId");
    if (!product) throw createError(404, "Product not found");
    return successMessage(res, 200, { product });
  } catch (error) { next(error); }
};
const getManagedProductById = async (req, res, next) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) throw createError(400, "Invalid product id");
    const product = await Product.findById(req.params.id)
      .populate("category", "name").populate("brand", "name")
      .populate("creator", "name shopName");
    if (!product) throw createError(404, "Product not found");
    if (req.role !== "admin" && String(product.creator?._id || product.creator) !== req.id) {
      throw createError(403, "You can only view your own product drafts");
    }
    return successMessage(res, 200, { product });
  } catch (error) { next(error); }
};


const updateProduct = async (req, res, next) => {
  let product;
  const productId = req.params.id;
  try {
    if (!mongoose.isObjectIdOrHexString(productId)) throw createError(400, "Invalid product id");
    product = await Product.findById(productId);
    if (!product) throw createError(404, "Product not found");
    if (req.role !== "admin" && String(product.creator?._id || product.creator) !== req.id) {
      throw createError(403, "You are not authorized to update this product");
    }
    if (product.__v === undefined) {
      // Older products were stored with versionKey disabled. Initialize once,
      // then reload so a concurrent inventory write is included in the snapshot.
      await Product.updateOne({ _id: productId, __v: { $exists: false } }, { $set: { __v: 0 } });
      product = await Product.findById(productId);
      if (!product) throw createError(404, "Product not found");
    }
  } catch (error) { return next(error); }
  const form = createSecureForm("productUpdate", { existing: product });

  return form.parse(req, async (err, fields, files) => {
    if (err) return next(err);

    try {
      // Extract fields
      let {
        productName,
        description,
        shortDescription,
        category,
        brand,
        slug,
        weight,
        length,
        width,
        height,
        warrantyPolicy,
        warrantyTime,
        warrantyType,
        shippingInsideDhaka,
        shippingOutsideDhaka,
        status,
        seoTitle,
        seoContent,
        attributes,
        variants,
        existingImages,
      } = fields;

      // Trim strings
      productName = productName?.trim();
      description = description?.trim();
      shortDescription = shortDescription?.trim();
      seoTitle = seoTitle?.trim();
      seoContent = seoContent?.trim();

      // Maintain old status if not provided
      status = status || product.status;

      // Convert numeric fields
      const convert = (val) => (val ? Number(val) : undefined);
      weight = convert(weight);
      length = convert(length);
      width = convert(width);
      height = convert(height);
      const shippingCharge = normalizeShippingCharge(
        shippingInsideDhaka,
        shippingOutsideDhaka,
        product.shippingCharge
      );

      // Validate number fields
      for (const [key, val] of Object.entries({
        weight,
        length,
        width,
        height,
      })) {
        if (val !== undefined && (isNaN(val) || val <= 0)) {
          return next(
            createError(400, `${key} must be a valid positive number`)
          );
        }
      }

      // Required fields validation
      if (
        productName === "" ||
        description === "" ||
        category === "" ||
        brand === ""
      ) {
        return next(createError(400, "Required fields cannot be empty"));
      }

      /* ------------------------------------------------------------------
       🔥 UNIQUE CHECK: PRODUCT NAME + SLUG
      ------------------------------------------------------------------ */

      // 1. Product Name Duplicate Check
      if ((category && !await Category.exists({ _id: category, status: "active" })) ||
          (brand && !await Brand.exists({ _id: brand, status: "active" }))) {
        throw createError(400, "Choose an active category and brand");
      }
      if (productName && productName !== product.productName) {
        const existsName = await Product.findOne({
          productName: productName,
          _id: { $ne: productId },
        });

        if (existsName) {
          return next(createError(400, "Product name already exists"));
        }
      }

      // 2. Build new slug (from slug field or productName)
      let newSlug = slug
        ? slug.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        : productName
        ? productName.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        : product.slug;

      // 3. Slug Duplicate Check
      if (newSlug !== product.slug) {
        const existsSlug = await Product.findOne({
          slug: newSlug,
          _id: { $ne: productId },
        });

        if (existsSlug) {
          return next(createError(400, "Slug already exists"));
        }
      }

      /* ------------------------------------------------------------------
       ✔️ Parse and validate attributes
      ------------------------------------------------------------------ */
      let parsedAttributes = product.attributes;

      if (attributes) {
        try {
          parsedAttributes = JSON.parse(attributes);
          if (!Array.isArray(parsedAttributes)) {
            return next(createError(400, "Attributes must be an array"));
          }
        } catch {
          return next(createError(400, "Invalid attributes JSON format"));
        }
      }

      /* ------------------------------------------------------------------
       ✔️ Parse and validate variants
      ------------------------------------------------------------------ */
      let parsedVariants = product.variants;

      if (variants) {
        try {
          parsedVariants = JSON.parse(variants);

          if (!Array.isArray(parsedVariants)) {
            return next(createError(400, "Variants must be an array"));
          }

          for (let i = 0; i < parsedVariants.length; i++) {
            const v = parsedVariants[i];

            v.price = Number(v.price);
            v.stock = Number(v.stock);
            normalizeDiscountFields(v, i);

            // Basic validations
            if (isNaN(v.price) || v.price <= 0)
              return next(createError(400, `Variant ${i + 1}: Invalid price`));

            if (isNaN(v.stock) || v.stock < 0)
              return next(createError(400, `Variant ${i + 1}: Invalid stock`));

            if (
              v.discountPrice &&
              (isNaN(v.discountPrice) || v.discountPrice < 0)
            )
              return next(
                createError(400, `Variant ${i + 1}: Invalid discount price`)
              );

            if (v.discountPrice && v.discountPrice >= v.price)
              return next(
                createError(
                  400,
                  `Variant ${i + 1}: Discount price must be less than price`
                )
              );

            v.attributes = v.attributes || {};
          }

          parsedVariants = reconcileVariants(parsedVariants, product.variants);
          parsedVariants = await generateVariantSKUs(parsedVariants);
        } catch (e) {
          if (e.status || e.statusCode) return next(e);
          return next(createError(400, "Invalid variants JSON format"));
        }
      }

      /* ------------------------------------------------------------------
       ✔️ Handle image uploads
      ------------------------------------------------------------------ */
      let updatedImages = parseExistingImages(existingImages, product.images);
      await verifyProductImages(updatedImages, req.id, product.images);

      if (files.images) {
        const allowedTypes = [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/webp",
        ];
        const images = Array.isArray(files.images)
          ? files.images
          : [files.images];

        validateProductImageCount([...updatedImages, ...images]);

        for (const img of images) {
          if (!allowedTypes.includes(img.mimetype))
            return next(
              createError(400, `${img.originalFilename}: Invalid image type`)
            );
        }

        const newUrls = await Promise.all(
          images.map(async (img) => {
            const result = await uploadToCloudinary(img.filepath, "products");
            return result.url;
          })
        );

        updatedImages = [...updatedImages, ...newUrls];
      }

      updatedImages = [...new Set(updatedImages)];
      validateProductImageCount(updatedImages);

      /* ------------------------------------------------------------------
       ✔️ Apply updates to product model
      ------------------------------------------------------------------ */
      product.productName = productName || product.productName;
      product.description = description || product.description;
      product.shortDescription = shortDescription || product.shortDescription;
      product.category = category || product.category;
      product.brand = brand || product.brand;

      product.slug = newSlug; // apply unique slug

      product.images = updatedImages;

      if (weight) product.weight = weight;
      if (length) product.length = length;
      if (width) product.width = width;
      if (height) product.height = height;

      product.warrantyType = warrantyType || product.warrantyType;
      product.warrantyTime = warrantyType === "no warranty" ? "" : warrantyTime || product.warrantyTime;
      product.warrantyPolicy =
        warrantyType === "no warranty" ? "" : warrantyPolicy || product.warrantyPolicy;
      product.shippingCharge = shippingCharge;

      product.status = status;
      product.seoTitle = seoTitle ?? product.seoTitle;
      product.seoContent = seoContent ?? product.seoContent;

      product.attributes = parsedAttributes;
      product.variants = parsedVariants;

      /* ------------------------------------------------------------------
       ✔️ Save product
      ------------------------------------------------------------------ */
      const saved = await product.save();

      const populated = await Product.findById(saved._id)
        .populate("category", "name")
        .populate("brand", "name")
        .populate("creator", "name email shopName");

      return successMessage(res, 200, {
        message: "Product updated successfully",
        product: populated,
      });
    } catch (error) {
      console.error("Product update error:", error);
      if (error.status || error.statusCode) return next(error);
      if (error.name === "VersionError") return next(createError(409, "Product changed. Please reload and try again"));
      next(createError(500, "Failed to update product"));
    }
  });
};

const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      return next(createError(404, "Product not found"));
    }
    return successMessage(res, 200, {
      message: "Product deleted successfully",
      product,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};
const getProductBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const product = await Product.findOne({
      slug,
      status: "published",
      variants: { $elemMatch: { availability: true } },
    })
      .populate("category", "name")
      .populate("brand", "name")
      .populate("creator", "name shopName shopUrl shopLogo profileImageUrl sellerId")
      .lean();

    if (!product) {
      return next(createError(404, "Product not found"));
    }

    // ✅ only available variants
    product.variants = product.variants.filter(
      (variant) => variant.availability === true
    );

    return successMessage(res, 200, {
      message: "Product fetched successfully",
      product,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

const getProductsByCategory = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const products = await Product.find({ category: categoryId })
      .populate("category", "name")
      .populate("brand", "name")
      .populate("creator", "name email shopName");
    if (!products || products.length === 0) {
      return next(createError(404, "No products found for this category"));
    }
    return successMessage(res, 200, {
      message: "Products fetched successfully",
      products,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};
const getProductsByBrand = async (req, res, next) => {
  try {
    const { brandId } = req.params;
    const products = await Product.find({ brand: brandId })

      .populate("category", "name")
      .populate("brand", "name")
      .populate("creator", "name email shopName");
    if (!products || products.length === 0) {
      return next(createError(404, "No products found for this brand"));
    }
    return successMessage(res, 200, {
      message: "Products fetched successfully",
      products,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};
const getProductsByCreator = async (req, res, next) => {
  try {
    const { creatorId } = req.params;
    const products = await Product.find({ creator: creatorId })
      .populate("category", "name")
      .populate("brand", "name")
      .populate("creator", "name email shopName");
    if (!products || products.length === 0) {
      return next(createError(404, "No products found for this creator"));
    }
    return successMessage(res, 200, {
      message: "Products fetched successfully",
      products,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};
const updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const currentUserId = req.id;
    const currentUserRole = req.role;

    // Fetch the product first
    const existingProduct = await Product.findById(id);
    if (!existingProduct) {
      return next(createError(404, "Product not found"));
    }

    // Authorization check
    if (
      existingProduct.creator.toString() !== currentUserId &&
      currentUserRole !== "admin"
    ) {
      return next(
        createError(403, "You are not authorized to update this product")
      );
    }

    if (!status) {
      return next(createError(400, "Status is required"));
    }

    const product = await Product.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!product) {
      return next(createError(404, "Product not found"));
    }

    return successMessage(res, 200, {
      message: "Product status updated successfully",
      product,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

const updatePriceAndStock = async (req, res, next) => {
  try {
    const { id, variants } = req.body;
    // Reject selector objects before a value reaches a Mongoose query.
    if (typeof id !== "string" || !mongoose.isObjectIdOrHexString(id)) throw createError(400, "Invalid product id");
    if (!Array.isArray(variants) || variants.length === 0 || variants.length > 500) throw createError(400, "A valid variants list is required");
    const product = await Product.findById(id);
    if (!product) throw createError(404, "Product not found");
    if (String(product.creator) !== req.id) throw createError(403, "You are not allowed to update this product");
    const seen = new Set();
    // Validate the entire request before applying any updates.
    const operations = variants.map((variant) => {
      if (!variant || typeof variant._id !== "string" || !mongoose.isObjectIdOrHexString(variant._id)) {
        throw createError(400, "Invalid variant id");
      }
      const current = product.variants.find((entry) => String(entry._id) === variant._id);
      if (!current || seen.has(variant._id)) throw createError(400, "Variant must belong to this product and appear only once");
      seen.add(variant._id);
      const changes = {};
      for (const field of ["price", "discountPrice", "stock"]) {
        if (variant[field] !== undefined) {
          if (typeof variant[field] !== "number" || !Number.isFinite(variant[field])) throw createError(400, "Variant numbers must be finite numeric values");
          changes["variants.$." + field] = variant[field];
        }
      }
      if (variant.price !== undefined && variant.price <= 0) throw createError(400, "Price must be positive");
      if (variant.stock !== undefined && (!Number.isInteger(variant.stock) || variant.stock < 0)) throw createError(400, "Stock must be a non-negative integer");
      const price = variant.price ?? current.price;
      const discount = variant.discountPrice ?? current.discountPrice;
      if (discount !== undefined && discount !== null && (discount < 0 || (discount > 0 && discount >= price))) throw createError(400, "Discount must be non-negative and less than price");
      if (variant.availability !== undefined) {
        if (typeof variant.availability !== "boolean") throw createError(400, "Availability must be a boolean");
        changes["variants.$.availability"] = variant.availability;
      }
      return { id: current._id, changes };
    });
    for (const operation of operations) {
      if (!Object.keys(operation.changes).length) continue;
      // Use the validated document ID and bind ownership in the write itself.
      const result = await Product.updateOne({ _id: product._id, creator: req.id, "variants._id": operation.id },
        { $set: operation.changes, $inc: { __v: 1 } }, { runValidators: true });
      if (result.matchedCount !== 1) throw createError(409, "Product changed. Please reload and try again");
    }
    return successMessage(res, 200, { message: "Product price, stock and availability updated successfully", product: await Product.findById(product._id) });
  } catch (error) { next(error); }
};

module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  getManagedProductById,
  updateProduct,
  deleteProduct,
  updatePriceAndStock,
  getPublicProducts,
  updateStatus,
  getProductBySlug,
  getProductImageUploadSignature
};
