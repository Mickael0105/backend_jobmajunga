import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { body } from "express-validator";
import crypto from "crypto";

import { exec, query } from "../db/pool.js";
import { validate } from "../middleware/validation.js";
import { httpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { sendPasswordResetEmail } from "../utils/mail.js";
import { logActivity } from "../utils/logs.js";
import { getSystemSettings } from "../utils/settings.js";
import { saveBase64Image } from "../utils/files.js";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

function userRowToDto(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    isActive: Boolean(u.is_active),
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

async function persistRefreshToken({ userId, token, expiresAt }) {
  await exec(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES (:userId, :token, :expiresAt)`,
    { userId, token, expiresAt },
  );
}

async function deleteRefreshToken(token) {
  await exec(`DELETE FROM refresh_tokens WHERE token = :token`, { token });
}

authRouter.post(
  "/register",
  authLimiter,
  body("email").isEmail().withMessage("email invalide"),
  body("password").isString().isLength({ min: 8 }).withMessage("mot de passe trop court"),
  body("role").isIn(["candidate", "recruiter"]).withMessage("role invalide"),
  body("consent").isBoolean().equals("true").withMessage("consent requis"),
  validate,
  async (req, res, next) => {
    try {
      const settings = await getSystemSettings();
      if (!settings.allowRegistrations) throw httpError(403, "Inscriptions dÃ©sactivÃ©es");

      const { email, password, role, candidateProfile, recruiterProfile } = req.body;

      const passwordHash = await bcrypt.hash(String(password), 12);
      const result = await exec(
        `INSERT INTO users (email, password, role, is_active)
         VALUES (:email, :password, :role, TRUE)`,
        { email: String(email).toLowerCase(), password: passwordHash, role },
      );

      const userId = result.insertId;

      if (role === "candidate") {
        const p = candidateProfile ?? {};
        if (!p.firstName || !p.lastName) throw httpError(400, "candidateProfile.firstName/lastName requis");
        await exec(
          `INSERT INTO candidate_profiles (user_id, first_name, last_name, phone, title, location, bio, photo_url)
           VALUES (:userId, :firstName, :lastName, :phone, :title, :location, :bio, :photoUrl)`,
          {
            userId,
            firstName: p.firstName,
            lastName: p.lastName,
            phone: p.phone ?? null,
            title: p.title ?? null,
            location: p.location ?? null,
            bio: p.bio ?? null,
            photoUrl: p.photoUrl ?? null,
          },
        );
      }

      if (role === "recruiter") {
        const p = recruiterProfile ?? {};
        if (!p.companyName) throw httpError(400, "recruiterProfile.companyName requis");
        const logoUrl = p.logoData ? saveBase64Image(p.logoData, "logo") : (p.logoUrl ?? null);
        await exec(
          `INSERT INTO recruiter_profiles (user_id, company_name, logo_url, description, website, sector)
           VALUES (:userId, :companyName, :logoUrl, :description, :website, :sector)`,
          {
            userId,
            companyName: p.companyName,
            logoUrl,
            description: p.description ?? null,
            website: p.website ?? null,
            sector: p.sector ?? null,
          },
        );
      }

      const rows = await query(`SELECT * FROM users WHERE id = :id`, { id: userId });
      const user = rows[0];

      const accessToken = signAccessToken({ userId, role: user.role });
      const refreshToken = signRefreshToken({ userId, role: user.role });
      const payload = verifyRefreshToken(refreshToken);
      await persistRefreshToken({
        userId,
        token: refreshToken,
        expiresAt: new Date(payload.exp * 1000),
      });

      await logActivity({
        userId,
        action: "user_registered",
        message: `New ${role} registered`,
        ipAddress: req.ip,
      });

      res.status(201).json({ accessToken, refreshToken, user: userRowToDto(user) });
    } catch (err) {
      if (String(err?.code) === "ER_DUP_ENTRY") return next(httpError(409, "email déjà utilisé"));
      return next(err);
    }
  },
);

authRouter.post(
  "/login",
  authLimiter,
  body("email").isEmail().withMessage("email invalide"),
  body("password").isString().withMessage("password requis"),
  validate,
  async (req, res, next) => {
    try {
      const email = String(req.body.email).toLowerCase();
      const password = String(req.body.password);
      const rows = await query(`SELECT * FROM users WHERE email = :email`, { email });
      const user = rows[0];
      if (!user) throw httpError(401, "Unauthorized");
      if (!user.is_active) throw httpError(401, "Unauthorized");

      const ok = await bcrypt.compare(password, user.password);
      if (!ok) throw httpError(401, "Unauthorized");

      const accessToken = signAccessToken({ userId: user.id, role: user.role });
      const refreshToken = signRefreshToken({ userId: user.id, role: user.role });
      const payload = verifyRefreshToken(refreshToken);
      await persistRefreshToken({
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(payload.exp * 1000),
      });

      res.json({ accessToken, refreshToken, user: userRowToDto(user) });
    } catch (err) {
      return next(err);
    }
  },
);

authRouter.post(
  "/refresh",
  body("refreshToken").isString().notEmpty().withMessage("refreshToken requis"),
  validate,
  async (req, res, next) => {
    try {
      const oldToken = String(req.body.refreshToken);
      const payload = verifyRefreshToken(oldToken);

      const stored = await query(
        `SELECT * FROM refresh_tokens WHERE token = :token LIMIT 1`,
        { token: oldToken },
      );
      if (stored.length === 0) throw httpError(401, "Unauthorized");

      const userId = Number(payload.sub);
      const userRows = await query(`SELECT * FROM users WHERE id = :id`, { id: userId });
      const user = userRows[0];
      if (!user || !user.is_active) throw httpError(401, "Unauthorized");

      // Rotation: invalidate old, create new
      await deleteRefreshToken(oldToken);
      const newRefreshToken = signRefreshToken({ userId, role: user.role });
      const newPayload = verifyRefreshToken(newRefreshToken);
      await persistRefreshToken({
        userId,
        token: newRefreshToken,
        expiresAt: new Date(newPayload.exp * 1000),
      });

      const accessToken = signAccessToken({ userId, role: user.role });
      res.json({ accessToken, refreshToken: newRefreshToken });
    } catch (err) {
      return next(httpError(401, "Unauthorized"));
    }
  },
);

authRouter.post(
  "/logout",
  body("refreshToken").isString().notEmpty().withMessage("refreshToken requis"),
  validate,
  async (req, res, next) => {
    try {
      const token = String(req.body.refreshToken);
      await deleteRefreshToken(token);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const rows = await query(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
    const user = rows[0];
    if (!user) throw httpError(401, "Unauthorized");
    res.json(userRowToDto(user));
  } catch (err) {
    next(err);
  }
});

authRouter.post(
  "/forgot-password",
  authLimiter,
  body("email").isEmail().withMessage("email invalide"),
  validate,
  async (req, res, next) => {
    try {
      const email = String(req.body.email).toLowerCase();
      const rows = await query(`SELECT id, email, is_active FROM users WHERE email = :email`, { email });
      const user = rows[0];

      // Always return 204 (avoid account enumeration)
      if (!user || !user.is_active) {
        return res.status(204).send();
      }

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

      await exec(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES (:userId, :tokenHash, :expiresAt)`,
        { userId: user.id, tokenHash, expiresAt },
      );

      const baseUrl = process.env.PASSWORD_RESET_URL ?? "http://localhost:5173/reset-password";
      const resetUrl = `${baseUrl}?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(email)}`;
      await sendPasswordResetEmail({ to: email, resetUrl });

      await logActivity({
        userId: user.id,
        action: "password_reset_requested",
        message: "Password reset requested",
        ipAddress: req.ip,
      });

      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
);

authRouter.post(
  "/reset-password",
  authLimiter,
  body("email").isEmail().withMessage("email invalide"),
  body("token").isString().isLength({ min: 10 }).withMessage("token invalide"),
  body("newPassword").isString().isLength({ min: 8 }).withMessage("mot de passe trop court"),
  validate,
  async (req, res, next) => {
    try {
      const email = String(req.body.email).toLowerCase();
      const token = String(req.body.token);
      const newPassword = String(req.body.newPassword);

      const userRows = await query(`SELECT id FROM users WHERE email = :email AND is_active = TRUE`, { email });
      const user = userRows[0];
      if (!user) throw httpError(400, "Bad request");

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const tokenRows = await query(
        `SELECT * FROM password_reset_tokens
         WHERE user_id = :userId
           AND token_hash = :tokenHash
           AND used_at IS NULL
           AND expires_at > UTC_TIMESTAMP()
         ORDER BY created_at DESC
         LIMIT 1`,
        { userId: user.id, tokenHash },
      );
      if (tokenRows.length === 0) throw httpError(400, "Bad request");

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await exec(`UPDATE users SET password = :password WHERE id = :id`, { id: user.id, password: passwordHash });
      await exec(`UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE id = :id`, { id: tokenRows[0].id });

      // Revoke all refresh tokens (force re-login)
      await exec(`DELETE FROM refresh_tokens WHERE user_id = :userId`, { userId: user.id });

      await logActivity({
        userId: user.id,
        action: "password_reset_completed",
        message: "Password reset completed",
        ipAddress: req.ip,
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
