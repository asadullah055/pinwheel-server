const formidable = require("formidable");
const createError = require("http-errors");
const Category = require("../model/Category");
const { successMessage } = require("../utils/response");
const { uploadToCloudinary } = require("../helper/cloudinary");

const createCategory = async (req, res, next) => {
  const form = formidable();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      throw createError(401, "Error parsing form data");
    }
    try {
      let { name } = fields;
      let { image } = files;

      if (!name || !image) {
        throw createError(400, "Category name and image are required");
      }

      name = name.trim();
      const slug = name.split(" ").join("-");
      // Check if the category name already exists
      const existingCategory = await Category.findOne({
        name: { $regex: `^${name}$`, $options: "i" }, // Case-insensitive match
      });

      if (existingCategory) {
        return next(createError(400, "Category name already exists"));
      }

      // Upload image to Cloudinary
      const result = await uploadToCloudinary(image.filepath, "pinwheel");
      if (!result) {
        throw createError(400, "Image upload failed");
      }
      // Create the brand
      const brand = await Category.create({
        name,
        slug,
        image: result.url,
        creator: req.id,
      });
      return successMessage(res, 200, {
        message: "Category create successfully",
        brand,
      });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });
};
const getAllCategories = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const totalCategories = await Category.countDocuments();
    const categories = await Category.find({}).skip(skip).limit(limit);
    if (!categories || categories.length === 0) {
      return successMessage(res, 200, {
        message: "No categories found",
        categories: [],
        totalCategories: 0,
      });
    }
    return successMessage(res, 200, {
      message: "Categories fetched successfully",
      categories,
      totalCategories,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

const getCategoryById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const category = await Category.findById(id);
    if (!category) {
      throw createError(404, "Category not found");
    }
    return successMessage(res, 200, {
      message: "Category fetched successfully",
      category,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};
const updateCategory = async (req, res, next) => {
  const form = formidable();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      throw createError(401, "Error parsing form data");
    }
    try {
      const { id } = req.params;
      const category = await Category.findById(id);
      if (!category) {
        throw createError(404, "Category not found");
      }

      let { name } = fields;
      let { image } = files;

      if (!name && !image) {
        throw createError(400, "Category name and image are required");
      }

      name = name.trim();
      const slug = name.split(" ").join("-");
      // Upload image to Cloudinary
      const result = await uploadToCloudinary(image.filepath, "pinwheel");
      if (!result) {
        throw createError(400, "Image upload failed");
      }
      // Create the brand
      const brand = await Category.findByIdAndUpdate(
        id,
        {
          name,
          slug,
          image: result.url,
          creator: req.id,
        },
        { new: true }
      );
      return successMessage(res, 200, {
        message: "Category updated successfully",
        brand,
      });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });
};
const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const category = await Category.findByIdAndDelete(id);
    if (!category) {
      throw createError(404, "Category not found");
    }
    return successMessage(res, 200, {
      message: "Category deleted successfully",
      category,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

module.exports = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};
