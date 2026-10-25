const createError = require("http-errors");
const { createSecureForm } = require("../utils/secureForm");
const { uploadToCloudinary } = require("../helper/cloudinary");
const UploadAsset = require("../model/UploadAsset");
const { imageUrl, parse } = require("../utils/inputSecurity");

const uploadProductImage = (req, res, next) => createSecureForm("image").parse(req, async (error, _fields, files) => {
  if (error) return next(error);
  try {
    const result = await uploadToCloudinary(files.image.filepath, "products");
    const url = parse(imageUrl, result.secure_url);
    if (!result.public_id) throw createError(502, "Image upload could not be verified");
    await UploadAsset.create({ owner: req.id, url, publicId: result.public_id });
    return res.status(201).json({ url });
  } catch (failure) { next(failure); }
});
const verifyProductImages = async (images, userId, existing = []) => {
  const upgrade = (url) => url.replace(/^http:\/\/res\.cloudinary\.com\//, "https://res.cloudinary.com/");
  for (let i = 0; i < images.length; i++) images[i] = parse(imageUrl, upgrade(images[i]));
  const owned = new Set(existing.map(upgrade));
  const added = images.filter((url) => !owned.has(url));
  if (!added.length) return;
  const verified = await UploadAsset.find({ owner: userId, url: { $in: added } }).distinct("url");
  if (verified.length !== added.length) throw createError(400, "Images must be uploaded through your own account");
};
module.exports = { uploadProductImage, verifyProductImages };
