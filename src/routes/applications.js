import { Router } from "express";
import { body, param, query as q } from "express-validator";

import { exec, query } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";
import { httpError } from "../middleware/errors.js";
import { canProgressApplicationStatus } from "../utils/status.js";

export const applicationsRouter = Router();

function mapAppRow(r) {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    jobOfferId: r.job_offer_id,
    cvId: r.cv_id,
    coverLetter: r.cover_letter,
    status: r.status,
    recruiterNotes: r.recruiter_notes,
    interviewDate: r.interview_date,
    appliedAt: r.applied_at,
    updatedAt: r.updated_at,
  };
}

applicationsRouter.get(
  "/",
  requireAuth,
  requireRole("candidate", "recruiter", "admin"),
  q("status").optional().isIn(["sent", "viewed", "reviewing", "interview", "accepted", "rejected"]),
  q("jobOfferId").optional().isInt({ min: 1 }),
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

      if (req.user.role === "candidate") {
        filters.push(`candidate_id = :userId`);
        params.userId = req.user.id;
      } else if (req.user.role === "recruiter") {
        filters.push(
          `job_offer_id IN (SELECT id FROM job_offers WHERE recruiter_id = :userId)`,
        );
        params.userId = req.user.id;
      }

      if (req.query.status) {
        filters.push(`status = :status`);
        params.status = String(req.query.status);
      }
      if (req.query.jobOfferId) {
        filters.push(`job_offer_id = :jobOfferId`);
        params.jobOfferId = Number(req.query.jobOfferId);
      }

      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const totalRows = await query(`SELECT COUNT(*) AS total FROM applications ${where}`, params);
      const total = Number(totalRows[0]?.total ?? 0);

      const rows = await query(
        `SELECT * FROM applications ${where}
         ORDER BY updated_at DESC
         LIMIT :limit OFFSET :offset`,
        params,
      );

      res.json({ items: rows.map(mapAppRow), page, pageSize, total });
    } catch (err) {
      next(err);
    }
  },
);

applicationsRouter.post(
  "/",
  requireAuth,
  requireRole("candidate"),
  body("jobOfferId").isInt({ min: 1 }),
  body("cvId").isInt({ min: 1 }),
  body("coverLetter").optional({ nullable: true }).isString(),
  validate,
  async (req, res, next) => {
    try {
      const candidateId = req.user.id;
      const jobOfferId = Number(req.body.jobOfferId);
      const cvId = Number(req.body.cvId);

      const jobRows = await query(`SELECT * FROM job_offers WHERE id = :id`, { id: jobOfferId });
      if (jobRows.length === 0) throw httpError(400, "offre invalide");
      const job = jobRows[0];
      if (job.status !== "published") throw httpError(400, "offre non postullable");
      if (job.status === "expired" || job.status === "archived") throw httpError(400, "offre non postullable");

      // Ensure CV belongs to candidate (and exists)
      const cvRows = await query(`SELECT * FROM cvs WHERE id = :id`, { id: cvId });
      if (cvRows.length === 0) throw httpError(400, "cv invalide");
      if (Number(cvRows[0].candidate_id) !== Number(candidateId)) throw httpError(403, "Forbidden");

      const result = await exec(
        `INSERT INTO applications (candidate_id, job_offer_id, cv_id, cover_letter, status)
         VALUES (:candidateId, :jobOfferId, :cvId, :coverLetter, 'sent')`,
        {
          candidateId,
          jobOfferId,
          cvId,
          coverLetter: req.body.coverLetter ?? null,
        },
      );

      const rows = await query(`SELECT * FROM applications WHERE id = :id`, { id: result.insertId });
      res.status(201).json(mapAppRow(rows[0]));
    } catch (err) {
      if (String(err?.code) === "ER_DUP_ENTRY") return next(httpError(409, "déjà postulé"));
      next(err);
    }
  },
);

