const cookieOptions = () => ({
  httpOnly: true, secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", path: "/",
});
const sendToken = (res, accessToken, refreshToken) => {
  res.cookie("accessToken", accessToken, { ...cookieOptions(), maxAge: 15 * 60 * 1000 });
  res.cookie("refreshToken", refreshToken, { ...cookieOptions(), maxAge: 30 * 24 * 60 * 60 * 1000 });
};
sendToken.clear = (res) => {
  res.clearCookie("accessToken", cookieOptions());
  res.clearCookie("refreshToken", cookieOptions());
};
module.exports = sendToken;
