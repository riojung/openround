#!/usr/bin/env node

import { runAlertRehearsal } from "./ops/alert-rehearsal.mjs";

runAlertRehearsal()
  .then((evidence) => {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
