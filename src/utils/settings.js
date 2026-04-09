import { query, exec } from "../db/pool.js";

const DEFAULTS = {
  allowRegistrations: true,
  allowJobPostings: true,
  requireJobApproval: true,
  maintenanceMode: false,
};

export async function getSystemSettings() {
  const rows = await query(`SELECT setting_key AS k, setting_value AS v FROM system_settings`);
  const map = { ...DEFAULTS };
  for (const r of rows) {
    const key = r.k;
    if (!(key in map)) continue;
    map[key] = String(r.v) === "true";
  }
  return map;
}

export async function updateSystemSettings(patch) {
  const current = await getSystemSettings();
  const next = {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(([k, v]) => typeof v === "boolean" && k in current),
    ),
  };

  const entries = Object.entries(next);
  for (const [key, value] of entries) {
    await exec(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES (:key, :value)
       ON DUPLICATE KEY UPDATE setting_value = :value`,
      { key, value: value ? "true" : "false" },
    );
  }
  return next;
}
