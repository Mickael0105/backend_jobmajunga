import { Router } from "express";
import { body, param, query as q } from "express-validator";

import { exec, query } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";
import { httpError } from "../middleware/errors.js";
import { canProgressApplicationStatus } from "../utils/status.js";
import {
  extractSkillsFromJob,
  extractSkillsFromCvSections,
  computeCompatibilityScore,
} from "../utils/compatibility.js";

export const applicationsRouter = Router();

function mapAppRow(r) {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    candidateName: r.candidate_name ?? "",
    jobOfferId: r.job_offer_id,
    jobTitle: r.job_title ?? "",
    companyName: r.company_name ?? "",
    cvId: r.cv_id,
    coverLetter: r.cover_letter,
    status: r.status,
    recruiterNotes: r.recruiter_notes,
    interviewDate: r.interview_date,
    appliedAt: r.applied_at,
    updatedAt: r.updated_at,
    compatibilityScore: r.compatibility_score ?? null,
  };
}

async function attachCompatibilityScores(rows) {
  if (!rows || rows.length === 0) return rows;

  const jobIds = Array.from(new Set(rows.map((r) => r.job_offer_id))).filter(Boolean);
  const cvIds = Array.from(new Set(rows.map((r) => r.cv_id))).filter(Boolean);

  const jobMap = new Map();
  if (jobIds.length > 0) {
    const params = {};
    const inSql = jobIds.map((id, i) => {
      params[`jid${i}`] = id;
      return `:jid${i}`;
    });
    const jobRows = await query(
      `SELECT id, skills FROM job_offers WHERE id IN (${inSql.join(",")})`,
      params,
    );
    for (const j of jobRows) {
      jobMap.set(j.id, extractSkillsFromJob(j.skills));
    }
  }

  const cvSkillsMap = new Map();
  if (cvIds.length > 0) {
    const params = {};
    const inSql = cvIds.map((id, i) => {
      params[`cid${i}`] = id;
      return `:cid${i}`;
    });
    const cvRows = await query(
      `SELECT cv_id AS cvId, content FROM cv_sections
       WHERE section_type = 'skills' AND cv_id IN (${inSql.join(",")})
       ORDER BY display_order ASC, id ASC`,
      params,
    );
    for (const r of cvRows) {
      const existing = cvSkillsMap.get(r.cvId) ?? [];
      const content = typeof r.content === "string" ? JSON.parse(r.content) : r.content;
      const skills = extractSkillsFromCvSections([{ content }]);
      cvSkillsMap.set(r.cvId, existing.concat(skills));
    }
  }

  return rows.map((r) => {
    const jobSkills = jobMap.get(r.job_offer_id) ?? [];
    const cvSkills = cvSkillsMap.get(r.cv_id) ?? [];
    return {
      ...r,
      compatibility_score: computeCompatibilityScore(jobSkills, cvSkills),
    };
  });
}

applicationsRouter.get(
  "/mine",
  requireAuth,
  requireRole("candidate"),
  async (req, res, next) => {
    try {
      let rows = await query(
        `SELECT a.*, j.title AS job_title, rp.company_name AS company_name,
                CONCAT(cp.first_name, ' ', cp.last_name) AS candidate_name
         FROM applications a
         JOIN job_offers j ON j.id = a.job_offer_id
         LEFT JOIN recruiter_profiles rp ON rp.user_id = j.recruiter_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
         WHERE a.candidate_id = :id
         ORDER BY a.updated_at DESC`,
        { id: req.user.id },
      );
      rows = await attachCompatibilityScores(rows);
      res.json(rows.map(mapAppRow));
    } catch (err) {
      next(err);
    }
  },
);

applicationsRouter.get(
  "/received",
  requireAuth,
  requireRole("recruiter"),
  async (req, res, next) => {
    try {
      let rows = await query(
        `SELECT a.*, j.title AS job_title, rp.company_name AS company_name,
                CONCAT(cp.first_name, ' ', cp.last_name) AS candidate_name
         FROM applications a
         JOIN job_offers j ON j.id = a.job_offer_id
         LEFT JOIN recruiter_profiles rp ON rp.user_id = j.recruiter_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
         WHERE j.recruiter_id = :id
         ORDER BY a.updated_at DESC`,
        { id: req.user.id },
      );
      rows = await attachCompatibilityScores(rows);
      res.json(rows.map(mapAppRow));
    } catch (err) {
      next(err);
    }
  },
);

