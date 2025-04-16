const { cloudName, cloudApiKey, cloudApiSecret } = require("../../secret");


const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: cloudName,
  api_key: cloudApiKey,
  api_secret: cloudApiSecret,
  secure: true,
});

uploadToCloudinary = async (path, folder)=>{
    const result = await cloudinary.uploader.upload(path, {folder})
    return result
}

module.exports = {uploadToCloudinary}