import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const licenseGroups = JSON.parse(
  execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    cwd: root,
    encoding: "utf8",
  }),
);

const escapeMarkdown = (value) => String(value).replaceAll("|", "\\|");
const portablePackageName = (name) => {
  if (name.startsWith("@img/sharp-libvips-")) return "@img/sharp-libvips-platform-binary";
  if (name.startsWith("@img/sharp-")) return "@img/sharp-platform-binary";
  if (name.startsWith("@napi-rs/canvas-")) return "@napi-rs/canvas-platform-binary";
  if (name.startsWith("@next/swc-")) return "@next/swc-platform-binary";
  return name;
};
const lines = [
  "# Third-party notices",
  "",
  "This attribution index is generated from the production dependency graph pinned by",
  "`pnpm-lock.yaml`. Regenerate it with `pnpm licenses:report` and review it together with",
  "the release SBOM. Package and image distributions retain their complete license texts.",
  "Platform-specific Sharp/libvips, Canvas, and Next.js SWC package names are normalized so this file",
  "is reproducible across build hosts; exact native artifacts remain listed in each image SBOM.",
  "This file is not legal advice.",
  "",
  "## Application production dependencies",
  "",
];

for (const license of Object.keys(licenseGroups).sort((left, right) => left.localeCompare(right))) {
  const mergedPackages = new Map();
  for (const dependency of licenseGroups[license]) {
    const name = portablePackageName(dependency.name);
    const existing = mergedPackages.get(name);
    mergedPackages.set(name, {
      name,
      versions: [...new Set([...(existing?.versions ?? []), ...dependency.versions])],
      homepage: existing?.homepage ?? dependency.homepage,
    });
  }
  const packages = [...mergedPackages.values()].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
  lines.push(
    `### ${escapeMarkdown(license)}`,
    "",
    "| Package | Version | Project |",
    "|---|---|---|",
  );
  for (const dependency of packages) {
    const name = escapeMarkdown(dependency.name);
    const versions = escapeMarkdown([...new Set(dependency.versions)].sort().join(", "));
    const project = dependency.homepage ? `[Project page](${dependency.homepage})` : "Not provided";
    lines.push(`| ${name} | ${versions} | ${project} |`);
  }
  lines.push("");
}

lines.push(
  "## Services in the community Compose profile",
  "",
  "These programs run as separate containers and are not relicensed by OpenRound:",
  "",
  "| Service | Compose image | License and source |",
  "|---|---|---|",
  "| PostgreSQL | `postgres:17-alpine` | [PostgreSQL License](https://www.postgresql.org/about/licence/) |",
  "| Valkey | `valkey/valkey:8-alpine` | [BSD 3-Clause](https://github.com/valkey-io/valkey/blob/unstable/COPYING) |",
  "| MinIO Server | `cgr.dev/chainguard/minio@sha256:bd014394a80898e68c149f2311fdf8d5a2c2f3bb2c33b9327ae6d02b4b065ae1` | [GNU AGPL v3](https://github.com/minio/minio/blob/master/LICENSE) |",
  "| Mailpit | `axllent/mailpit:v1.27` | [MIT](https://github.com/axllent/mailpit/blob/develop/LICENSE) |",
  "| Caddy | `caddy:2.10-alpine` | [Apache 2.0](https://github.com/caddyserver/caddy/blob/master/LICENSE) |",
  "",
  "Operators distributing a composed appliance or modified service image are responsible for",
  "the corresponding license obligations. In particular, MinIO's AGPL terms are separate from",
  "the Apache-2.0 license that applies to OpenRound's own source and original bundled assets.",
  "",
);

const outputFile = join(root, "THIRD_PARTY_NOTICES.md");
writeFileSync(outputFile, `${lines.join("\n")}\n`);
execFileSync("pnpm", ["exec", "prettier", "--write", outputFile], {
  cwd: root,
  stdio: "ignore",
});
