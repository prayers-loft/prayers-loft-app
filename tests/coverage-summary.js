// Post-process Playwright's results.json into a human-readable coverage
// summary, grouped by user-journey tag (@smoke / @prayer / @scripture / ...).
// Generates: coverage-summary.txt and coverage-summary.json.
const fs = require("fs");
const path = require("path");

const RESULTS_FILE = path.join(__dirname, "playwright-report", "results.json");

if (!fs.existsSync(RESULTS_FILE)) {
  console.error(`No results file at ${RESULTS_FILE}. Did the suite run?`);
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));

// User journeys we want to roll up coverage for.
const JOURNEYS = [
  { key: "smoke",        label: "Smoke (boot, nav, shell)" },
  { key: "prayer",       label: "Prayer generation" },
  { key: "scripture",    label: "Scripture / daily verse / Q&A" },
  { key: "reflections",  label: "Reflections journal" },
  { key: "share",        label: "Share image generation + save" },
  { key: "persistence",  label: "Data persistence (local storage)" },
  { key: "navigation",   label: "Tab navigation" },
  { key: "offline",      label: "Offline / degraded mode" },
  { key: "guest-mode",   label: "Guest mode (no auth)" },
  { key: "settings",     label: "Guest settings & preferences" },
];

function walkTests(suite, out, parent) {
  const title = (parent ? parent + " > " : "") + (suite.title || "");
  for (const sub of suite.suites || []) walkTests(sub, out, title);
  for (const t of suite.specs || []) {
    const status = (t.tests?.[0]?.results?.[0]?.status) || "unknown";
    out.push({
      title: (title ? title + " > " : "") + t.title,
      file: suite.file || "",
      status,
      ok: t.ok ?? (status === "passed" || status === "expected"),
    });
  }
}

const tests = [];
for (const s of raw.suites || []) walkTests(s, tests, "");

function summarize(filter) {
  const subset = tests.filter(filter);
  const passed = subset.filter((t) => t.ok).length;
  const failed = subset.filter((t) => !t.ok).length;
  return { total: subset.length, passed, failed };
}

const byJourney = JOURNEYS.map((j) => {
  const tag = `@${j.key}`;
  const s = summarize((t) => t.title.includes(tag) || (t.file || "").includes(j.key));
  return { journey: j.key, label: j.label, ...s };
});
const overall = summarize(() => true);

const json = { generated_at: new Date().toISOString(), overall, byJourney, tests };
fs.writeFileSync(path.join(__dirname, "coverage-summary.json"), JSON.stringify(json, null, 2));

const lines = [];
lines.push("");
lines.push("========================================================");
lines.push("  Prayers Loft — E2E Coverage Summary");
lines.push("========================================================");
lines.push(`  Generated: ${json.generated_at}`);
lines.push("");
lines.push(`  OVERALL: ${overall.passed} passed / ${overall.failed} failed  (total ${overall.total})`);
lines.push("");
lines.push("  By user journey:");
lines.push("  --------------------------------------------------------");
for (const j of byJourney) {
  const icon = j.failed === 0 && j.total > 0 ? "\u2713" : (j.total === 0 ? "\u00b7" : "\u2717");
  const ratio = j.total === 0 ? "  (no tests)" : `${j.passed}/${j.total}`;
  lines.push(`  ${icon}  ${j.label.padEnd(40)} ${ratio}`);
}
lines.push("");
if (overall.failed > 0) {
  lines.push("  Failed tests:");
  for (const t of tests.filter((t) => !t.ok)) {
    lines.push(`    \u2717 ${t.title}`);
  }
  lines.push("");
}
lines.push("  HTML report: playwright-report/index.html");
lines.push("  JSON detail: coverage-summary.json");
lines.push("========================================================");
lines.push("");

const text = lines.join("\n");
fs.writeFileSync(path.join(__dirname, "coverage-summary.txt"), text);
process.stdout.write(text);
process.exit(overall.failed > 0 ? 1 : 0);
