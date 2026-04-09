import { Router } from "express";
import { body, param, query as q } from "express-validator";

import { exec, query } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";
import { httpError } from "../middleware/errors.js";

export const jobsRouter = Router();

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

jobsRouter.get(
  "/mine",
  requireAuth,
  requireRole("recruiter", "admin"),
  q("status").optional().isIn(["draft", "pending_approval", "published", "expired", "archived"]),
  validate,
  async (req, res, next) => {
    try {
      const params = {};
      const filters = [];

      if (req.user.role === "recruiter") {
        filters.push(`recruiter_id = :recruiterId`);
        params.recruiterId = req.user.id;
      }
      if (req.query.status) {
        filters.push(`status = :status`);
        params.status = String(req.query.status);
      }

      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const rows = await query(
        `SELECT * FROM job_offers ${where}
         ORDER BY updated_at DESC`,
        params,
      );
      res.json(rows.map(mapJobRow));
    } catch (err) {
      next(err);
    }
  },
);

jobsRouter.get(
  "/manage/:id",
  requireAuth,
  requireRole("recruiter", "admin"),
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await assertRecruiterOwnsJobOrAdmin({ user: req.user, jobId: id });
      const rows = await query(`SELECT * FROM job_offers WHERE id = :id`, { id });
      if (rows.length === 0) throw httpError(404, "Not found");
      res.json(mapJobRow(rows[0]));
    } catch (err) {
      next(err);
    }
  },
);

jobsRouter.get(
  "/",
  q("q").optional().isString(),
  q("contractType").optional().isIn(["CDI", "CDD", "Freelance", "Stage", "Alternance"]),
  q("location").optional().isString(),
  q("category").optional().isString(),
  q("salaryMin").optional().isFloat({ min: 0 }),
  q("salaryMax").optional().isFloat({ min: 0 }),
  q("lat").optional().isFloat(),
  q("lng").optional().isFloat(),
  q("radius").optional().isFloat({ min: 0 }),
  q("page").optional().isInt({ min: 1 }),
  q("pageSize").optional().isInt({ min: 1, max: 100 }),
  validate,
  async (req, res, next) => {
    try {
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 20);
      const offset = (page - 1) * pageSize;

    const filters = [];
const params = {};

const safePageSize = Number.isFinite(pageSize)
  ? Math.min(Math.max(pageSize, 1), 100)
  : 20;
const safeOffset = Number.isFinite(offset) ? Math.max(offset, 0) : 0;

const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

const totalRows = await query(`SELECT COUNT(*) AS total FROM job_offers ${where}`, params);

const rows = await query(
  `SELECT * FROM job_offers ${where}
   ORDER BY created_at DESC
   LIMIT ${safePageSize} OFFSET ${safeOffset}`,
  params,
);



      res.json({
        items: rows.map(mapJobRow),
        page,
        pageSize,
        total,
      });
    } catch (err) {
      next(err);
    }
  },
);

jobsRouter.post(
  "/",
  requireAuth,
  requireRole("recruiter"),
  body("title").isString().notEmpty(),
  body("description").isString().notEmpty(),
  body("contractType").isIn(["CDI", "CDD", "Freelance", "Stage", "Alternance"]),
  body("location").optional({ nullable: true }).isString(),
  body("latitude").optional({ nullable: true }).isFloat(),
  body("longitude").optional({ nullable: true }).isFloat(),
  body("salaryMin").optional({ nullable: true }).isFloat(),
  body("salaryMax").optional({ nullable: true }).isFloat(),
  body("category").optional({ nullable: true }).isString(),
  body("skills").optional().isArray(),
  body("expiresAt").optional({ nullable: true }).isISO8601(),
  validate,
  async (req, res, next) => {
    try {
      const b = req.body;
      const result = await exec(
        `INSERT INTO job_offers
          (recruiter_id, title, description, contract_type, location, latitude, longitude, salary_min, salary_max, category, skills, status, expires_at)
         VALUES
          (:recruiterId, :title, :description, :contractType, :location, :latitude, :longitude, :salaryMin, :salaryMax, :category, :skills, 'draft', :expiresAt)`,
        {
          recruiterId: req.user.id,
          title: b.title,
          description: b.description,
          contractType: b.contractType,
          location: b.location ?? null,
          latitude: b.latitude ?? null,
          longitude: b.longitude ?? null,
          salaryMin: b.salaryMin ?? null,
          salaryMax: b.salaryMax ?? null,
          category: b.category ?? null,
          skills: b.skills ? JSON.stringify(b.skills) : null,
          expiresAt: b.expiresAt ?? null,
        },
      );

      const rows = await query(`SELECT * FROM job_offers WHERE id = :id`, { id: result.insertId });
      res.status(201).json(mapJobRow(rows[0]));
    } catch (err) {
      next(err);
    }
  },
);

