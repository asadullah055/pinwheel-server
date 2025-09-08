const formidable = require("formidable");
const createError = require("http-errors");

const Banner = require("../model/Banner");
const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require("../helper/cloudinary");
const { successMessage } = require("../utils/response");

const createBanner = async (req, res, next) => {
  
  if (req?.role !== "admin") {
    return next(createError(403, "Only Admins can create banners"));
  }

  const form = formidable();
  //  console.log(form);
  form.parse(req, async (err, fields, files) => {
    // console.log(fields);

    if (err) {
      return next(createError(400, "Error parsing form data"));
    }

    try {
      let { bannerType, targetUrl, priority, startDate, endDate, isActive } =
        fields;
      let { bannerImage } = files;

      console.log(fields);
      if (!bannerType || !targetUrl || !bannerImage) {
        throw createError(
          400,
          "bannerType, targetUrl and banner image are required"
        );
      }

      // ✅ Trim values
      bannerType = bannerType.trim();
      targetUrl = targetUrl.trim();

      // ✅ Upload banner image
      const result = await uploadToCloudinary(bannerImage.filepath, "pinwheel");
      if (!result) {
        throw createError(400, "Banner image upload failed");
      }

      // ✅ Create Banner
      const banner = await Banner.create({
        bannerType,
        targetUrl,
        bannerURL: result.url,
        priority: priority ? parseInt(priority) : 0,
        isActive: isActive === "true",
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? endDate : null,
        creator: req.id,
      });

      return successMessage(res, 201, {
        message: "Banner created successfully",
        banner,
      });
    } catch (error) {
      // console.error(error);
      next(error);
    }
  });
};
const getAllBanners = async (req, res, next) => {
  
  try {
    const { bannerType, page = 1, limit = 10 } = req.query;

    // Build filter object
    const filter = {};
    if (bannerType) filter.bannerType = bannerType;
    // if (isActive !== undefined) filter.isActive = isActive === "true";

    // Add date filter for active banners
    /* const currentDate = new Date();

    filter.$or = [
      { startDate: { $lte: currentDate }, endDate: null },
      { startDate: { $lte: currentDate }, endDate: { $gte: currentDate } },
    ]; */

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [banners, total] = await Promise.all([
      Banner.find(filter)
        .populate("creator", "name email")
        .sort({ priority: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Banner.countDocuments(filter),
    ]);

    return successMessage(res, 200, {
      message: "Banners fetched successfully",
      banners,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ✅ Get Single Banner
const getBannerById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const banner = await Banner.findById(id).populate("creator", "name email");

    if (!banner) {
      throw createError(404, "Banner not found");
    }

    return successMessage(res, 200, {
      message: "Banner fetched successfully",
      banner,
    });
  } catch (error) {
    next(error);
  }
};

// ✅ Update Banner
const updateBanner = async (req, res, next) => {
  if (req?.role !== "admin") {
    return next(createError(403, "Only Admins can update banners"));
  }

  const { id } = req.params;
  const form = formidable();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return next(createError(400, "Error parsing form data"));
    }

    try {
      const banner = await Banner.findById(id);
      if (!banner) {
        throw createError(404, "Banner not found");
      }

      let { bannerType, targetUrl, priority, startDate, endDate, isActive } =
        fields;
      let { bannerImage } = files;

      // Update fields if provided
      if (bannerType) banner.bannerType = bannerType.trim();
      if (targetUrl) banner.targetUrl = targetUrl.trim();
      if (priority !== undefined) banner.priority = parseInt(priority);
      if (isActive !== undefined) banner.isActive = isActive === "true";
      if (startDate !== undefined)
        banner.startDate = startDate ? new Date(startDate) : null;
      if (endDate !== undefined)
        banner.endDate = endDate ? new Date(endDate) : null;

      // Update image if provided
      if (bannerImage) {
        // Delete old image from cloudinary
        const oldImageUrl = banner.bannerURL;

        // Upload new image
        const result = await uploadToCloudinary(
          bannerImage.filepath,
          "pinwheel"
        );
        if (!result) {
          throw createError(400, "Banner image upload failed");
        }

        banner.bannerURL = result.url;

        // Delete old image after successful upload
        if (oldImageUrl) {
          await deleteFromCloudinary(oldImageUrl);
        }
      }

      await banner.save();

      return successMessage(res, 200, {
        message: "Banner updated successfully",
        banner,
      });
    } catch (error) {
      next(error);
    }
  });
};

// ✅ Delete Banner
const deleteBanner = async (req, res, next) => {
  if (req?.role !== "admin") {
    return next(createError(403, "Only Admins can delete banners"));
  }

  try {
    const { id } = req.params;

    const banner = await Banner.findById(id);
    if (!banner) {
      throw createError(404, "Banner not found");
    }

    // Delete image from cloudinary
    if (banner.bannerURL) {
      await deleteFromCloudinary(banner.bannerURL);
    }

    await banner.deleteOne();

    return successMessage(res, 200, {
      message: "Banner deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ✅ Toggle Banner Status
const toggleBannerStatus = async (req, res, next) => {
  
  if (req?.role !== "admin") {
    return next(createError(403, "Only Admins can toggle banner status"));
  }

  try {
    const { id } = req.params;

    const banner = await Banner.findById(id);
    if (!banner) {
      throw createError(404, "Banner not found");
    }

    banner.isActive = !banner.isActive;
    await banner.save();

    return successMessage(res, 200, {
      message: `Banner ${
        banner.isActive ? "activated" : "deactivated"
      } successfully`,
      banner,
    });
  } catch (error) {
    next(error);
  }
};

// ✅ Get Active Banners (Public API)
const getActiveBanners = async (req, res, next) => {

  
  try {
    const currentDate = new Date();
    const filter = {
      isActive: true,
      $or: [
        { startDate: { $lte: currentDate }, endDate: null },
        { startDate: { $lte: currentDate }, endDate: { $gte: currentDate } },
      ],
    };

    const banners = await Banner.find(filter)
      .select("bannerType bannerURL targetUrl priority")
      .sort({ priority: 1, createdAt: -1 });

    return successMessage(res, 200, {
      message: "Active banners fetched successfully",
      banners,
    });
  } catch (error) {
    next(error);
  }
};

// ✅ Update Banner Priority
const updateBannerPriority = async (req, res, next) => {
  console.log("updateBannerPriority called");
  if (req?.role !== "admin") {
    return next(createError(403, "Only Admins can update banner priority"));
  }

  try {
    const { banners } = req.body; // Array of { id, priority }

    if (!Array.isArray(banners)) {
      throw createError(400, "Banners array is required");
    }

    const updatePromises = banners.map(({ id, priority }) =>
      Banner.findByIdAndUpdate(id, { priority }, { new: true })
    );

    await Promise.all(updatePromises);

    return successMessage(res, 200, {
      message: "Banner priorities updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBanner,
  getAllBanners,
  getBannerById,
  updateBanner,
  deleteBanner,
  toggleBannerStatus,
  getActiveBanners,
  updateBannerPriority,
};
