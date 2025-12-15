const crypto = require("crypto");
const Product = require("../model/Product");

// Function to generate a base SKU (timestamp-randomHex)
const generateBaseSKU = () => {
  const timestamp = Date.now(); // Current timestamp
  const randomHex = crypto.randomBytes(3).toString("hex").toUpperCase(); 
  return `${timestamp}-${randomHex}`;
};

// Function to generate unique SKU for main product (legacy format)
const generateUniqueSKU = async () => {
  let newSKU;
  let exists = true;
  let attempts = 0;
  const maxAttempts = 5;

  while (exists && attempts < maxAttempts) {
    const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase(); 
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    newSKU = `CO-${datePart}-${randomSuffix}`;

    const existingProduct = await Product.findOne({ sku: newSKU });

    if (!existingProduct) {
      exists = false;
    }

    attempts++;
  }

  if (exists) {
    throw new Error("Failed to generate unique SKU after multiple attempts");
  }

  return newSKU;
};

// Function to generate variant SKUs with counter
const generateVariantSKUs = async (variants) => {
  // Generate main SKU and remove "CO-" prefix
  const mainSKU = await generateUniqueSKU(); // e.g., "CO-20241215-8BDB6B"
  const baseSKU = mainSKU.replace(/^CO-/, ""); // Remove "CO-" → "20241215-8BDB6B"
  
  let counter = 1;

  for (const variant of variants) {
    // If SKU is provided from frontend and not empty, use it
    if (variant.sku && variant.sku.trim() !== "") {
      continue; // Keep the frontend-provided SKU
    }

    // Otherwise, generate SKU with counter
    let uniqueSKU;
    let exists = true;
    let attempts = 0;
    const maxAttempts = 10;

    while (exists && attempts < maxAttempts) {
      uniqueSKU = `${baseSKU}-${counter}`; // e.g., "20241215-8BDB6B-1"

      // Check if this SKU already exists in any variant of any product
      const existingProduct = await Product.findOne({
        "variants.sku": uniqueSKU
      });

      if (!existingProduct) {
        exists = false;
      } else {
        counter++; // Try next counter
      }

      attempts++;
    }

    if (exists) {
      throw new Error(`Failed to generate unique variant SKU after ${maxAttempts} attempts`);
    }

    variant.sku = uniqueSKU;
    counter++;
  }

  return variants;
};

module.exports = { generateUniqueSKU, generateVariantSKUs };