// Runs the toolkit server without Electron: `npm run serve` (or `node dist/node/server/cli.js`).
// Useful on a second PC, for development, and for tests. Options: --data <dir> --port <n> --host <ip>

import os from "node:os";
import path from "node:path";
import { Toolkit } from "./server";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dataDir = arg("data") ?? path.join(os.homedir(), ".vatsca-stream-toolkit");
const webRoot = path.resolve(__dirname, "../../web");
const port = arg("port");
const assetsDir = path.resolve(__dirname, "../../../assets/basemap");
const toolkit = new Toolkit({ dataDir, webRoot, assetsDir, port: port ? Number(port) : undefined, host: arg("host") });

toolkit.start().then((url) => {
  console.log(`VATSCA Stream Toolkit on ${url}  (data: ${dataDir})`);
  console.log(`  controls: ${url}/control.html`);
  console.log(`  map:      ${url}/map.html   <- add this as an OBS Browser Source`);
  console.log(`  plugin:   ${toolkit.config.pluginUrl}`);
}, (e) => {
  console.error("Could not start:", e.message);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => toolkit.stop().then(() => process.exit(0)));
