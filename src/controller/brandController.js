const formidable = require("formidable");
const Brand = require("../model/Brand");
const createError = require("http-errors");
const { successMessage } = require("../utils/response");
const { uploadToCloudinary } = require("../helper/cloudinary");

const createBrand = async (req, res, next) => {
  const form = formidable();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      throw createError(401, "Error parsing form data");
    }

    try {
      let { name } = fields;
      let { image } = files;

      if (!name || !image) {
        throw createError(400, "Brand name and image are required");
      }

      name = name.trim();
      const slug = name.split(" ").join("-");
      // Check if the brand name already exists
      const existingBrand = await Brand.findOne({
        name: { $regex: `^${name}$`, $options: "i" }, // Case-insensitive match
      });
      if (existingBrand) {
        return next(createError(400, "Brand name already exists"));
      }
      // Upload image to Cloudinary
      const result = await uploadToCloudinary(image.filepath, "pinwheel");
      if (!result) {
        throw createError(400, "Image upload failed");
      }
      // Create the brand
      const brand = await Brand.create({
        name,
        slug,
        image: result.url,
        creator: req.id,
      });
      return successMessage(res, 200, {
        message: "Brand create successfully",
        brand,
      });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });
};
const getAllBrands = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const totalBrands = await Brand.countDocuments();

    const brands = await Brand.find().skip(skip).limit(limit);

    if (!brands || brands.length === 0) {
      return successMessage(res, 200, {
        message: "No brands found",
        brands: [],
        totalBrands: 0,
      });
    }

    return successMessage(res, 200, {
      message: "Brands fetched successfully",
      brands,
      totalBrands,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};
const dropdownBrands = async (req, res, next) => {
  try {
    
    const brands = await Brand.find();

    if (!brands || brands.length === 0) {
      return successMessage(res, 200, {
        message: "No brands found",
      });
    }
    return successMessage(res, 200, {
      message: "Brands fetched successfully",
      brands,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

const getBrandById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const brand = await Brand.findById(id);
    if (!brand) {
      throw createError(404, "Brand not found");
    }
    return successMessage(res, 200, {
      message: "Brand fetched successfully",
      brand,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};
const updateBrand = async (req, res, next) => {
  const form = formidable();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      throw createError(401, "Error parsing form data");
    }
    try {
      let { name } = fields;
      let { image } = files;

      if (!name || !image) {
        throw createError(400, "Brand name and image are required");
      }

      name = name.trim();
      const slug = name.split(" ").join("-");
      // Upload image to Cloudinary
      const result = await uploadToCloudinary(image.filepath, "pinwheel");
      if (!result) {
        throw createError(400, "Image upload failed");
      }
      // Create the brand
      const brand = await Brand.create({
        name,
        slug,
        image: result.url,
        creator: req.id,
      });
      return successMessage(res, 200, {
        message: "Brand create successfully",
        brand,
      });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });
};
const deleteBrand = async (req, res, next) => {
  try {
    const { id } = req.params;
    const brand = await Brand.findByIdAndDelete(id);
    if (!brand) {
      throw createError(404, "Brand not found");
    }
    return successMessage(res, 200, {
      message: "Brand deleted successfully",
      brand,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

module.exports = {
  createBrand,
  getAllBrands,
  getBrandById,
  updateBrand,
  deleteBrand,
  dropdownBrands
};
