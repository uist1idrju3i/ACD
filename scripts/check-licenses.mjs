import { execFileSync } from "node:child_process";

const allowed = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "Python-2.0",
]);
const inventory = JSON.parse(
  execFileSync("pnpm", ["licenses", "list", "--json"], { encoding: "utf8" }),
);
const violations = [];

for (const [license, packages] of Object.entries(inventory)) {
  const expressions = license.split(/\s+OR\s+/u);
  if (!expressions.every((expression) => allowed.has(expression))) {
    for (const packageInfo of packages) {
      violations.push(`${packageInfo.name}@${packageInfo.versions.join(",")}: ${license}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Disallowed or unknown dependency licenses:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`License check passed for ${Object.values(inventory).flat().length} packages.`);
