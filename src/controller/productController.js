const createError = require("http-errors");
const { successMessage } = require("../utils/response");
const Product = require("../model/Product");
const formidable = require("formidable");
const { uploadToCloudinary } = require("../helper/cloudinary");

const createProduct = async (req, res, next) => {
    console.log("Creating product...");
    
  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return next(createError(400, "Error parsing form data"));

    try {
      let {
        title,
        description,
        price,
        stock,
        category,
        brand,
        shortDescription,
        tags,
        unit,
        warranty,
        discountType,
        discountValue,
        status,
      } = fields;
      let { images } = files;

      // Required field check
      if (!title || !description || !price || !stock || !category || !brand) {
        return next(createError(400, "All required fields must be filled"));
      }

      title = title.trim();
      description = description.trim();
      price = parseFloat(price);
      stock = parseInt(stock);

      if (isNaN(price) || isNaN(stock)) {
        return next(createError(400, "Price and stock must be numbers"));
      }

      const existingProduct = await Product.findOne({
        title: { $regex: `^${title}$`, $options: "i" },
      });
      if (existingProduct) {
        return next(createError(400, "Product with this title already exists"));
      }

      // Upload images
      const imageUrls = images
        ? await Promise.all(
            (Array.isArray(images) ? images : [images]).map(async (img) => {
              const result = await uploadToCloudinary(img.filepath, "pinwheel");
              return result.url;
            })
          )
        : [];

      // Construct discount object if provided
      let discount = null;
      if (discountType && discountValue) {
        discount = {
          type: discountType,
          value: parseFloat(discountValue),
        };
      }

      // Create product
      const product = await Product.create({
        title,
        description,
        price,
        stock,
        category,
        brand,
        images: imageUrls,
        creator: req.id,
        shortDescription: shortDescription || null,
        tags: tags ? (Array.isArray(tags) ? tags : [tags]) : [],
        unit: unit || null,
        warranty: warranty || null,
        discount,
        status: status || "unpublished",
      });

      return successMessage(res, 200, {
        message: "Product created successfully",
        product,
      });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });
};

module.exports = {
  createProduct,
};
