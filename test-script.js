import bcrypt from "bcryptjs";
import { query, exec } from "./src/db/pool.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./src/utils/jwt.js";
import dotenv from "dotenv";

dotenv.config();

async function test() {
  try {
    const email = "admin@jobmajunga.local";
    const password = "Admin12345!";
    const rows = await query(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];
    if (!user) { console.error("No user found"); return; }
    
    console.log("User:", user);
    
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) { console.error("Invalid password"); return; }
    
    const accessToken = signAccessToken({ userId: user.id, role: user.role });
    const refreshToken = signRefreshToken({ userId: user.id, role: user.role });
    const payload = verifyRefreshToken(refreshToken);
    
    console.log("Tokens generated");
    
    await exec(
        `INSERT INTO refresh_tokens (user_id, token, expires_at)
         VALUES (:userId, :token, :expiresAt)`,
        { userId: user.id, token: refreshToken, expiresAt: new Date(payload.exp * 1000) },
    );
    console.log("Refresh token persisted");
    
  } catch (err) {
    console.error("Caught error:", err);
  } finally {
    process.exit();
  }
}
test();
