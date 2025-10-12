// import crypto from "crypto";
const crypto = require("crypto");
// import Product from "../model/Product";
const Product = require("../model/Product");

// Function to generate a SKU
const generateSKU = () => {
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase(); 
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `CO-${datePart}-${randomSuffix}`;
};

const generateUniqueSKU = async () => {
  let newSKU;
  let exists = true;
  let attempts = 0;
  const maxAttempts = 5;

  while (exists && attempts < maxAttempts) {
    newSKU = generateSKU();

    // Check if SKU already exists in DB
    const existingProduct = await Product.findOne({ sku: newSKU });

    if (!existingProduct) {
      exists = false; // yay! unique found
    }

    attempts++;
  }

  if (exists) {
    throw new Error("Failed to generate unique SKU after multiple attempts");
  }

  return newSKU;
};

module.exports = { generateUniqueSKU };