import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(new URL("../../../compose.single-vm.yaml", import.meta.url), "utf8");
const communityCompose = readFileSync(new URL("../../../compose.yaml", import.meta.url), "utf8");
const minioUpgradeSmoke = readFileSync(
  new URL("../../../scripts/smoke-minio-volume-upgrade.sh", import.meta.url),
  "utf8",
);
const productionSmoke = readFileSync(
  new URL("../../../.github/workflows/production-smoke.yml", import.meta.url),
  "utf8",
);
const caddyfile = readFileSync(
  new URL("../../../infra/single-vm/Caddyfile", import.meta.url),
  "utf8",
);
const minioImage =
  "cgr.dev/chainguard/minio@sha256:bd014394a80898e68c149f2311fdf8d5a2c2f3bb2c33b9327ae6d02b4b065ae1";
const volumeOwnerImage =
  "cgr.dev/chainguard/wolfi-base@sha256:fac38d12efdb4bf43ac9e599a31db10a27ad5dd71e5f1618790962eda8d66180";

describe("single-VM security boundaries", () => {
  it("routes API ingress over a dedicated network and trusts only Caddy's fixed address", () => {
    expect(compose).toContain("TRUSTED_PROXY_IP: ${OPENROUND_CADDY_PROXY_IP:-172.30.255.2}");
    expect(compose).toContain("ipv4_address: ${OPENROUND_CADDY_PROXY_IP:-172.30.255.2}");
    expect(compose).toMatch(
      /server-ingress:\n\s+internal: true\n\s+ipam:\n\s+config:\n\s+- subnet: \$\{OPENROUND_SERVER_INGRESS_SUBNET:-172\.30\.255\.0\/29\}/,
    );
    expect(compose.match(/^ {6}(?:- )?server-ingress:?\s*$/gm)).toHaveLength(2);
    expect(caddyfile).toContain("reverse_proxy @backend server-ingress:4000");
    expect(caddyfile).toContain("header_up X-Forwarded-For {http.request.remote.host}");
  });

  it("reconciles the MinIO application policy on every initialization", () => {
    expect(compose).toContain(
      "mc admin policy create local openround-media /tmp/openround-media-policy.json",
    );
    expect(compose).not.toContain("mc admin policy info local openround-media");
  });

  it("uses immutable multi-profile images for MinIO and its ownership helper", () => {
    for (const profile of [communityCompose, compose]) {
      expect(profile.split(`image: ${minioImage}`).length - 1).toBe(2);
      expect(profile.split(`image: ${volumeOwnerImage}`).length - 1).toBe(1);
      expect(profile).not.toContain("quay.io/minio/minio");
    }
  });

  it("reconciles root-owned MinIO descendants before every non-root start", () => {
    for (const profile of [communityCompose, compose]) {
      expect(profile).toContain("minio-volume-owner:");
      expect(profile).toContain("find /data -xdev ! -user 65532 -exec chown -h 65532:65532 {} +");
      expect(profile).toContain('test -z "$$(find /data -xdev ! -user 65532 -print -quit)"');
      expect(profile).not.toContain(".openround-owner-65532");
      expect(profile).toMatch(
        /minio:\n(?:.|\n)*?depends_on:\n\s+minio-volume-owner:\n\s+condition: service_completed_successfully/,
      );
    }
    expect(minioUpgradeSmoke.match(/start_minio "\$root_container" "0:0"/g)).toHaveLength(2);
    expect(
      minioUpgradeSmoke.match(/start_minio "\$nonroot_container" "65532:65532"/g),
    ).toHaveLength(2);
    expect(minioUpgradeSmoke).toContain('put_object "$root_container" "after-rollback"');
    expect(productionSmoke).toContain("run: pnpm smoke:minio-volume-upgrade");
  });
});
