import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function main() {
  const baseUrl = required("STRIPE_REHEARSAL_BASE_URL").replace(/\/$/, "");
  const browserOrigin = required("STRIPE_REHEARSAL_ORIGIN").replace(/\/$/, "");
  const creatorCookie = required("STRIPE_REHEARSAL_CREATOR_COOKIE");
  const webhookSecret = required("STRIPE_REHEARSAL_WEBHOOK_SECRET");
  const outputPath =
    process.env.STRIPE_REHEARSAL_OUTPUT?.trim() || "artifacts/readiness/stripe-replay.json";
  const runId = randomUUID();

  assert.equal(new URL(baseUrl).protocol, "https:", "Stripe rehearsal requires an HTTPS API URL");
  assert.equal(
    new URL(browserOrigin).protocol,
    "https:",
    "Stripe rehearsal requires an HTTPS origin",
  );
  assert.ok(!/[\r\n]/.test(creatorCookie), "creator cookie must not contain line breaks");

  function required(name: string) {
    const value = process.env[name]?.trim();
    assert.ok(value, `${name} is required`);
    return value;
  }

  async function request(url: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function authenticated<T>(path: string): Promise<T> {
    const response = await request(`${baseUrl}${path}`, {
      headers: { cookie: creatorCookie, origin: browserOrigin },
    });
    const body = await response.text();
    assert.equal(
      response.status,
      200,
      `${path} returned ${response.status}: ${body.slice(0, 300)}`,
    );
    return JSON.parse(body) as T;
  }

  function signedHeader(payload: string) {
    const timestamp = Math.floor(Date.now() / 1_000);
    const digest = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    return `t=${timestamp},v1=${digest}`;
  }

  async function sendEvent(event: Record<string, unknown>, signature?: string) {
    const payload = JSON.stringify(event);
    return request(`${baseUrl}/v1/webhooks/stripe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature ?? signedHeader(payload),
      },
      body: payload,
    });
  }

  function event(
    type: string,
    created: number,
    object: Record<string, unknown>,
    identifier = type,
  ) {
    return {
      id: `evt_openround_${runId.replaceAll("-", "")}_${identifier.replaceAll(".", "_")}_${created}`,
      object: "event",
      api_version: "2026-08-27.basil",
      created,
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type,
      data: { object },
    };
  }

  interface BillingStatus {
    billing: {
      plan: "free" | "pro";
      status: string;
      customerId: string | null;
      subscriptionId: string | null;
    };
    mode: "disabled" | "stripe";
  }

  const identity = await authenticated<{ creator: { workspaceId: string } }>("/v1/auth/me");
  const workspaceId = identity.creator.workspaceId;
  const initial = await authenticated<BillingStatus>("/v1/billing/status");
  assert.equal(initial.mode, "stripe", "staging billing mode must be stripe");
  assert.equal(
    initial.billing.plan,
    "free",
    "use a dedicated free-plan workspace for the destructive billing rehearsal",
  );

  const created = Math.floor(Date.now() / 1_000);
  const subscription = {
    id: `sub_openround_${runId}`,
    object: "subscription",
    customer: `cus_openround_${runId}`,
    metadata: { workspaceId },
    status: "canceled",
  };
  let cleanupRequired = false;
  let rehearsalError: unknown;

  try {
    const checkout = event("checkout.session.completed", created, {
      id: `cs_openround_${runId}`,
      object: "checkout.session",
      customer: `cus_openround_${runId}`,
      subscription: `sub_openround_${runId}`,
      metadata: { workspaceId },
    });
    cleanupRequired = true;
    assert.equal((await sendEvent(checkout)).status, 204, "checkout event was rejected");
    assert.equal((await sendEvent(checkout)).status, 204, "duplicate checkout event was rejected");
    assert.equal((await authenticated<BillingStatus>("/v1/billing/status")).billing.plan, "pro");

    const staleDeletion = event("customer.subscription.deleted", created - 60, subscription);
    assert.equal((await sendEvent(staleDeletion)).status, 204, "stale cancellation was rejected");
    assert.equal(
      (await authenticated<BillingStatus>("/v1/billing/status")).billing.plan,
      "pro",
      "a stale event changed the entitlement",
    );

    const invalidPayload = JSON.stringify(
      event("customer.subscription.deleted", created, subscription, "invalid-signature"),
    );
    assert.equal(
      (
        await request(`${baseUrl}/v1/webhooks/stripe`, {
          method: "POST",
          headers: { "content-type": "application/json", "stripe-signature": "invalid" },
          body: invalidPayload,
        })
      ).status,
      400,
      "an invalid Stripe signature was accepted",
    );

    const currentDeletion = event(
      "customer.subscription.deleted",
      created,
      subscription,
      "current-cancellation",
    );
    assert.equal(
      (await sendEvent(currentDeletion)).status,
      204,
      "current cancellation was rejected",
    );
    const final = await authenticated<BillingStatus>("/v1/billing/status");
    assert.equal(final.billing.plan, "free", "the rehearsal did not restore the free plan");
    cleanupRequired = false;
  } catch (error) {
    rehearsalError = error;
  }

  if (cleanupRequired) {
    try {
      const cleanupCreated = Math.max(created, Math.floor(Date.now() / 1_000));
      const cleanup = event(
        "customer.subscription.deleted",
        cleanupCreated,
        subscription,
        "failure-cleanup",
      );
      assert.equal(
        (await sendEvent(cleanup)).status,
        204,
        "failure cleanup cancellation was rejected",
      );
      const restored = await authenticated<BillingStatus>("/v1/billing/status");
      assert.equal(restored.billing.plan, "free", "failure cleanup did not restore the free plan");
    } catch (cleanupError) {
      if (rehearsalError) {
        throw new AggregateError(
          [rehearsalError, cleanupError],
          "Stripe rehearsal failed and its synthetic entitlement cleanup also failed",
        );
      }
      throw cleanupError;
    }
  }

  if (rehearsalError) throw rehearsalError;

  const evidence = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    target: new URL(baseUrl).origin,
    runId,
    checks: {
      signedCheckoutApplied: true,
      duplicateWasIdempotent: true,
      staleEventIgnored: true,
      invalidSignatureRejected: true,
      cancellationApplied: true,
      workspaceReturnedToFree: true,
    },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