jobsRouter.get(
  "/:id",
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const rows = await query(`SELECT * FROM job_offers WHERE id = :id`, { id });
      if (rows.length === 0) throw httpError(404, "Not found");
      const job = rows[0];
      if (job.status !== "published") throw httpError(404, "Not found");
      res.json(mapJobRow(job));
    } catch (err) {
      next(err);
    }
  },
);

async function assertRecruiterOwnsJobOrAdmin({ user, jobId }) {
  if (user.role === "admin") return;
  const rows = await query(`SELECT recruiter_id FROM job_offers WHERE id = :id`, { id: jobId });
  if (rows.length === 0) throw httpError(404, "Not found");
  if (Number(rows[0].recruiter_id) !== Number(user.id)) throw httpError(403, "Forbidden");
}

jobsRouter.put(
  "/:id",
  requireAuth,
  requireRole("recruiter", "admin"),
  param("id").isInt({ min: 1 }),
  body("title").optional().isString().notEmpty(),
  body("description").optional().isString().notEmpty(),
  body("contractType").optional().isIn(["CDI", "CDD", "Freelance", "Stage", "Alternance"]),
  body("location").optional({ nullable: true }).isString(),
  body("latitude").optional({ nullable: true }).isFloat(),
  body("longitude").optional({ nullable: true }).isFloat(),
  body("salaryMin").optional({ nullable: true }).isFloat(),
  body("salaryMax").optional({ nullable: true }).isFloat(),
  body("category").optional({ nullable: true }).isString(),
  body("skills").optional().isArray(),
  body("expiresAt").optional({ nullable: true }).isISO8601(),
  body("status").optional().isIn(["draft", "pending_approval", "published", "expired", "archived"]),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await assertRecruiterOwnsJobOrAdmin({ user: req.user, jobId: id });

      const b = req.body;
      await exec(
        `UPDATE job_offers
         SET title = COALESCE(:title, title),
             description = COALESCE(:description, description),
             contract_type = COALESCE(:contractType, contract_type),
             location = COALESCE(:location, location),
             latitude = COALESCE(:latitude, latitude),
             longitude = COALESCE(:longitude, longitude),
             salary_min = COALESCE(:salaryMin, salary_min),
             salary_max = COALESCE(:salaryMax, salary_max),
             category = COALESCE(:category, category),
             skills = COALESCE(:skills, skills),
             expires_at = COALESCE(:expiresAt, expires_at),
             status = COALESCE(:status, status)
         WHERE id = :id`,
        {
          id,
          title: b.title ?? null,
          description: b.description ?? null,
          contractType: b.contractType ?? null,
          location: Object.prototype.hasOwnProperty.call(b, "location") ? (b.location ?? null) : null,
          latitude: Object.prototype.hasOwnProperty.call(b, "latitude") ? (b.latitude ?? null) : null,
          longitude: Object.prototype.hasOwnProperty.call(b, "longitude") ? (b.longitude ?? null) : null,
          salaryMin: Object.prototype.hasOwnProperty.call(b, "salaryMin") ? (b.salaryMin ?? null) : null,
          salaryMax: Object.prototype.hasOwnProperty.call(b, "salaryMax") ? (b.salaryMax ?? null) : null,
          category: Object.prototype.hasOwnProperty.call(b, "category") ? (b.category ?? null) : null,
          skills: b.skills ? JSON.stringify(b.skills) : null,
          expiresAt: Object.prototype.hasOwnProperty.call(b, "expiresAt") ? (b.expiresAt ?? null) : null,
          status: b.status ?? null,
        },
      );

      const rows = await query(`SELECT * FROM job_offers WHERE id = :id`, { id });
      if (rows.length === 0) throw httpError(404, "Not found");
      res.json(mapJobRow(rows[0]));
    } catch (err) {
      next(err);
    }
  },
);

