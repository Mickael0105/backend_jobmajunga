import { validationResult } from "express-validator";
import { httpError } from "./errors.js";

export function validate(req, _res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  return next(httpError(400, result.array()[0]?.msg ?? "Bad request"));
}

