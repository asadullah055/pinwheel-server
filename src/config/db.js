const mongoose = require("mongoose");
mongoose.set("maxTimeMS", 10000);
const { mongodb_url } = require("../../secret");


const connectDB = async () => {
  try {
    await mongoose.connect(mongodb_url, {});
    console.log("MongoDB connected");
  } catch (err) {
    console.error("Error connecting to MongoDB", err);
    process.exit(1);
  }
};

module.exports = connectDB;
