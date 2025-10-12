const createError = require("http-errors");

const { successMessage } = require("../utils/response");
const Product = require("../model/Product");
const formidable = require("formidable");
const { uploadToCloudinary } = require("../helper/cloudinary");
const { generateUniqueSKU } = require("../utils/skuGenerator.js");


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
      variant.availability = variant.stock > 0;
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
const updateProduct = async (req, res, next) => {
  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return next(createError(400, "Error parsing form data"));

    try {
      const { id } = req.params;
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
      let {
        title,
        description,
        shortDescription,
        regularPrice,
        stock,
        category,
        brand,
        discountPrice,
        slug,
        packageHeight,
        packageWeight,
        packageWidth,
        packageLength,
        warrantyPolicy,
        warrantyTime,
        warrantyType,
        status,
        metaTitle,
        metaDescription,
      } = fields;
      let { images } = files;

      if (
        !title ||
        !description ||
        !regularPrice ||
        !stock ||
        !category ||
        !brand
      ) {
        return next(createError(400, "All required fields must be filled"));
      }

      title = title.trim();
      description = description.trim();
      regularPrice = parseFloat(regularPrice);
      stock = parseInt(stock);

      if (isNaN(regularPrice) || isNaN(stock)) {
        return next(createError(400, "Price and stock must be numbers"));
      }

      const duplicateProduct = await Product.findOne({
        _id: { $ne: id },
        title: { $regex: `^${title}$`, $options: "i" },
      });
      if (duplicateProduct) {
        return next(createError(400, "Product with this title already exists"));
      }

      // Upload images
      let imageUrls = [];

      if (images) {
        imageUrls = await Promise.all(
          (Array.isArray(images) ? images : [images]).map(async (img) => {
            const result = await uploadToCloudinary(img.filepath, "pinwheel");
            return result.url;
          })
        );
      }
      let existingImageUrls = [];

      if (fields.images) {
        if (Array.isArray(fields.images)) {
          existingImageUrls = fields.images;
        } else {
          existingImageUrls = [fields.images];
        }
      }

      let finalImageUrls = [...existingImageUrls, ...imageUrls];

      // Update product
      const product = await Product.findByIdAndUpdate(
        id,
        {
          title,
          description,
          shortDescription: shortDescription || null,
          regularPrice,
          stock,
          category,
          brand,
          discountPrice: discountPrice ? parseFloat(discountPrice) : null,
          creator: req.id,
          slug: slug || "",
          packageHeight: packageHeight || null,
          packageWeight: packageWeight || null,

          packageWidth: packageWidth || null,
          packageLength: packageLength || null,
          warrantyPolicy: warrantyPolicy || null,
          warrantyTime: warrantyTime || null,
          warrantyType: warrantyType || null,
          status: status || "unpublished",
          images: imageUrls ? finalImageUrls : fields.images,
          metaData: {
            metaDescription,
            metaTitle,
          },
        },
        { new: true, runValidators: true }
      );
      if (!product) {
        return next(createError(404, "Product not found"));
      }
      return successMessage(res, 200, {
        message: "Product updated successfully",
        product,
      });
    } catch (error) {
      console.log(error);
      next(error);
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
  try {
    const { regularPrice, discountPrice, stock, id } = req.body;
    // console.log(req.body);

    // Validation for regularPrice
    if (regularPrice !== undefined) {
      if (isNaN(regularPrice)) {
        return next(createError(400, "Regular price must be a number"));
      }
      if (regularPrice < 0) {
        return next(createError(400, "Regular price cannot be negative"));
      }
    }

    // Validation for discountPrice (optional)
    if (discountPrice !== undefined) {
      if (isNaN(discountPrice)) {
        return next(createError(400, "Discount price must be a number"));
      }
      if (discountPrice < 0) {
        return next(createError(400, "Discount price cannot be negative"));
      }
    }

    // If both prices are provided, validate the logical relationship
    if (
      regularPrice !== undefined &&
      discountPrice !== undefined &&
      Number(regularPrice) < Number(discountPrice)
    ) {
      return next(
        createError(400, "Regular price must be greater than discount price")
      );
    }

    // Validation for stock
    if (stock !== undefined) {
      if (isNaN(stock)) {
        return next(createError(400, "Stock must be a number"));
      }
      if (stock < 0) {
        return next(createError(400, "Stock cannot be negative"));
      }
    }

    const updateFields = {};
    if (regularPrice !== undefined)
      updateFields.regularPrice = Number(regularPrice);
    if (discountPrice !== undefined)
      updateFields.discountPrice = Number(discountPrice);
    if (stock !== undefined) updateFields.stock = Number(stock);

    const product = await Product.findByIdAndUpdate(id, updateFields, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return next(createError(404, "Product not found"));
    }

    const messageParts = [];
    if (regularPrice !== undefined || discountPrice !== undefined) {
      messageParts.push("Price updated successfully");
    }
    if (stock !== undefined) {
      messageParts.push("Stock updated successfully");
    }

    return successMessage(res, 200, {
      message: messageParts.join(" & "),
      product,
    });
  } catch (error) {
    console.error(error);
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
