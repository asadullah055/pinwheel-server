const crypto = require("crypto"); // change model accordingly
const Users = require("../model/Users");

// Generate base number from date × 1.3
const generateBaseSellerId = () => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const multiplied = Math.floor(Number(datePart) * 1.3); 
  return multiplied; // pure number
};

const generateUniqueSellerId = async () => {
  let sellerId;
  let exists = true;
  let attempts = 0;
  const maxAttempts = 5;

  while (exists && attempts < maxAttempts) {
    const base = generateBaseSellerId();

    // Add random 3–4 digit number to ensure uniqueness
    const randomSuffix = crypto.randomInt(100, 9999);

    sellerId = Number(`${base}${randomSuffix}`);

    // Check if exists
    const existing = await Users.findOne({ sellerId });

    if (!existing) {
      exists = false; 
    }

    attempts++;
  }

  if (exists) {
    throw new Error("Failed to generate unique Seller ID after multiple attempts");
  }

  return sellerId;
};

module.exports = { generateUniqueSellerId };
