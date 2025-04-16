const mongoose = require("mongoose");
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
