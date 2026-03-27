import jwt from "jsonwebtoken";
import { httpError } from "./errors.js";

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? "";
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) return next(httpError(401, "Unauthorized"));

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = {
      id: Number(payload.sub),
      role: payload.role,
    };
    return next();
  } catch {
    return next(httpError(401, "Unauthorized"));
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(httpError(401, "Unauthorized"));
    if (!roles.includes(req.user.role)) return next(httpError(403, "Forbidden"));
    return next();
  };
}

