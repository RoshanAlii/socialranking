import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const requiredFiles = [
  "index.html", "styles.css", "app.js", "data.js", "manifest.webmanifest", "README.md"
];
for (const file of requiredFiles) {
  assert.equal(fs.existsSync(path.join(directory, file)), true, `Missing ${file}`);
}

const assembledCss = fs.readFileSync(path.join(directory, "styles.css"), "utf8");
const assembledApp = fs.readFileSync(path.join(directory, "app.js"), "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(directory, "data.js"), "utf8"), sandbox);
const data = sandbox.window.VISIBILITY_DATA;

assert.ok(data, "VISIBILITY_DATA was not created");
assert.equal(data.meta.liveSources, 1, "Prototype must disclose one live source");
assert.equal(data.meta.liveSourceName, "Kirpa Social Ranking");
assert.ok(data.opportunities.length >= 6, "Expected a meaningful opportunity queue");
assert.equal(new Set(data.opportunities.map((item) => item.id)).size, data.opportunities.length, "Opportunity IDs must be unique");
assert.equal(new Set(data.integrations.map((item) => item.id)).size, data.integrations.length, "Integration IDs must be unique");
assert.equal(data.integrations.filter((item) => item.status === "Connected").length, 1, "Only Social Ranking can be connected in this prototype");
assert.ok(data.integrations.filter((item) => item.status !== "Connected").every((item) => item.coverage == null), "Unconnected coverage must remain unknown, not zero");
assert.ok(data.methodology.some((item) => item.label === "Sample"), "Sample evidence class must be explained");
for (const label of ["Verified", "Derived", "Public", "Estimated", "Modelled", "Experimental", "Sample", "Not connected"]) {
  assert.ok(data.methodology.some((item) => item.label === label), `Missing methodology label: ${label}`);
}
assert.ok(assembledCss.includes(".social-frame"), "Assembled CSS is incomplete");
assert.ok(assembledApp.includes('src="../index.html"'), "Live Social Ranking iframe is missing");
new vm.Script(assembledApp, { filename: "assembled-app.js" });
assert.ok(!assembledApp.includes("DecompressionStream"), "Browser-side decompression must not return");

const html = fs.readFileSync(path.join(directory, "index.html"), "utf8");
for (const ref of ["styles.css", "data.js", "app.js", "manifest.webmanifest"]) {
  assert.ok(html.includes(ref), `index.html does not reference ${ref}`);
}
assert.ok(html.includes("Kirpa Properties"));
assert.ok(!html.includes(".bundle.b64"), "HTML must not load compressed bundles");

console.log(`Visibility OS validation passed: ${requiredFiles.length} deployable files, ${data.opportunities.length} opportunities, ${data.integrations.length} integrations.`);
