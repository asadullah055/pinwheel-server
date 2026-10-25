const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: "User" },
  url: { type: String, required: true, unique: true },
  publicId: { type: String, required: true },
}, { timestamps: true, versionKey: false });
module.exports = mongoose.model("UploadAsset", schema);
