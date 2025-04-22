require("dotenv").config();
const mongodb_url = process.env.MONGO_URI;
const accessSecretKey = process.env.JWT_ACCESS_SECRET;
const refreshSecretKey = process.env.JWT_REFRESH_SECRET;
const cloudName = process.env.CLOUD_NAME;
const cloudApiKey = process.env.CLOUD_API_KEY; 
const cloudApiSecret = process.env.CLOUD_API_SECRET;
module.exports = {
  mongodb_url,
  accessSecretKey,
  refreshSecretKey,
  cloudName,
  cloudApiKey, 
  cloudApiSecret,
};
