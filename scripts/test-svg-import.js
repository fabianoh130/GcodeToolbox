#!/usr/bin/env node
/**
 * Smoke tests for svg-import.js using sample files in samples/svg/.
 * Run: node scripts/test-svg-import.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SAMPLES_DIR = path.join(ROOT, "samples", "svg");

function installDomParser() {
  if (typeof globalThis.DOMParser !== "undefined") return;
  try {
    const { parseHTML } = require("linkedom");
    globalThis.DOMParser = class DOMParser {
      parseFromString(str) {
        return parseHTML(str).document;
      }
    };
    return;
  } catch (_) {
    /* fall through */
  }
  console.error(
    "DOMParser niet beschikbaar. Installeer linkedom voor Node-tests:\n" +
      "  npm install linkedom --no-save\n" +
      "  node scripts/test-svg-import.js"
  );
  process.exit(1);
}

installDomParser();

const t = (key) => key;
eval(fs.readFileSync(path.join(ROOT, "svg-import.js"), "utf8"));

const SAMPLE_FILES = [
  { file: "simple-rect.svg", minContours: 1 },
  { file: "circle.svg", minContours: 1 },
  { file: "multi-contour.svg", minContours: 2 },
  { file: "curved-path.svg", minContours: 1 },
  { file: "polygon-hex.svg", minContours: 1 },
];

let failed = 0;

for (const { file, minContours } of SAMPLE_FILES) {
  const fullPath = path.join(SAMPLES_DIR, file);
  const svg = fs.readFileSync(fullPath, "utf8");
  try {
    const contours = parseSvgToContours(svg, t);
    const closed = contours.filter(
      (c) =>
        c.length >= 3 &&
        Math.hypot(c[c.length - 1].x - c[0].x, c[c.length - 1].y - c[0].y) < 1e-4
    );
    if (closed.length < minContours) {
      console.error(`FAIL ${file}: expected >= ${minContours} closed contour(s), got ${closed.length}`);
      failed++;
    } else {
      console.log(`OK   ${file}: ${closed.length} closed contour(s), ${closed[0].length} points in first`);
    }
  } catch (err) {
    console.error(`FAIL ${file}:`, err.message || err);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${SAMPLE_FILES.length} SVG sample tests passed.`);
