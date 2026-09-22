import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://crclaunch:crclaunch@localhost:5432/crclaunch",
  },
  verbose: true,
  strict: true,
});
