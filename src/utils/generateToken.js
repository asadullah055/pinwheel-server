const jwt = require('jsonwebtoken');
const { accessSecretKey, refreshSecretKey } = require('../../secret');

exports.generateAccessToken =async (user) => {
  return await jwt.sign({email: user?.email, id: user._id, role: user.role }, accessSecretKey, { expiresIn: "1m" });
};

exports.generateRefreshToken = async(user) => {
  return await jwt.sign({ email: user?.email, id: user._id, role: user.role  }, refreshSecretKey, { expiresIn: "30d" });
};