import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/migrate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: ["@openround/contracts", "@openround/db", "@openround/game-engine"],
  // The database package is bundled into the server, but node-postgres must stay
  // external because its CommonJS runtime performs legitimate dynamic requires.
  external: ["pg"],
});
