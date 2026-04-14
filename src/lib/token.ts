import crypto from "crypto";

const SECRET = process.env.REQUEST_SECRET || "dev-secret-change-me";
const WINDOW = 60 * 60 * 1000; // 1-hour windows

export function generateToken(): string {
  const window = Math.floor(Date.now() / WINDOW);
  return crypto.createHmac("sha256", SECRET).update(String(window)).digest("hex");
}

export function validateToken(token: string): boolean {
  const now = Math.floor(Date.now() / WINDOW);
  // Accept current and previous window (handles clock skew / window boundary)
  return [now, now - 1].some(
    (w) => crypto.createHmac("sha256", SECRET).update(String(w)).digest("hex") === token
  );
}
