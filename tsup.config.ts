import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/adapters/fetch.ts",
    "src/adapters/openai.ts",
    "src/adapters/tools.ts",
    "src/adapters/express.ts",
    "src/adapters/hono.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
