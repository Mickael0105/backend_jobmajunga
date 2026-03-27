import jwt from "jsonwebtoken";

export function signAccessToken({ userId, role }) {
  return jwt.sign(
    { role },
    process.env.JWT_ACCESS_SECRET,
    {
      subject: String(userId),
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "1h",
    },
  );
}

export function signRefreshToken({ userId, role }) {
  return jwt.sign(
    { role },
    process.env.JWT_REFRESH_SECRET,
    {
      subject: String(userId),
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
    },
  );
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