jobsRouter.delete(
  "/:id",
  requireAuth,
  requireRole("recruiter", "admin"),
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await assertRecruiterOwnsJobOrAdmin({ user: req.user, jobId: id });
      await exec(`DELETE FROM job_offers WHERE id = :id`, { id });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

jobsRouter.post(
  "/:id/duplicate",
  requireAuth,
  requireRole("recruiter"),
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await assertRecruiterOwnsJobOrAdmin({ user: req.user, jobId: id });
      const rows = await query(`SELECT * FROM job_offers WHERE id = :id`, { id });
      if (rows.length === 0) throw httpError(404, "Not found");
      const j = rows[0];

      const result = await exec(
        `INSERT INTO job_offers
          (recruiter_id, title, description, contract_type, location, latitude, longitude, salary_min, salary_max, category, skills, status, expires_at)
         VALUES
          (:recruiterId, :title, :description, :contractType, :location, :latitude, :longitude, :salaryMin, :salaryMax, :category, :skills, 'draft', :expiresAt)`,
        {
          recruiterId: req.user.id,
          title: `${j.title} (copie)`,
          description: j.description,
          contractType: j.contract_type,
          location: j.location,
          latitude: j.latitude,
          longitude: j.longitude,
          salaryMin: j.salary_min,
          salaryMax: j.salary_max,
          category: j.category,
          skills: j.skills,
          expiresAt: j.expires_at,
        },
      );

      const created = await query(`SELECT * FROM job_offers WHERE id = :id`, { id: result.insertId });
      res.status(201).json(mapJobRow(created[0]));
    } catch (err) {
      next(err);
    }
  },
);

jobsRouter.post(
  "/:id/submit",
  requireAuth,
  requireRole("recruiter"),
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await assertRecruiterOwnsJobOrAdmin({ user: req.user, jobId: id });
      await exec(
        `UPDATE job_offers SET status = 'pending_approval' WHERE id = :id AND status = 'draft'`,
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

jobsRouter.post(
  "/:id/approve",
  requireAuth,
  requireRole("admin"),
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await exec(
        `UPDATE job_offers SET status = 'published' WHERE id = :id AND status IN ('pending_approval','draft')`,
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

jobsRouter.post(
  "/:id/archive",
  requireAuth,
  requireRole("recruiter", "admin"),
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await assertRecruiterOwnsJobOrAdmin({ user: req.user, jobId: id });
      await exec(`UPDATE job_offers SET status = 'archived' WHERE id = :id`, { id });
      const rows = await query(`SELECT * FROM job_offers WHERE id = :id`, { id });
      if (rows.length === 0) throw httpError(404, "Not found");
      res.json(mapJobRow(rows[0]));
    } catch (err) {
      next(err);
    }
  },
);

jobsRouter.post(
  "/:id/view",
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const result = await exec(
        `UPDATE job_offers SET views_count = views_count + 1 WHERE id = :id AND status = 'published'`,
        { id },
      );
      if (result.affectedRows === 0) throw httpError(404, "Not found");
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

