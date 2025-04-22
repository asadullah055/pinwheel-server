const jwt = require('jsonwebtoken');
const { accessSecretKey, refreshSecretKey } = require('../../secret');

exports.generateAccessToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, accessSecretKey, { expiresIn: "15m" });
};

exports.generateRefreshToken = (user) => {
  return jwt.sign({ id: user._id }, refreshSecretKey, { expiresIn: "7d" });
};