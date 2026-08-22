import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");
const sourceRoot = join(repoRoot, "src");

const blockedPatterns = [
  { label: "legacy full name fixture", regex: /Abdullah\s+Fageeh/gu },
  { label: "legacy personal email fixture", regex: /abdullah(?:fageeh)?@(example\.com|yahoo\.com)/giu },
  { label: "legacy fixture seed id", regex: /\babdullah-seed\b/giu },
  { label: "legacy profile id", regex: /\bprofile:abdullah\b/giu },
  { label: "legacy CV file fixture", regex: /\bAbdullah_Fageeh(?:_CV(?:_\d{4})?)?\.pdf\b/gu },
  { label: "legacy resume file fixture", regex: /\babdullah-resume\.pdf\b/giu }
];

const sourceFiles = collectFiles(sourceRoot).filter((filePath) => extname(filePath) === ".ts");
const violations = [];

for (const filePath of sourceFiles) {
  const content = readFileSync(filePath, "utf8");

  for (const blockedPattern of blockedPatterns) {
    blockedPattern.regex.lastIndex = 0;
    let match = blockedPattern.regex.exec(content);
    while (match) {
      const line = lineNumberAt(content, match.index);
      const excerpt = extractLine(content, line);
      violations.push({
        filePath: relative(repoRoot, filePath),
        line,
        label: blockedPattern.label,
        excerpt
      });
      match = blockedPattern.regex.exec(content);
    }
  }
}

if (violations.length > 0) {
  console.error("Privacy fixture scan failed. Replace blocked personal fixture identifiers.");
  for (const violation of violations) {
    console.error(`- ${violation.filePath}:${violation.line} (${violation.label})`);
    console.error(`  ${violation.excerpt}`);
  }
  process.exit(1);
}

console.log("Privacy fixture scan passed (src/**/*.ts).");

function collectFiles(rootDir) {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function lineNumberAt(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function extractLine(content, lineNumber) {
  const lines = content.split("\n");
  return lines[lineNumber - 1]?.trim() ?? "";
}
