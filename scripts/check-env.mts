// Checks an environment against what a PRODUCTION deployment needs, before it costs anything.
//   vercel env pull .env.production.local --environment=production && npx tsx scripts/check-env.mts .env.production.local
//   npx tsx scripts/check-env.mts            (checks the variables of the current shell)
// Prints the name of each variable that is missing or wrong — never a value. Exit code 1 if there is an error.
import fs from "node:fs";
import { configProblems } from "../src/lib/config-check";

const file = process.argv[2];
const vars: Record<string, string | undefined> = { ...process.env };
if (file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) vars[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
}
const problems = configProblems(vars);
for (const p of problems) console.log(`${p.level === "error" ? "ERROR" : "warn "} ${p.key}: ${p.message}`);
const errors = problems.filter((p) => p.level === "error").length;
console.log(`\n${errors} error(s), ${problems.length - errors} warning(s).${errors ? "" : problems.length ? " Nothing blocks the deployment; read the warnings." : " Nothing to report."}`);
process.exit(errors ? 1 : 0);