applicationsRouter.get(
  "/export",
  requireAuth,
  requireRole("recruiter", "admin"),
  validate,
  async (req, res, next) => {
    try {
      const rows = await query(
        `SELECT a.id, a.status, a.applied_at, a.updated_at,
                u.email AS candidateEmail,
                j.title AS jobTitle,
                rp.company_name AS companyName
         FROM applications a
         JOIN users u ON u.id = a.candidate_id
         JOIN job_offers j ON j.id = a.job_offer_id
         LEFT JOIN recruiter_profiles rp ON rp.user_id = j.recruiter_id
         WHERE (:recruiterId IS NULL OR j.recruiter_id = :recruiterId)
         ORDER BY a.applied_at DESC`,
        { recruiterId: req.user.role === "recruiter" ? req.user.id : null },
      );

      const escapeCsv = (v) => {
        if (v == null) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };
      const header = ["id", "status", "appliedAt", "updatedAt", "candidateEmail", "jobTitle", "companyName"];
      const lines = [header.join(",")].concat(
        rows.map((r) =>
          [
            r.id,
            r.status,
            r.applied_at,
            r.updated_at,
            r.candidateEmail,
            r.jobTitle,
            r.companyName,
          ]
            .map(escapeCsv)
            .join(","),
        ),
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="applications.csv"');
      res.send(lines.join("\n"));
    } catch (err) {
      next(err);
    }
  },
);

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
      const safePageSize = Number.isFinite(pageSize)
        ? Math.min(Math.max(pageSize, 1), 100)
        : 20;
      const safeOffset = Number.isFinite(offset) ? Math.max(offset, 0) : 0;

      const filters = [];
      const params = {};

      if (req.user.role === "candidate") {
        filters.push(`a.candidate_id = :userId`);
        params.userId = req.user.id;
      } else if (req.user.role === "recruiter") {
        filters.push(`j.recruiter_id = :userId`);
        params.userId = req.user.id;
      }

      if (req.query.status) {
        filters.push(`a.status = :status`);
        params.status = String(req.query.status);
      }
      if (req.query.jobOfferId) {
        filters.push(`a.job_offer_id = :jobOfferId`);
        params.jobOfferId = Number(req.query.jobOfferId);
      }

      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const totalRows = await query(
        `SELECT COUNT(*) AS total
         FROM applications a
         JOIN job_offers j ON j.id = a.job_offer_id
         ${where}`,
        params,
      );
      const total = Number(totalRows[0]?.total ?? 0);

      let rows = await query(
        `SELECT a.*, j.title AS job_title, rp.company_name AS company_name,
                CONCAT(cp.first_name, ' ', cp.last_name) AS candidate_name
         FROM applications a
         JOIN job_offers j ON j.id = a.job_offer_id
         LEFT JOIN recruiter_profiles rp ON rp.user_id = j.recruiter_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
         ${where}
         ORDER BY a.updated_at DESC
         LIMIT ${safePageSize} OFFSET ${safeOffset}`,
        params,
      );
      rows = await attachCompatibilityScores(rows);
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

      let rows = await query(
        `SELECT a.*, j.title AS job_title, rp.company_name AS company_name,
                CONCAT(cp.first_name, ' ', cp.last_name) AS candidate_name
         FROM applications a
         JOIN job_offers j ON j.id = a.job_offer_id
         LEFT JOIN recruiter_profiles rp ON rp.user_id = j.recruiter_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
         WHERE a.id = :id`,
        { id: result.insertId },
      );
      rows = await attachCompatibilityScores(rows);
      res.status(201).json(mapAppRow(rows[0]));
    } catch (err) {
      if (String(err?.code) === "ER_DUP_ENTRY") return next(httpError(409, "deja postule"));
      next(err);
    }
  },
);

applicationsRouter.get(
  "/:id/cv",
  requireAuth,
  requireRole("recruiter", "admin"),
  param("id").isInt({ min: 1 }),
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

      const cvRows = await query(`SELECT * FROM cvs WHERE id = :id`, { id: a.cv_id });
      if (cvRows.length === 0) throw httpError(404, "Not found");
      const sections = await query(
        `SELECT id, cv_id AS cvId, section_type AS sectionType, display_order AS displayOrder, is_visible AS isVisible, content
         FROM cv_sections WHERE cv_id = :cvId ORDER BY display_order ASC, id ASC`,
        { cvId: a.cv_id },
      );
      const mappedSections = sections.map((s) => ({
        ...s,
        isVisible: Boolean(s.isVisible),
        content: typeof s.content === "string" ? JSON.parse(s.content) : s.content,
      }));
      res.json({ ...cvRows[0], sections: mappedSections });
    } catch (err) {
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
      let rows = await query(
        `SELECT a.*, j.title AS job_title, rp.company_name AS company_name,
                CONCAT(cp.first_name, ' ', cp.last_name) AS candidate_name
         FROM applications a
         JOIN job_offers j ON j.id = a.job_offer_id
         LEFT JOIN recruiter_profiles rp ON rp.user_id = j.recruiter_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
         WHERE a.id = :id`,
        { id },
      );
      rows = await attachCompatibilityScores(rows);
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
      let updated = await query(
        `SELECT a.*, j.title AS job_title, rp.company_name AS company_name,
                CONCAT(cp.first_name, ' ', cp.last_name) AS candidate_name
         FROM applications a
         JOIN job_offers j ON j.id = a.job_offer_id
         LEFT JOIN recruiter_profiles rp ON rp.user_id = j.recruiter_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
         WHERE a.id = :id`,
        { id },
      );
      updated = await attachCompatibilityScores(updated);
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
      let updated = await query(
        `SELECT a.*, j.title AS job_title, rp.company_name AS company_name,
                CONCAT(cp.first_name, ' ', cp.last_name) AS candidate_name
         FROM applications a
         JOIN job_offers j ON j.id = a.job_offer_id
         LEFT JOIN recruiter_profiles rp ON rp.user_id = j.recruiter_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
         WHERE a.id = :id`,
        { id },
      );
      updated = await attachCompatibilityScores(updated);
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

      let updated = await query(
        `SELECT a.*, j.title AS job_title, rp.company_name AS company_name,
                CONCAT(cp.first_name, ' ', cp.last_name) AS candidate_name
         FROM applications a
         JOIN job_offers j ON j.id = a.job_offer_id
         LEFT JOIN recruiter_profiles rp ON rp.user_id = j.recruiter_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = a.candidate_id
         WHERE a.id = :id`,
        { id },
      );
      updated = await attachCompatibilityScores(updated);
      res.json(mapAppRow(updated[0]));
    } catch (err) {
      next(err);
    }
  },
);
