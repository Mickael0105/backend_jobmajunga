import dotenv from "dotenv";
dotenv.config();

import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import path from "path";
import { fileURLToPath } from "url";

import { initDb } from "./db/init.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { authRouter } from "./routes/auth.js";
import { profilesRouter } from "./routes/profiles.js";
import { jobsRouter } from "./routes/jobs.js";
import { cvsRouter } from "./routes/cvs.js";
import { applicationsRouter } from "./routes/applications.js";
import { adminRouter } from "./routes/admin.js";

const app = express();
app.disable("x-powered-by");

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      const allowed = (process.env.CORS_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!origin) return cb(null, true);
      if (allowed.length === 0) return cb(null, true);
      return allowed.includes(origin)
        ? cb(null, true)
        : cb(new Error("CORS not allowed"), false);
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
app.use(globalLimiter);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const openapiPath = path.resolve(__dirname, "../openapi.yaml");
const openapiDoc = YAML.load(openapiPath);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDoc));

app.use("/v1/auth", authRouter);
app.use("/v1/profiles", profilesRouter);
app.use("/v1/jobs", jobsRouter);
app.use("/v1/cvs", cvsRouter);
app.use("/v1/applications", applicationsRouter);
app.use("/v1/admin", adminRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3000);

initDb()
  .then(() => {
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`[jobmajunga2] API listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[db] Failed to initialise schema — aborting startup", err);
    process.exit(1);
  });

