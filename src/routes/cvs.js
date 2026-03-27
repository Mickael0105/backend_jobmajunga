import { Router } from "express";
import { body, param } from "express-validator";

import { exec, query } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";
import { httpError } from "../middleware/errors.js";

export const cvsRouter = Router();

function mapCvRow(r) {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    title: r.title,
    templateId: r.template_id,
    colorTheme: r.color_theme,
    isPublic: Boolean(r.is_public),
    publicToken: r.public_token,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function assertCvAccess({ user, cvId }) {
  const rows = await query(`SELECT * FROM cvs WHERE id = :id`, { id: cvId });
  if (rows.length === 0) throw httpError(404, "Not found");
  const cv = rows[0];

  if (user.role === "admin") return cv;
  if (user.role === "candidate" && Number(cv.candidate_id) === Number(user.id)) return cv;

  if (user.role === "recruiter") {
    // Only if candidate applied to recruiter's offer (business rule)
    const ok = await query(
      `SELECT 1
       FROM applications a
       JOIN job_offers j ON j.id = a.job_offer_id
       WHERE a.cv_id = :cvId AND j.recruiter_id = :recruiterId
       LIMIT 1`,
      { cvId, recruiterId: user.id },
    );
    if (ok.length > 0) return cv;
  }

  throw httpError(403, "Forbidden");
}

cvsRouter.get("/", requireAuth, requireRole("candidate"), async (req, res, next) => {
  try {
    const rows = await query(`SELECT * FROM cvs WHERE candidate_id = :id ORDER BY updated_at DESC`, {
      id: req.user.id,
    });
    res.json(rows.map(mapCvRow));
  } catch (err) {
    next(err);
  }
});

cvsRouter.post(
  "/",
  requireAuth,
  requireRole("candidate"),
  body("title").isString().notEmpty(),
  body("templateId").optional().isString(),
  body("colorTheme").optional().isString(),
  body("isPublic").optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const b = req.body;
      const result = await exec(
        `INSERT INTO cvs (candidate_id, title, template_id, color_theme, is_public, public_token)
         VALUES (:candidateId, :title, :templateId, :colorTheme, :isPublic, NULL)`,
        {
          candidateId: req.user.id,
          title: b.title,
          templateId: b.templateId ?? "classic",
          colorTheme: b.colorTheme ?? "#2563EB",
          isPublic: b.isPublic ?? false,
        },
      );
      const rows = await query(`SELECT * FROM cvs WHERE id = :id`, { id: result.insertId });
      res.status(201).json(mapCvRow(rows[0]));
    } catch (err) {
      next(err);
    }
  },
);

cvsRouter.get(
  "/:id",
  requireAuth,
  requireRole("candidate", "recruiter", "admin"),
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const cv = await assertCvAccess({ user: req.user, cvId: id });
      const sections = await query(
        `SELECT id, cv_id AS cvId, section_type AS sectionType, display_order AS displayOrder, is_visible AS isVisible, content
         FROM cv_sections WHERE cv_id = :cvId ORDER BY display_order ASC, id ASC`,
        { cvId: id },
      );

      const mappedSections = sections.map((s) => ({
        ...s,
        isVisible: Boolean(s.isVisible),
        content: typeof s.content === "string" ? JSON.parse(s.content) : s.content,
      }));

      res.json({ ...mapCvRow(cv), sections: mappedSections });
    } catch (err) {
      next(err);
    }
  },
);

cvsRouter.put(
  "/:id",
  requireAuth,
  requireRole("candidate"),
  param("id").isInt({ min: 1 }),
  body("title").optional().isString().notEmpty(),
  body("templateId").optional().isString(),
  body("colorTheme").optional().isString(),
  body("isPublic").optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const cvRows = await query(`SELECT * FROM cvs WHERE id = :id`, { id });
      if (cvRows.length === 0) throw httpError(404, "Not found");
      if (Number(cvRows[0].candidate_id) !== Number(req.user.id)) throw httpError(403, "Forbidden");

      const b = req.body;
      await exec(
        `UPDATE cvs
         SET title = COALESCE(:title, title),
             template_id = COALESCE(:templateId, template_id),
             color_theme = COALESCE(:colorTheme, color_theme),
             is_public = COALESCE(:isPublic, is_public)
         WHERE id = :id`,
        {
          id,
          title: b.title ?? null,
          templateId: b.templateId ?? null,
          colorTheme: b.colorTheme ?? null,
          isPublic: typeof b.isPublic === "boolean" ? b.isPublic : null,
        },
      );

      const rows = await query(`SELECT * FROM cvs WHERE id = :id`, { id });
      res.json(mapCvRow(rows[0]));
    } catch (err) {
      next(err);
    }
  },
);

cvsRouter.delete(
  "/:id",
  requireAuth,
  requireRole("candidate"),
  param("id").isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const cvRows = await query(`SELECT * FROM cvs WHERE id = :id`, { id });
      if (cvRows.length === 0) throw httpError(404, "Not found");
      if (Number(cvRows[0].candidate_id) !== Number(req.user.id)) throw httpError(403, "Forbidden");
      await exec(`DELETE FROM cvs WHERE id = :id`, { id });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

cvsRouter.put(
  "/:id/sections",
  requireAuth,
  requireRole("candidate"),
  param("id").isInt({ min: 1 }),
  body().isArray().withMessage("body doit être un tableau de sections"),
  validate,
  async (req, res, next) => {
    try {
      const cvId = Number(req.params.id);
      const cvRows = await query(`SELECT * FROM cvs WHERE id = :id`, { id: cvId });
      if (cvRows.length === 0) throw httpError(404, "Not found");
      if (Number(cvRows[0].candidate_id) !== Number(req.user.id)) throw httpError(403, "Forbidden");

      const sections = req.body;

      // Simple strategy: replace all
      await exec(`DELETE FROM cv_sections WHERE cv_id = :cvId`, { cvId });

      for (const s of sections) {
        if (!s.sectionType || !s.content) throw httpError(400, "sectionType/content requis");
        await exec(
          `INSERT INTO cv_sections (cv_id, section_type, display_order, is_visible, content)
           VALUES (:cvId, :sectionType, :displayOrder, :isVisible, :content)`,
          {
            cvId,
            sectionType: s.sectionType,
            displayOrder: Number(s.displayOrder ?? 0),
            isVisible: typeof s.isVisible === "boolean" ? s.isVisible : true,
            content: JSON.stringify(s.content),
          },
        );
      }

      const rows = await query(
        `SELECT id, cv_id AS cvId, section_type AS sectionType, display_order AS displayOrder, is_visible AS isVisible, content
         FROM cv_sections WHERE cv_id = :cvId ORDER BY display_order ASC, id ASC`,
        { cvId },
      );
      res.json(
        rows.map((r) => ({
          ...r,
          isVisible: Boolean(r.isVisible),
          content: typeof r.content === "string" ? JSON.parse(r.content) : r.content,
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

