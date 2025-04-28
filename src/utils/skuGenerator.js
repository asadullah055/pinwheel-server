// Helper to generate a SKU
const crypto = require("crypto");

  // Function to generate a SKU
const generateSKU = () => {
    const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase(); 
    const datePart = new Date().toISOString().slice(0,10).replace(/-/g, ""); 
    return `PIN-${datePart}-${randomSuffix}`;
  };

  module.exports = generateSKU;