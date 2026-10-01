import { createServer } from "node:http";
import { createApi } from "./src/server.js";
import { PostgresRepository } from "./src/repository.js";

const port = Number(process.env.PORT || 8787);
const jwtSecret = process.env.JWT_SECRET;
const corsOrigin = process.env.CORS_ORIGIN || (process.env.NODE_ENV === "production" ? "" : "*");

if (process.env.NODE_ENV === "production" && (!corsOrigin || corsOrigin === "*")) {
  console.error("CORS_ORIGIN must be explicitly configured in production.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
if (!jwtSecret || jwtSecret.length < 32) {
  console.error("JWT_SECRET must be at least 32 characters.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && !process.env.PASSWORD_RESET_WEBHOOK_URL) {
  console.error("PASSWORD_RESET_WEBHOOK_URL is required in production.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && !process.env.PASSWORD_RESET_WEBHOOK_SECRET) {
  console.error("PASSWORD_RESET_WEBHOOK_SECRET is required in production.");
  process.exit(1);
}

const repo = new PostgresRepository();
const handler = createApi({ repo, jwtSecret, corsOrigin });
const server = createServer(handler);

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level:"info", service:"gym-api", port }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ level:"info", signal, message:"shutting down" }));
  server.close(async () => {
    await repo.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
