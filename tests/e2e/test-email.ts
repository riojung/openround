import { randomUUID } from "node:crypto";

import type { TestInfo } from "@playwright/test";

export function testEmail(prefix: string, testInfo: TestInfo): string {
  const uniqueSuffix = randomUUID().replaceAll("-", "").slice(0, 12);

  return `${prefix}-${testInfo.project.name}-${testInfo.retry}-${uniqueSuffix}@example.com`;
}
