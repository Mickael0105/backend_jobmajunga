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
  namedPlaceholders: true,
});

async function main() {
  try {
    const [rows] = await pool.execute("SELECT * FROM error_logs ORDER BY id DESC LIMIT 10");
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("Error reading logs:", err);
  } finally {
    await pool.end();
  }
}

main();
