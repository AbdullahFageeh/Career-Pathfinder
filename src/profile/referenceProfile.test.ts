import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadCandidateProfile } from "./index.js";

const referenceFixture = `# Job Application Reference
## Identity and contact
- Full legal name: Test Candidate
- Preferred display name: Test Candidate

## Professional headline
- Default headline: Site Operations | Production Manager
- Target role families:
  - Site Manager
  - Production Manager

## Common screening answers
- Why are you a fit for this role?: I deliver complex site operations safely and on schedule.
- Languages spoken: English and Arabic
- Why are you looking for a new role?: TODO

## Core proof points
- Delivered installation and build execution across 6 venues
- Reduced safety incidents by 25% through inspections and compliance enforcement

## Certifications
- NEBOSH International General Certificate in Occupational Health and Safety (2024)
- PMP Certification Training Course (2024)

## Documents and file references
- Master CV PDF: /tmp/Test_Candidate_CV.pdf
- Cover letter base template: TODO
`;

test("loadCandidateProfile parses local reference markdown and filters TODO values", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-project-profile-"));
  const referencePath = join(tempDir, "APPLICATION_REFERENCE.md");

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(referencePath, referenceFixture, "utf8");

  const profile = await loadCandidateProfile({ referencePath });

  assert.equal(profile.fullName, "Test Candidate");
  assert.equal(profile.headline, "Site Operations | Production Manager");
  assert.deepEqual(profile.targetRoleFamilies, ["Site Manager", "Production Manager"]);
  assert.deepEqual(profile.certifications, [
    "NEBOSH International General Certificate in Occupational Health and Safety (2024)",
    "PMP Certification Training Course (2024)"
  ]);
  assert.equal(profile.documents.length, 1);
  assert.equal(profile.documents[0].path, "/tmp/Test_Candidate_CV.pdf");
  assert.equal(profile.recurringAnswers.length, 2);
  assert.ok(profile.recurringAnswers.every((answer) => answer.answer !== "TODO"));
});
