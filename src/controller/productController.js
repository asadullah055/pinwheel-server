const createError = require("http-errors");

const { successMessage } = require("../utils/response");
const Product = require("../model/Product");
const formidable = require("formidable");
const { uploadToCloudinary } = require("../helper/cloudinary");
const { generateUniqueSKU, generateVariantSKUs } = require("../utils/skuGenerator.js");

/* const createProduct = async (req, res, next) => {
  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return next(createError(400, "Error parsing form data"));

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
        status,
        seoTitle,
        seoContent,
        attributes,
        variants,
      } = fields;

      // Trim strings
      productName = productName?.trim();
      description = description?.trim();
      shortDescription = shortDescription?.trim();
      seoTitle = seoTitle?.trim();
      seoContent = seoContent?.trim();
      status = status || "unpublished";

      // Convert numeric fields
      const convert = (val) => (val ? parseFloat(val) : undefined);
      weight = convert(weight);
      length = convert(length);
      width = convert(width);
      height = convert(height);

      // Validate dimensions
      for (const [key, val] of Object.entries({ weight, length, width, height })) {
        if (val !== undefined && (isNaN(val) || val <= 0))
          return next(createError(400, `${key} must be a valid positive number`));
      }

      // Required field check
      if (!productName || !description || !category || !brand || !seoTitle || !seoContent) {
        return next(
          createError(
            400,
            "Product name, description, category, brand, and SEO fields are required"
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
      variant.price = parseFloat(variant.price);
      variant.stock = parseInt(variant.stock);
      if (variant.discountPrice) {
        variant.discountPrice = parseFloat(variant.discountPrice);
      }

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
      if (variant.discountPrice && variant.discountPrice >= variant.price) {
        return next(
          createError(
            400,
            `Variant ${i + 1}: Discount price must be less than price`
          )
        );
      }

      // ✅ Build structured attributes automatically
      const attributesObj = {};
      for (const key in variant) {
        // Pick "attribute-like" keys
        if (
          ![
            "sku",
            "price",
            "discountPrice",
            "discountStartDate",
            "discountEndDate",
            "stock",
            "availability",
          ].includes(key)
        ) {
          const value = variant[key];
          if (typeof value === "string" && value.trim() !== "") {
            attributesObj[key.toLowerCase()] = value.toLowerCase();
          }
        }
      }

      // Attach structured attributes
      variant.attributes = attributesObj;

      // Availability
      variant.availability = variant.availability;
      console.log(variant.availability);
    }
  } catch (e) {
    return next(createError(400, "Invalid variants format"));
  }
}

      if (parsedVariants.length === 0)
        return next(createError(400, "At least one variant is required"));

      // Check for existing product
      const existingProduct = await Product.findOne({
        productName: { $regex: `^${productName}$`, $options: "i" },
      });

      if (existingProduct)
        return next(createError(400, "Product with this name already exists"));

      // Handle image upload
      let imageUrls = [];
      if (files.images) {
        const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        const images = Array.isArray(files.images) ? files.images : [files.images];

        for (const img of images) {
          if (!allowedTypes.includes(img.mimetype))
            return next(createError(400, `${img.originalFilename}: Invalid image type`));
        }

        imageUrls = await Promise.all(
          images.map(async (img) => {
            const result = await uploadToCloudinary(img.filepath, "products");
            return result.url;
          })
        );
      }

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
          productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
        images: imageUrls,
        weight,
        length,
        width,
        height,
        warrantyType,
        warrantyTime,
        warrantyPolicy,
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
        .populate("creator", "name email");

      return successMessage(res, 201, {
        message: "Product created successfully",
        product: populated,
      });
    } catch (error) {
      console.error("Product creation error:", error);
      next(createError(500, error.message || "Failed to create product"));
    }
  });
}; */
const createProduct = async (req, res, next) => {
  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return next(createError(400, "Error parsing form data"));

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
        status,
        seoTitle,
        seoContent,
        attributes,
        variants,
      } = fields;

      // Trim strings
      productName = productName?.trim();
      description = description?.trim();
      shortDescription = shortDescription?.trim();
      seoTitle = seoTitle?.trim();
      seoContent = seoContent?.trim();
      status = status || "unpublished";

      // Convert numeric fields
      const convert = (val) => (val ? parseFloat(val) : undefined);
      weight = convert(weight);
      length = convert(length);
      width = convert(width);
      height = convert(height);

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
        !brand ||
        !seoTitle ||
        !seoContent
      ) {
        return next(
          createError(
            400,
            "Product name, description, category, brand, and SEO fields are required"
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
            variant.price = parseFloat(variant.price);
            variant.stock = parseInt(variant.stock);
            if (variant.discountPrice) {
              variant.discountPrice = parseFloat(variant.discountPrice);
            }

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

            // ✅ Build structured attributes automatically
            const attributesObj = {};
            for (const key in variant) {
              // Pick "attribute-like" keys
              if (
                ![
                  "sku",
                  "price",
                  "discountPrice",
                  "discountStartDate",
                  "discountEndDate",
                  "stock",
                  "availability",
                ].includes(key)
              ) {
                const value = variant[key];
                if (typeof value === "string" && value.trim() !== "") {
                  attributesObj[key] = value;
                }
              }
            }

            // Attach structured attributes
            variant.attributes = attributesObj;

            // Availability
            variant.availability = variant.availability;
          }
        } catch (e) {
          return next(createError(400, "Invalid variants format"));
        }
      }

      if (parsedVariants.length === 0)
        return next(createError(400, "At least one variant is required"));

      // Check for existing product
      const existingProduct = await Product.findOne({
        productName: { $regex: `^${productName}$`, $options: "i" },
      });

      if (existingProduct)
        return next(createError(400, "Product with this name already exists"));

      // 🔥 Generate variant SKUs (auto-generate if not provided)

      parsedVariants = await generateVariantSKUs(parsedVariants);

      // Handle image upload
      let imageUrls = [];
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

        for (const img of images) {
          if (!allowedTypes.includes(img.mimetype))
            return next(
              createError(400, `${img.originalFilename}: Invalid image type`)
            );
        }

        imageUrls = await Promise.all(
          images.map(async (img) => {
            const result = await uploadToCloudinary(img.filepath, "products");
            return result.url;
          })
        );
      }

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
        warrantyType,
        warrantyTime,
        warrantyPolicy,
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
        .populate("creator", "name email");

      return successMessage(res, 201, {
        message: "Product created successfully",
        product: populated,
      });
    } catch (error) {
      console.error("Product creation error:", error);
      next(createError(500, error.message || "Failed to create product"));
    }
  });
};

