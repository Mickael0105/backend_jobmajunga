import dotenv from "dotenv";
import mysql from "mysql2/promise";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "jobmajunga",
  password: process.env.DB_PASSWORD ?? "jobmajunga",
  database: process.env.DB_NAME ?? "jobmajunga2",
});

async function main() {
  try {
    console.log("Checking if 'visibility' column exists in 'job_offers'...");
    const [columns] = await pool.execute("SHOW COLUMNS FROM job_offers LIKE 'visibility'");
    
    if (columns.length === 0) {
      console.log("Adding 'visibility' column to 'job_offers'...");
      await pool.execute("ALTER TABLE job_offers ADD COLUMN visibility ENUM('public', 'private') DEFAULT 'public' AFTER status");
      console.log("Column added successfully.");
    } else {
      console.log("Column 'visibility' already exists.");
    }
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}

main();
