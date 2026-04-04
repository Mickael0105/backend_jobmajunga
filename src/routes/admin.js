import { Router } from "express";
import { param, query as q, body } from "express-validator";

import { exec, query } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";
import { httpError } from "../middleware/errors.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("admin"));

adminRouter.get("/stats", async (_req, res, next) => {
  try {
    const [usersActive] = await query(`SELECT COUNT(*) AS c FROM users WHERE is_active = TRUE`);
    const [jobsPublished] = await query(`SELECT COUNT(*) AS c FROM job_offers WHERE status = 'published'`);
    const [applicationsToday] = await query(
      `SELECT COUNT(*) AS c
       FROM applications
       WHERE applied_at >= UTC_DATE() AND applied_at < (UTC_DATE() + INTERVAL 1 DAY)`,
    );

    res.json({
      usersActive: Number(usersActive?.c ?? 0),
      jobsPublished: Number(jobsPublished?.c ?? 0),
      applicationsToday: Number(applicationsToday?.c ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get(
  "/users",
  q("role").optional().isIn(["candidate", "recruiter", "admin"]),
  q("isActive").optional().isBoolean(),
  q("q").optional().isString(),
  q("page").optional().isInt({ min: 1 }),
  q("pageSize").optional().isInt({ min: 1, max: 100 }),
  validate,
  async (req, res, next) => {
    try {
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 20);
      const offset = (page - 1) * pageSize;

      const filters = [];
      const params = { limit: pageSize, offset };

      if (req.query.role) {
        filters.push(`role = :role`);
        params.role = String(req.query.role);
      }
      if (typeof req.query.isActive !== "undefined") {
        filters.push(`is_active = :isActive`);
        params.isActive = String(req.query.isActive) === "true";
      }
      if (req.query.q) {
        filters.push(`email LIKE :q`);
        params.q = `%${String(req.query.q)}%`;
      }

      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const totalRows = await query(`SELECT COUNT(*) AS total FROM users ${where}`, params);
      const total = Number(totalRows[0]?.total ?? 0);

      const rows = await query(
        `SELECT id, email, role, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
         FROM users ${where}
         ORDER BY created_at DESC
         LIMIT :limit OFFSET :offset`,
        params,
      );

      res.json({ items: rows.map((r) => ({ ...r, isActive: Boolean(r.isActive) })), page, pageSize, total });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.patch(
  "/users/:id",
  param("id").isInt({ min: 1 }),
  body("isActive").optional().isBoolean(),
  body("role").optional().isIn(["candidate", "recruiter", "admin"]),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const b = req.body ?? {};

      const result = await exec(
        `UPDATE users
         SET is_active = COALESCE(:isActive, is_active),
             role = COALESCE(:role, role)
         WHERE id = :id`,
        {
          id,
          isActive: typeof b.isActive === "boolean" ? b.isActive : null,
          role: b.role ?? null,
        },
      );
      if (result.affectedRows === 0) throw httpError(404, "Not found");

      const rows = await query(
        `SELECT id, email, role, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
         FROM users WHERE id = :id`,
        { id },
      );
      res.json({ ...rows[0], isActive: Boolean(rows[0].isActive) });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.delete(
  "/users/:id",
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const result = await exec(`DELETE FROM users WHERE id = :id`, { id });
      if (result.affectedRows === 0) throw httpError(404, "Not found");
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

