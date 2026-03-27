import mysql from "mysql2/promise";
import fs from "fs";

async function setupDB() {
  try {
    const pool = mysql.createPool({ host: "127.0.0.1", port: 3306, user: "root", password: "" });
    console.log("Connected as root without password");

    // Create DB
    await pool.query("CREATE DATABASE IF NOT EXISTS jobmajunga2 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;");
    console.log("Database created");

    // Create user
    try {
        await pool.query("CREATE USER IF NOT EXISTS 'jobmajunga'@'localhost' IDENTIFIED BY 'jobmajunga';");
    } catch(e) {}
    try {
        await pool.query("CREATE USER IF NOT EXISTS 'jobmajunga'@'%' IDENTIFIED BY 'jobmajunga';");
    } catch(e) {}
    await pool.query("GRANT ALL PRIVILEGES ON jobmajunga2.* TO 'jobmajunga'@'localhost';");
    await pool.query("GRANT ALL PRIVILEGES ON jobmajunga2.* TO 'jobmajunga'@'%';");
    await pool.query("FLUSH PRIVILEGES;");
    console.log("User 'jobmajunga' created and privileges granted");

    // Connect with the newly created credentials to import schema
    const appPool = mysql.createPool({ 
        host: "127.0.0.1", 
        port: 3306, 
        user: "jobmajunga", 
        password: "jobmajunga", 
        database: "jobmajunga2", 
        multipleStatements: true 
    });
    const schema = fs.readFileSync("./schema.sql", "utf-8");
    await appPool.query(schema);
    console.log("Schema imported successfully");
    
    process.exit(0);
  } catch (err) {
    console.error("Setup error:", err.message);
    process.exit(1);
  }
}
setupDB();
