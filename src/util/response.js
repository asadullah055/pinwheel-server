const successMessage = (res, code, data) => {
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
