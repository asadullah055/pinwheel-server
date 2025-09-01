const formidable = require("formidable");
const createError = require("http-errors");

const Banner = require("../model/Banner");
const { uploadToCloudinary } = require("../helper/cloudinary");
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
        endDate: endDate ? new Date(endDate) : null,
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

module.exports = { createBanner };
