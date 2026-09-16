import { networkInterfaces } from "node:os";

const port = process.env.OPENROUND_PORT?.trim() || "8080";
const addresses = new Set();

for (const entries of Object.values(networkInterfaces())) {
  for (const entry of entries ?? []) {
    if (entry.family === "IPv4" && !entry.internal) addresses.add(entry.address);
  }
}

if (addresses.size === 0) {
  process.stdout.write(
    "No non-loopback IPv4 address was found. Check the computer's network settings.\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write("OpenRound addresses visible from this computer:\n\n");
  for (const address of addresses) process.stdout.write(`  http://${address}:${port}\n`);
  process.stdout.write(
    "\nUse an address reachable by the participant devices. Local firewalls, VPNs, and Wi-Fi client isolation can still block access.\n",
  );
}
