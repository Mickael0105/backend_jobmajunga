export function notFoundHandler(_req, res) {
  res.status(404).json({ message: "Not found" });
}

import { logError } from "../utils/logs.js";

export function errorHandler(err, req, res, _next) {
  const status = Number(err?.status ?? 500);
  const message =
    err?.expose === true
      ? String(err?.message ?? "Error")
      : status >= 500
        ? "Internal server error"
        : String(err?.message ?? "Error");

  // eslint-disable-next-line no-console
  if (status >= 500) console.error(err);
  if (status >= 500) {
    const stack = err?.stack ? String(err.stack).slice(0, 5000) : null;
    logError({
      level: "error",
      message: `[${req.method}] ${req.originalUrl} - ${String(err?.message ?? "Error")}`,
      stack,
    });
  }

  res.status(status).json({ message });
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}
