import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "jobmajunga",
  password: process.env.DB_PASSWORD ?? "jobmajunga",
  database: process.env.DB_NAME ?? "jobmajunga2",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
  timezone: "Z",
});

export async function query(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function exec(sql, params = {}) {
  const [result] = await pool.execute(sql, params);
  return result;
}

export { pool };

