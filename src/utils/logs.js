import { exec, query } from "../db/pool.js";

export async function logActivity({
  userId = null,
  action,
  message = null,
  details = null,
  ipAddress = null,
}) {
  try {
    await exec(
      `INSERT INTO activity_logs (user_id, action, message, details, ip_address)
       VALUES (:userId, :action, :message, :details, :ipAddress)`,
      {
        userId,
        action,
        message,
        details: details ? JSON.stringify(details) : null,
        ipAddress,
      },
    );
  } catch {
    // Do not fail request on logging errors
  }
}

export async function logError({ level = "error", message, stack = null }) {
  try {
    await exec(
      `INSERT INTO error_logs (level, message, stack)
       VALUES (:level, :message, :stack)`,
      { level, message, stack },
    );
  } catch {
    // Do not fail request on logging errors
  }
}

export async function getActivityLogs({ limit = 200 }) {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 500) : 200;
  const rows = await query(
    `SELECT l.id, u.email, l.action, l.message, l.created_at AS createdAt
     FROM activity_logs l
     LEFT JOIN users u ON u.id = l.user_id
     ORDER BY l.created_at DESC
     LIMIT ${safeLimit}`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email ?? null,
    action: r.action ?? null,
    level: null,
    message: r.message ?? null,
    createdAt: r.createdAt,
  }));
}

export async function getErrorLogs({ limit = 200 }) {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 500) : 200;
  const rows = await query(
    `SELECT id, level, message, created_at AS createdAt
     FROM error_logs
     ORDER BY created_at DESC
     LIMIT ${safeLimit}`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: null,
    action: null,
    level: r.level ?? "error",
    message: r.message ?? null,
    createdAt: r.createdAt,
  }));
}
