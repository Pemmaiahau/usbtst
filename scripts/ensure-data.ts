// Runs before `npm run build`: if there is no scan data yet (a fresh checkout on Cloudflare, for example),
// run the scan first so the published site is never empty. If the scan fails, the build fails loudly.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (existsSync("public/data/pulse.json") && existsSync("public/data/btst.json")) {
  console.log("scan data present, skipping scan");
} else {
  console.log("no scan data found, running the scan first...");
  const r = spawnSync("npm", ["run", "scan"], { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error("The scan failed, so there is no data to publish. See the log above.");
    process.exit(r.status ?? 1);
  }
}
