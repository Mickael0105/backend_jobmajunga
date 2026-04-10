import { Router } from "express";
import { param, query as q, body } from "express-validator";

import { exec, query } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";
import { httpError } from "../middleware/errors.js";
import { getActivityLogs, getErrorLogs } from "../utils/logs.js";
import { getSystemSettings, updateSystemSettings } from "../utils/settings.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("admin"));

function mapJobRow(r) {
  return {
    id: r.id,
    recruiterId: r.recruiter_id,
    title: r.title,
    description: r.description,
    contractType: r.contract_type,
    location: r.location,
    latitude: r.latitude,
    longitude: r.longitude,
    salaryMin: r.salary_min != null ? Number(r.salary_min) : null,
    salaryMax: r.salary_max != null ? Number(r.salary_max) : null,
    category: r.category,
    skills: r.skills ? (Array.isArray(r.skills) ? r.skills : JSON.parse(r.skills)) : [],
    status: r.status,
    viewsCount: r.views_count,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

adminRouter.get("/stats", async (_req, res, next) => {
  try {
    const [usersActive] = await query(`SELECT COUNT(*) AS c FROM users WHERE is_active = TRUE`);
    const [jobsPublished] = await query(`SELECT COUNT(*) AS c FROM job_offers WHERE status = 'published'`);
    const [applicationsToday] = await query(
      `SELECT COUNT(*) AS c
       FROM applications
       WHERE applied_at >= UTC_DATE() AND applied_at < (UTC_DATE() + INTERVAL 1 DAY)`,
    );

    const [offersTotal] = await query(`SELECT COUNT(*) AS c FROM job_offers`);
    const [applicationsTotal] = await query(`SELECT COUNT(*) AS c FROM applications`);
    const [interviewsTotal] = await query(
      `SELECT COUNT(*) AS c FROM applications WHERE status = 'interview'`,
    );
    const [hiresTotal] = await query(
      `SELECT COUNT(*) AS c FROM applications WHERE status = 'accepted'`,
    );

    const trends = await query(
      `WITH RECURSIVE dates AS (
         SELECT (UTC_DATE() - INTERVAL 29 DAY) AS d
         UNION ALL
         SELECT d + INTERVAL 1 DAY FROM dates WHERE d < UTC_DATE()
       )
       SELECT d,
         (SELECT COUNT(*) FROM job_offers WHERE DATE(created_at) = d) AS jobs,
         (SELECT COUNT(*) FROM applications WHERE DATE(applied_at) = d) AS applications
       FROM dates`,
    );

    res.json({
      usersActive: Number(usersActive?.c ?? 0),
      jobsPublished: Number(jobsPublished?.c ?? 0),
      applicationsToday: Number(applicationsToday?.c ?? 0),
      trends: {
        jobs: trends.map((t) => ({ date: String(t.d), count: Number(t.jobs ?? 0) })),
        applications: trends.map((t) => ({ date: String(t.d), count: Number(t.applications ?? 0) })),
      },
      conversion: {
        offers: Number(offersTotal?.c ?? 0),
        applications: Number(applicationsTotal?.c ?? 0),
        interviews: Number(interviewsTotal?.c ?? 0),
        hires: Number(hiresTotal?.c ?? 0),
      },
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
      const safePageSize = Number.isFinite(pageSize)
        ? Math.min(Math.max(pageSize, 1), 100)
        : 20;
      const safeOffset = Number.isFinite(offset) ? Math.max(offset, 0) : 0;

      const filters = [];
      const params = {};

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
         LIMIT ${safePageSize} OFFSET ${safeOffset}`,
        params,
      );

      res.json({ items: rows.map((r) => ({ ...r, isActive: Boolean(r.isActive) })), page, pageSize, total });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  "/jobs/moderation",
  async (_req, res, next) => {
    try {
      const rows = await query(
        `SELECT * FROM job_offers WHERE status = 'pending_approval' ORDER BY updated_at DESC`,
      );
      res.json(rows.map(mapJobRow));
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.patch(
  "/jobs/:id/approve",
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await exec(
        `UPDATE job_offers SET status = 'published' WHERE id = :id AND status = 'pending_approval'`,
        { id },
      );
      const rows = await query(`SELECT * FROM job_offers WHERE id = :id`, { id });
      if (rows.length === 0) throw httpError(404, "Not found");
      res.json(mapJobRow(rows[0]));
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.delete(
  "/jobs/:id",
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const result = await exec(`DELETE FROM job_offers WHERE id = :id`, { id });
      if (result.affectedRows === 0) throw httpError(404, "Not found");
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  "/logs",
  q("type").optional().isIn(["activity", "error"]),
  validate,
  async (req, res, next) => {
    try {
      const type = String(req.query.type ?? "activity");
      const logs = type === "error" ? await getErrorLogs({ limit: 200 }) : await getActivityLogs({ limit: 200 });
      res.json(logs);
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get("/settings", async (_req, res, next) => {
  try {
    const settings = await getSystemSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

adminRouter.put(
  "/settings",
  body("allowRegistrations").optional().isBoolean(),
  body("allowJobPostings").optional().isBoolean(),
  body("requireJobApproval").optional().isBoolean(),
  body("maintenanceMode").optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const updated = await updateSystemSettings(req.body ?? {});
      res.json(updated);
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
