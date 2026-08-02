import { execFileSync } from "node:child_process";
import process from "node:process";

const allowed = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "Python-2.0",
]);
const isAllowedExpression = (expression) => {
  const alternatives = expression
    .replace(/[()]/gu, "")
    .split(/\s+OR\s+/u)
    .map((alternative) => alternative.trim())
    .filter(Boolean);
  return alternatives.some((alternative) =>
    alternative
      .split(/\s+AND\s+/u)
      .map((term) => term.trim())
      .every((term) => allowed.has(term)),
  );
};
const inventory = JSON.parse(
  execFileSync("pnpm", ["licenses", "list", "--json"], { encoding: "utf8" }),
);
const violations = [];

for (const [license, packages] of Object.entries(inventory)) {
  if (!isAllowedExpression(license)) {
    for (const packageInfo of packages) {
      violations.push(`${packageInfo.name}@${packageInfo.versions.join(",")}: ${license}`);
    }
  }
}

if (violations.length > 0) {
  globalThis.console.error("Disallowed or unknown dependency licenses:");
  for (const violation of violations) globalThis.console.error(`- ${violation}`);
  process.exit(1);
}

globalThis.console.log(
  `License check passed for ${Object.values(inventory).flat().length} packages.`,
);