applicationsRouter.get(
  "/:id",
  requireAuth,
  requireRole("candidate", "recruiter", "admin"),
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const rows = await query(`SELECT * FROM applications WHERE id = :id`, { id });
      if (rows.length === 0) throw httpError(404, "Not found");
      const a = rows[0];

      if (req.user.role === "candidate" && Number(a.candidate_id) !== Number(req.user.id)) {
        throw httpError(403, "Forbidden");
      }
      if (req.user.role === "recruiter") {
        const ok = await query(
          `SELECT 1 FROM job_offers WHERE id = :jobOfferId AND recruiter_id = :recruiterId LIMIT 1`,
          { jobOfferId: a.job_offer_id, recruiterId: req.user.id },
        );
        if (ok.length === 0) throw httpError(403, "Forbidden");
      }

      res.json(mapAppRow(a));
    } catch (err) {
      next(err);
    }
  },
);

applicationsRouter.patch(
  "/:id/status",
  requireAuth,
  requireRole("recruiter", "admin"),
  param("id").isInt({ min: 1 }),
  body("status").isIn(["viewed", "reviewing", "interview", "accepted", "rejected"]),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const rows = await query(`SELECT * FROM applications WHERE id = :id`, { id });
      if (rows.length === 0) throw httpError(404, "Not found");
      const a = rows[0];

      if (req.user.role === "recruiter") {
        const ok = await query(
          `SELECT 1 FROM job_offers WHERE id = :jobOfferId AND recruiter_id = :recruiterId LIMIT 1`,
          { jobOfferId: a.job_offer_id, recruiterId: req.user.id },
        );
        if (ok.length === 0) throw httpError(403, "Forbidden");
      }

      const newStatus = String(req.body.status);
      if (!canProgressApplicationStatus(a.status, newStatus)) throw httpError(400, "statut invalide");

      await exec(`UPDATE applications SET status = :status WHERE id = :id`, { id, status: newStatus });
      const updated = await query(`SELECT * FROM applications WHERE id = :id`, { id });
      res.json(mapAppRow(updated[0]));
    } catch (err) {
      next(err);
    }
  },
);

applicationsRouter.patch(
  "/:id/notes",
  requireAuth,
  requireRole("recruiter"),
  param("id").isInt({ min: 1 }),
  body("recruiterNotes").isString().withMessage("recruiterNotes requis"),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const rows = await query(`SELECT * FROM applications WHERE id = :id`, { id });
      if (rows.length === 0) throw httpError(404, "Not found");
      const a = rows[0];

      const ok = await query(
        `SELECT 1 FROM job_offers WHERE id = :jobOfferId AND recruiter_id = :recruiterId LIMIT 1`,
        { jobOfferId: a.job_offer_id, recruiterId: req.user.id },
      );
      if (ok.length === 0) throw httpError(403, "Forbidden");

      await exec(`UPDATE applications SET recruiter_notes = :notes WHERE id = :id`, {
        id,
        notes: req.body.recruiterNotes ?? null,
      });
      const updated = await query(`SELECT * FROM applications WHERE id = :id`, { id });
      res.json(mapAppRow(updated[0]));
    } catch (err) {
      next(err);
    }
  },
);

applicationsRouter.patch(
  "/:id/interview",
  requireAuth,
  requireRole("recruiter"),
  param("id").isInt({ min: 1 }),
  body("interviewDate").isISO8601().withMessage("interviewDate requis (date-time ISO8601)"),
  body("location").optional({ nullable: true }).isString(),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const rows = await query(`SELECT * FROM applications WHERE id = :id`, { id });
      if (rows.length === 0) throw httpError(404, "Not found");
      const a = rows[0];

      const ok = await query(
        `SELECT 1 FROM job_offers WHERE id = :jobOfferId AND recruiter_id = :recruiterId LIMIT 1`,
        { jobOfferId: a.job_offer_id, recruiterId: req.user.id },
      );
      if (ok.length === 0) throw httpError(403, "Forbidden");

      await exec(`UPDATE applications SET interview_date = :dt WHERE id = :id`, {
        id,
        dt: new Date(req.body.interviewDate),
      });

      const updated = await query(`SELECT * FROM applications WHERE id = :id`, { id });
      res.json(mapAppRow(updated[0]));
    } catch (err) {
      next(err);
    }
  },
);