const getAllProducts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    let filter = {};

    if (req.id) {
      if (req.role === "seller") {
        filter.creator = req.id;
      }
    } else {
      filter.status = "published";
    }


    const totalProducts = await Product.countDocuments(filter);

    const products = await Product.find(filter)
      .populate("category", "name")
      .populate("brand", "name")
      .populate("creator", "name email")
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

// get product by id
const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id)
      .populate("category", "name")
      .populate("brand", "name")
      .populate("creator", "name email");
    if (!product) {
      return next(createError(404, "Product not found"));
    }
    return successMessage(res, 200, {
      message: "Product fetched successfully",
      product,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

/* const updateProduct = async (req, res, next) => {
  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return next(createError(400, "Error parsing form data"));

    try {
      const productId = req.params.id;
      const product = await Product.findById(productId);

      if (!product) return next(createError(404, "Product not found"));

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
        status,
        seoTitle,
        seoContent,
        attributes,
        variants,
      } = fields;

      // Trim strings
      if (productName) productName = productName.trim();
      if (description) description = description.trim();
      if (shortDescription) shortDescription = shortDescription.trim();
      if (seoTitle) seoTitle = seoTitle.trim();
      if (seoContent) seoContent = seoContent.trim();

      status = status || product.status;

      // Convert numeric fields
      const convert = (val) => (val ? parseFloat(val) : undefined);
      weight = convert(weight);
      length = convert(length);
      width = convert(width);
      height = convert(height);

      // Validate numbers
      for (const [key, val] of Object.entries({ weight, length, width, height })) {
        if (val !== undefined && (isNaN(val) || val <= 0)) {
          return next(createError(400, `${key} must be a valid positive number`));
        }
      }

      // Required field check (only if updating)
      if (
        productName === "" ||
        description === "" ||
        category === "" ||
        brand === "" ||
        seoTitle === "" ||
        seoContent === ""
      ) {
        return next(createError(400, "Required fields cannot be empty"));
      }

      // Parse attributes
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

      // Parse variants
      let parsedVariants = product.variants;
      if (variants) {
        try {
          parsedVariants = JSON.parse(variants);
          if (!Array.isArray(parsedVariants)) {
            return next(createError(400, "Variants must be an array"));
          }

          for (let i = 0; i < parsedVariants.length; i++) {
            const v = parsedVariants[i];

            v.price = parseFloat(v.price);
            v.stock = parseInt(v.stock);
            if (v.discountPrice) v.discountPrice = parseFloat(v.discountPrice);

            // Validation
            if (isNaN(v.price) || v.price <= 0)
              return next(createError(400, `Variant ${i + 1}: Invalid price`));

            if (isNaN(v.stock) || v.stock < 0)
              return next(createError(400, `Variant ${i + 1}: Invalid stock`));

            if (v.discountPrice && (isNaN(v.discountPrice) || v.discountPrice < 0))
              return next(createError(400, `Variant ${i + 1}: Invalid discount price`));

            if (v.discountPrice && v.discountPrice >= v.price)
              return next(
                createError(
                  400,
                  `Variant ${i + 1}: Discount price must be less than price`
                )
              );

            // Auto build variant attributes
            const attr = {};
            for (const key in v) {
              if (
                ![
                  "sku",
                  "price",
                  "discountPrice",
                  "discountStartDate",
                  "discountEndDate",
                  "stock",
                  "availability",
                ].includes(key)
              ) {
                if (typeof v[key] === "string" && v[key].trim() !== "") {
                  attr[key.toLowerCase()] = v[key].toLowerCase();
                }
              }
            }

            v.attributes = attr;
            v.availability = v.availability;
            
          }
        } catch {
          return next(createError(400, "Invalid variants JSON format"));
        }
      }

      // Handle image upload
      let updatedImages = product.images;

      if (files.images) {
        const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        const images = Array.isArray(files.images) ? files.images : [files.images];

        for (const img of images) {
          if (!allowedTypes.includes(img.mimetype))
            return next(createError(400, `${img.originalFilename}: Invalid image type`));
        }

        const newUrls = await Promise.all(
          images.map(async (img) => {
            const result = await uploadToCloudinary(img.filepath, "products");
            return result.url;
          })
        );

        updatedImages = [...updatedImages, ...newUrls];
      }

      // Update fields
      product.productName = productName || product.productName;
      product.description = description || product.description;
      product.shortDescription = shortDescription || product.shortDescription;
      product.category = category || product.category;
      product.brand = brand || product.brand;

      // Slug update optional
      if (slug) {
        product.slug = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      }

      product.images = updatedImages;

      if (weight) product.weight = weight;
      if (length) product.length = length;
      if (width) product.width = width;
      if (height) product.height = height;

      product.warrantyType = warrantyType || product.warrantyType;
      product.warrantyTime = warrantyTime || product.warrantyTime;
      product.warrantyPolicy = warrantyPolicy || product.warrantyPolicy;

      product.status = status;
      product.seoTitle = seoTitle || product.seoTitle;
      product.seoContent = seoContent || product.seoContent;
      product.attributes = parsedAttributes;
      product.variants = parsedVariants;

      const saved = await product.save();

      const populated = await Product.findById(saved._id)
        .populate("category", "name")
        .populate("brand", "name")
        .populate("creator", "name email");

      return successMessage(res, 200, {
        message: "Product updated successfully",
        product: populated,
      });
    } catch (error) {
      console.error("Product update error:", error);
      next(createError(500, error.message || "Failed to update product"));
    }
  });
}; */
const updateProduct = async (req, res, next) => {
  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return next(createError(400, "Error parsing form data"));

    try {
      const productId = req.params.id;
      const product = await Product.findById(productId);

      if (!product) return next(createError(404, "Product not found"));

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
        status,
        seoTitle,
        seoContent,
        attributes,
        variants,
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
      const convert = (val) => (val ? parseFloat(val) : undefined);
      weight = convert(weight);
      length = convert(length);
      width = convert(width);
      height = convert(height);

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
        brand === "" ||
        seoTitle === "" ||
        seoContent === ""
      ) {
        return next(createError(400, "Required fields cannot be empty"));
      }

      /* ------------------------------------------------------------------
       🔥 UNIQUE CHECK: PRODUCT NAME + SLUG
      ------------------------------------------------------------------ */

      // 1. Product Name Duplicate Check
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

            v.price = parseFloat(v.price);
            v.stock = parseInt(v.stock);
            if (v.discountPrice) v.discountPrice = parseFloat(v.discountPrice);

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

            // Auto-generate attributes
            const attr = {};
            for (const key in v) {
              if (
                ![
                  "sku",
                  "price",
                  "discountPrice",
                  "discountStartDate",
                  "discountEndDate",
                  "stock",
                  "availability",
                ].includes(key)
              ) {
                if (typeof v[key] === "string" && v[key].trim() !== "") {
                  attr[key] = v[key];
                }
              }
            }

            v.attributes = attr;
          }
        } catch {
          return next(createError(400, "Invalid variants JSON format"));
        }
      }

      /* ------------------------------------------------------------------
       ✔️ Handle image uploads
      ------------------------------------------------------------------ */
      let updatedImages = product.images;

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
      product.warrantyTime = warrantyTime || product.warrantyTime;
      product.warrantyPolicy = warrantyPolicy || product.warrantyPolicy;

      product.status = status;
      product.seoTitle = seoTitle || product.seoTitle;
      product.seoContent = seoContent || product.seoContent;

      product.attributes = parsedAttributes;
      product.variants = parsedVariants;

      /* ------------------------------------------------------------------
       ✔️ Save product
      ------------------------------------------------------------------ */
      const saved = await product.save();

      const populated = await Product.findById(saved._id)
        .populate("category", "name")
        .populate("brand", "name")
        .populate("creator", "name email");

      return successMessage(res, 200, {
        message: "Product updated successfully",
        product: populated,
      });
    } catch (error) {
      console.error("Product update error:", error);
      next(createError(500, error.message || "Failed to update product"));
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
    const product = await Product.findOne({ slug })
      .populate("category", "name")
      .populate("brand", "name")
      .populate("creator", "name email");
    if (!product) {
      return next(createError(404, "Product not found"));
    }
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
      .populate("creator", "name email");
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
      .populate("creator", "name email");
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
      .populate("creator", "name email");
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
  console.log(req.body)
  try {
    const { id, variants } = req.body;
    const currentUserId = req.id;

    const existingProduct = await Product.findById(id);
    if (!existingProduct) {
      return next(createError(404, "Product not found"));
    }

    if (existingProduct.creator.toString() !== currentUserId) {
      return next(
        createError(403, "You are not allowed to update this product")
      );
    }

    // Track what changed
    let priceUpdated = false;
    let stockUpdated = false;
    let availabilityUpdated = false;

    await Promise.all(
      variants.map(async (variant) => {
        const updateQuery = {};
        if (variant.price !== undefined) {
          updateQuery["variants.$.price"] = variant.price;
          priceUpdated = true;
        }

        if (variant.discountPrice !== undefined) {
          updateQuery["variants.$.discountPrice"] = variant.discountPrice;
          priceUpdated = true;
        }

        if (variant.stock !== undefined) {
          updateQuery["variants.$.stock"] = variant.stock;
          stockUpdated = true;
        }

        if (variant.availability !== undefined) {
          updateQuery["variants.$.availability"] = variant.availability;
          availabilityUpdated = true;
        }

        // Only update if something was changed
        if (Object.keys(updateQuery).length > 0) {
          await Product.updateOne(
            { _id: id, "variants._id": variant._id },
            { $set: updateQuery }
          );
        }
      })
    );

    // Message Generate
    let message = "";
    if (priceUpdated && !stockUpdated && !availabilityUpdated) {
      message = "Price updated successfully";
    }
    if (stockUpdated && !priceUpdated && !availabilityUpdated) {
      message = "Stock updated successfully";
    }
    if (availabilityUpdated && !priceUpdated && !stockUpdated) {
      message = "Product availability updated";
    }

    if (
      (priceUpdated && stockUpdated) ||
      (priceUpdated && availabilityUpdated) ||
      (stockUpdated && availabilityUpdated)
    ) {
      let msgs = [];
      if (priceUpdated) msgs.push("price updated");
      if (stockUpdated) msgs.push("stock updated");
      if (availabilityUpdated) msgs.push("availability updated");

      message = msgs.join(" & ") + " successfully";
    }

    const updatedProduct = await Product.findById(id);

    return successMessage(res, 200, {
      message,
      product: updatedProduct,
    });

  } catch (error) {
    next(error);
  }
};



module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  updatePriceAndStock,
  updateStatus,
};
