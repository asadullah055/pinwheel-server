
module.exports = (res, accessToken, refreshToken) => {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'None' : 'Lax',
      maxAge: 1 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'None' : 'Lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  };
  