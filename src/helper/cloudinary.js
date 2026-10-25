const { cloudName, cloudApiKey, cloudApiSecret } = require("../../secret");


const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: cloudName,
  api_key: cloudApiKey,
  api_secret: cloudApiSecret,
  secure: true,
});

const uploadToCloudinary = async (path, folder)=>{
    const result = await cloudinary.uploader.upload(path, {folder, resource_type: folder === "seller-id-copies" ? "auto" : "image", allowed_formats: folder === "seller-id-copies" ? ["webp", "pdf"] : ["webp"]})
    return { ...result, url: result.secure_url }
}

const deleteFromCloudinary = async (imageUrl) => {
  try {
    const publicId = imageUrl.split("/").slice(-2).join("/").split(".")[0];
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Cloudinary delete error:", error);
  }
}
module.exports = { uploadToCloudinary, deleteFromCloudinary }
