const { notifyStorefront } = require("./storefrontCache");

const successMessage = (res, code, data) => {
  if (code >= 200 && code < 300) notifyStorefront(res.req);
  return res.status(code).json(data);
};
const errorMessage = (
  res,
  { statusCode = 500, message = "Internal server Error" }
) => {
  return res.status(statusCode).json({
    success: false,
    message: message,
  });
};

module.exports = { successMessage, errorMessage };
