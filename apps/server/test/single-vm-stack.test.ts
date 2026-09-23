import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(new URL("../../../compose.single-vm.yaml", import.meta.url), "utf8");
const caddyfile = readFileSync(
  new URL("../../../infra/single-vm/Caddyfile", import.meta.url),
  "utf8",
);

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
});
