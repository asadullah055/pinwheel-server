require("dotenv").config();
const mongodb_url = process.env.MONGO_URI;
const secretKey = process.env.JWT_SECRET;
const cloudName = process.env.CLOUD_NAME;
const cloudApiKey = process.env.CLOUD_API_KEY; 
const cloudApiSecret = process.env.CLOUD_API_SECRET;
module.exports = {
  mongodb_url,
  secretKey,
  cloudName,
  cloudApiKey, 
  cloudApiSecret,
};
