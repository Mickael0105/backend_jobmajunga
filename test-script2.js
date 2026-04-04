import mysql from "mysql2/promise";
async function testRoot() {
  try {
    const pool = mysql.createPool({
      host: "127.0.0.1",
      port: 3306,
      user: "root",
      password: "root", // from docker-compose
      database: "jobmajunga2"
    });
    const [rows] = await pool.query("SELECT 1+1 AS result");
    console.log("Root connection ok:", rows);
    process.exit(0);
  } catch (err) {
    console.error("Root connection error:", err.message);
    
    // Fallback test
    try {
        const pool2 = mysql.createPool({
           host: "127.0.0.1", port: 3306, user: "root", password: ""
        });
        const [rows2] = await pool2.query("SELECT 1+1 AS result");
        console.log("No password root connection ok (XAMPP/WAMP detected?):", rows2);
    } catch(err2) {
        console.error("No password root error:", err2.message);
    }
    process.exit(1);
  }
}
testRoot();
