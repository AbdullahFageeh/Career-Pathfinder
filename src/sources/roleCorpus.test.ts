import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRoleCorpus } from "./index.js";

async function createCorpusDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "role-corpus-"));
}

test("loadRoleCorpus ingests saved role records and reports invalid files", async () => {
  const corpusDir = await createCorpusDir();

  try {
    await writeFile(
      join(corpusDir, "job-alpha.json"),
      JSON.stringify({
        id: "job-alpha",
        source: { kind: "company-page", name: "Alpha Careers" },
        title: "Site Operations Manager",
        company: "Alpha",
        location: "Jeddah, Saudi Arabia",
        description: "Deliver site operations.",
        tags: ["official-source", "saudi-arabia"]
      }),
      "utf8"
    );
    await writeFile(join(corpusDir, "job-broken.json"), "{ not json", "utf8");
    await writeFile(join(corpusDir, "notes.txt"), "ignored", "utf8");

    const result = await loadRoleCorpus({
      corpusDir,
      now: "2026-08-12T09:00:00.000Z"
    });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]?.id, "job-alpha");
    assert.equal(result.jobs[0]?.discoveredAt, "2026-08-12T09:00:00.000Z");
    assert.equal(result.invalidFiles.length, 1);
    assert.match(result.invalidFiles[0]?.path ?? "", /job-broken\.json$/);
  } finally {
    await rm(corpusDir, { recursive: true, force: true });
  }
});

test("loadRoleCorpus keeps the newest record when ids repeat", async () => {
  const corpusDir = await createCorpusDir();

  try {
    const base = {
      source: { kind: "company-page", name: "Alpha Careers" },
      title: "Venue Operations Manager",
      company: "Alpha",
      location: "Riyadh, Saudi Arabia",
      description: "Deliver venue operations.",
      tags: ["official-source", "saudi-arabia"]
    };

    await writeFile(
      join(corpusDir, "a.json"),
      JSON.stringify({ ...base, id: "job-dupe", discoveredAt: "2026-07-01T00:00:00.000Z" }),
      "utf8"
    );
    await writeFile(
      join(corpusDir, "b.json"),
      JSON.stringify({ ...base, id: "job-dupe", discoveredAt: "2026-08-01T00:00:00.000Z" }),
      "utf8"
    );

    const result = await loadRoleCorpus({ corpusDir });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]?.discoveredAt, "2026-08-01T00:00:00.000Z");
  } finally {
    await rm(corpusDir, { recursive: true, force: true });
  }
});

test("loadRoleCorpus fails clearly when the directory is missing", async () => {
  await assert.rejects(
    () => loadRoleCorpus({ corpusDir: join(tmpdir(), "role-corpus-does-not-exist-12345") }),
    /could not be read/
  );
});
