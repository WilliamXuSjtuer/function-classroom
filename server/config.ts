import "dotenv/config";
import path from "node:path";
export interface Config {
  dataDir: string;
  port: number;
  host: string;
  origin: string;
  secure: boolean;
  demo: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  concurrency: number;
  timeout: number;
}
export function configFromEnv(): Config {
  const demo = process.env.DEMO_MODE === "true";
  const host = process.env.HOST || "127.0.0.1";
  if (
    demo &&
    (process.env.NODE_ENV === "production" ||
      !["127.0.0.1", "localhost"].includes(host))
  )
    throw new Error("演示模式仅允许本机开发环境。");
  return {
    dataDir: path.resolve(process.env.DATA_DIR || "data"),
    port: Number(process.env.PORT || 3001),
    host,
    origin: process.env.APP_ORIGIN || "http://localhost:5173",
    secure: process.env.COOKIE_SECURE === "true",
    demo,
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    concurrency: Math.max(1, Number(process.env.AI_CONCURRENCY || 12)),
    timeout: Number(process.env.AI_TIMEOUT_MS || 60000),
  };
}
