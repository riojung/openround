import assert from "node:assert/strict";

const immutableBuildIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64}|sha256:[0-9a-f]{64})$/;
const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function requiredEnvironmentString(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  assert.ok(value, `${name} is required`);
  return value;
}

export function requiredBoolean(environment: NodeJS.ProcessEnv, name: string): boolean {
  const value = requiredEnvironmentString(environment, name);
  assert.ok(value === "true" || value === "false", `${name} must be true or false`);
  return value === "true";
}

export function requiredBillingMode(
  environment: NodeJS.ProcessEnv,
  name: string,
): "disabled" | "stripe" {
  const value = requiredEnvironmentString(environment, name);
  assert.ok(value === "disabled" || value === "stripe", `${name} must be disabled or stripe`);
  return value;
}

export function requiredImmutableBuildId(environment: NodeJS.ProcessEnv, name: string): string {
  const value = requiredEnvironmentString(environment, name);
  assert.match(
    value,
    immutableBuildIdPattern,
    `${name} must be an immutable Git commit or sha256 digest`,
  );
  return value;
}

export function optionalImmutableBuildId(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | null {
  return environment[name]?.trim() ? requiredImmutableBuildId(environment, name) : null;
}

export function requiredCookiePair(environment: NodeJS.ProcessEnv, name: string): string {
  const value = requiredEnvironmentString(environment, name);
  assert.ok(value.length <= 4_096, `${name} is too long`);
  assert.ok(!/[\r\n]/.test(value), `${name} must not contain line breaks`);
  assert.ok(
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+=[^\s;]+$/.test(value),
    `${name} must be one cookie pair`,
  );
  return value;
}

export function assertSecureReadinessUrl(target: URL, allowHttp: boolean): void {
  if (target.protocol === "https:") return;
  assert.ok(
    allowHttp && target.protocol === "http:" && loopbackHostnames.has(target.hostname),
    `${target.origin} must use HTTPS; READINESS_ALLOW_HTTP is limited to loopback development targets`,
  );
}
