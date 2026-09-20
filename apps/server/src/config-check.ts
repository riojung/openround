import { loadConfig } from "./config.js";
import { createConfigCheckSummary } from "./config-check-summary.js";

const config = loadConfig();
const summary = createConfigCheckSummary(config);

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
