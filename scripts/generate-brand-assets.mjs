#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
const sharp = webRequire(
  webRequire.resolve("sharp", { paths: [dirname(webRequire.resolve("next"))] }),
);

for (const [source, name, width] of [
  ["icon", "apple", 180],
  ["logo", "logo", 1350],
  ["social", "social", 1200],
]) {
  await sharp(resolve(root, `apps/web/public/brand/polling-pops-${source}.svg`))
    .resize({ width })
    .png()
    .toFile(resolve(root, `apps/web/public/brand/polling-pops-${name}.png`));
}
process.stdout.write("Polling Pops PNG assets regenerated from original SVG masters.\n");
