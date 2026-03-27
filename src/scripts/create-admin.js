import dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcryptjs";
import { exec, query } from "../db/pool.js";

const email = process.argv[2] ?? "admin@jobmajunga.local";
const password = process.argv[3] ?? "Admin12345!";

const passwordHash = await bcrypt.hash(String(password), 12);

try {
  const r = await exec(
    `INSERT INTO users (email, password, role, is_active)
     VALUES (:email, :password, 'admin', TRUE)`,
    { email: String(email).toLowerCase(), password: passwordHash },
  );
  const rows = await query(`SELECT id, email, role FROM users WHERE id = :id`, { id: r.insertId });
  // eslint-disable-next-line no-console
  console.log("Admin created:", rows[0]);
} catch (e) {
  if (String(e?.code) === "ER_DUP_ENTRY") {
    // eslint-disable-next-line no-console
    console.log("Admin already exists for email:", email);
  } else {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  }
}

