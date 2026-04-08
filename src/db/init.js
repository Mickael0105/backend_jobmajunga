import mysql from "mysql2/promise";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.resolve(__dirname, "../../schema.sql");

export async function initDb() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "jobmajunga",
    password: process.env.DB_PASSWORD ?? "jobmajunga",
    database: process.env.DB_NAME ?? "jobmajunga2",
    multipleStatements: true,
    timezone: "Z",
  });

  try {
    const raw = await fs.readFile(schemaPath, "utf8");

    // Make every CREATE TABLE and CREATE INDEX idempotent
    const sql = raw
      .replace(/CREATE TABLE(?!\s+IF NOT EXISTS)/gi, "CREATE TABLE IF NOT EXISTS")
      .replace(/CREATE INDEX(?!\s+IF NOT EXISTS)/gi, "CREATE INDEX IF NOT EXISTS")
      .replace(/CREATE FULLTEXT INDEX(?!\s+IF NOT EXISTS)/gi, "CREATE FULLTEXT INDEX IF NOT EXISTS");

    await connection.query(sql);
    console.log("[db] Schema initialized successfully");
  } catch (err) {
    // ER_TABLE_EXISTS_ERROR / ER_DUP_KEYNAME are harmless — tables already exist
    if (err.code === "ER_TABLE_EXISTS_ERROR" || err.code === "ER_DUP_KEYNAME") {
      console.log("[db] Tables already exist, skipping initialization");
    } else {
      console.error("[db] Schema initialization failed:", err.message);
      throw err;
    }
  } finally {
    await connection.end();
  }
}
