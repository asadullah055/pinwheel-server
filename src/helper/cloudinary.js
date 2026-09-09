const { cloudName, cloudApiKey, cloudApiSecret } = require("../../secret");


const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: cloudName,
  api_key: cloudApiKey,
  api_secret: cloudApiSecret,
  secure: true,
});

const uploadToCloudinary = async (path, folder)=>{
    const result = await cloudinary.uploader.upload(path, {folder, resource_type: "auto"})
    return result
}

const getCloudinaryUploadSignature = (folder) => {
  const timestamp = Math.round(Date.now() / 1000);
  const params = { folder, timestamp };
  const signature = cloudinary.utils.api_sign_request(params, cloudApiSecret);

  return {
    cloudName,
    apiKey: cloudApiKey,
    folder,
    timestamp,
    signature,
  };
};

const deleteFromCloudinary = async (imageUrl) => {
  try {
    const publicId = imageUrl.split("/").slice(-2).join("/").split(".")[0];
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Cloudinary delete error:", error);
  }
}
module.exports = { uploadToCloudinary, deleteFromCloudinary, getCloudinaryUploadSignature }
