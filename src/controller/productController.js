const createError = require("http-errors");
const { successMessage } = require("../utils/response");
const Product = require("../model/Product");
const formidable = require("formidable");
const { uploadToCloudinary } = require("../helper/cloudinary");

const createProduct = async (req, res, next) => {


  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return next(createError(400, "Error parsing form data"));

    try {
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
        
        // images
      } = fields;
      // let { images } = files;
      let { images } = files;

      // console.log("Form fields:", fields);
      // Required field check
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

      // Create product
      const product = await Product.create({
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
        images: imageUrls,
        metaData: {
          metaDescription,
          metaTitle,
        },
       
      });
      return successMessage(res, 200, {
        message: "Product created successfully",
        product,
      });
    } catch (error) {
      console.log(error);
      next(error);
    }
  });
};

module.exports = {
  createProduct,
};
