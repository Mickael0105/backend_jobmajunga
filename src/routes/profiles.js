import { Router } from "express";
import { body } from "express-validator";

import { query, exec } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validation.js";
import { httpError } from "../middleware/errors.js";
import { saveBase64Image } from "../utils/files.js";

export const profilesRouter = Router();

profilesRouter.get(
  "/candidate/me",
  requireAuth,
  requireRole("candidate"),
  async (req, res, next) => {
    try {
      const rows = await query(
        `SELECT user_id AS userId, first_name AS firstName, last_name AS lastName, phone, title, location, bio, photo_url AS photoUrl
         FROM candidate_profiles WHERE user_id = :userId`,
        { userId: req.user.id },
      );
      if (rows.length === 0) throw httpError(404, "Not found");
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

profilesRouter.put(
  "/candidate/me",
  requireAuth,
  requireRole("candidate"),
  body("firstName").optional().isString(),
  body("lastName").optional().isString(),
  body("phone").optional({ nullable: true }).isString(),
  body("title").optional({ nullable: true }).isString(),
  body("location").optional({ nullable: true }).isString(),
  body("bio").optional({ nullable: true }).isString(),
  body("photoUrl").optional({ nullable: true }).isString(),
  body("photoData").optional({ nullable: true }).isString(),
  validate,
  async (req, res, next) => {
    try {
      const p = req.body ?? {};
      const photoUrl = p.photoData ? saveBase64Image(p.photoData, "candidate") : (p.photoUrl ?? null);
      await exec(
        `UPDATE candidate_profiles
         SET first_name = COALESCE(:firstName, first_name),
             last_name = COALESCE(:lastName, last_name),
             phone = COALESCE(:phone, phone),
             title = COALESCE(:title, title),
             location = COALESCE(:location, location),
             bio = COALESCE(:bio, bio),
             photo_url = COALESCE(:photoUrl, photo_url)
         WHERE user_id = :userId`,
        {
          userId: req.user.id,
          firstName: p.firstName ?? null,
          lastName: p.lastName ?? null,
          phone: p.phone ?? null,
          title: p.title ?? null,
          location: p.location ?? null,
          bio: p.bio ?? null,
          photoUrl,
        },
      );
      const rows = await query(
        `SELECT user_id AS userId, first_name AS firstName, last_name AS lastName, phone, title, location, bio, photo_url AS photoUrl
         FROM candidate_profiles WHERE user_id = :userId`,
        { userId: req.user.id },
      );
      if (rows.length === 0) throw httpError(404, "Not found");
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

profilesRouter.get(
  "/recruiter/me",
  requireAuth,
  requireRole("recruiter"),
  async (req, res, next) => {
    try {
      const rows = await query(
        `SELECT user_id AS userId, company_name AS companyName, logo_url AS logoUrl, description, website, sector
         FROM recruiter_profiles WHERE user_id = :userId`,
        { userId: req.user.id },
      );
      if (rows.length === 0) throw httpError(404, "Not found");
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

profilesRouter.put(
  "/recruiter/me",
  requireAuth,
  requireRole("recruiter"),
  body("companyName").optional().isString(),
  body("logoUrl").optional({ nullable: true }).isString(),
  body("logoData").optional({ nullable: true }).isString(),
  body("description").optional({ nullable: true }).isString(),
  body("website").optional({ nullable: true }).isString(),
  body("sector").optional({ nullable: true }).isString(),
  validate,
  async (req, res, next) => {
    try {
      const p = req.body ?? {};
      const logoUrl = p.logoData ? saveBase64Image(p.logoData, "logo") : (p.logoUrl ?? null);
      await exec(
        `UPDATE recruiter_profiles
         SET company_name = COALESCE(:companyName, company_name),
             logo_url = COALESCE(:logoUrl, logo_url),
             description = COALESCE(:description, description),
             website = COALESCE(:website, website),
             sector = COALESCE(:sector, sector)
         WHERE user_id = :userId`,
        {
          userId: req.user.id,
          companyName: p.companyName ?? null,
          logoUrl,
          description: p.description ?? null,
          website: p.website ?? null,
          sector: p.sector ?? null,
        },
      );
      const rows = await query(
        `SELECT user_id AS userId, company_name AS companyName, logo_url AS logoUrl, description, website, sector
         FROM recruiter_profiles WHERE user_id = :userId`,
        { userId: req.user.id },
      );
      if (rows.length === 0) throw httpError(404, "Not found");
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

profilesRouter.post(
  "/photo",
  requireAuth,
  requireRole("candidate"),
  body("photoData").isString().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const photoUrl = saveBase64Image(req.body.photoData, "candidate");
      await exec(
        `UPDATE candidate_profiles SET photo_url = :photoUrl WHERE user_id = :userId`,
        { userId: req.user.id, photoUrl },
      );
      res.json({ photoUrl });
    } catch (err) {
      next(err);
    }
  },
);
