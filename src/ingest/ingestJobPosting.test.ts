import assert from "node:assert/strict";
import test from "node:test";

import { ingestJobPosting } from "./index.js";

test("ingestJobPosting canonicalizes source-shaped job data", () => {
  const ingested = ingestJobPosting({
    id: "  arbeitsagentur:12345  ",
    source: {
      kind: "job-board",
      name: "  arbeitsagentur ",
      url: " https://example.com/job/12345 "
    },
    title: " Site Manager (m/w/d) ",
    company: " Example Venue Services GmbH ",
    location: " Hamburg, Deutschland  ",
    description: "Lead site operations.   \n\n\nCoordinate vendors and delivery teams. ",
    tags: [
      "lane-1",
      "family:site-venue-operations",
      "matched-title:site-manager",
      "lane-1"
    ],
    discoveredAt: "2026-06-09T14:00:00Z"
  });

  assert.equal(ingested.id, "arbeitsagentur:12345");
  assert.equal(ingested.source.name, "arbeitsagentur");
  assert.equal(ingested.source.url, "https://example.com/job/12345");
  assert.equal(ingested.title, "Site Manager (m/w/d)");
  assert.equal(ingested.company, "Example Venue Services GmbH");
  assert.equal(ingested.location, "Hamburg, Deutschland");
  assert.equal(ingested.description, "Lead site operations.\n\nCoordinate vendors and delivery teams.");
  assert.equal(ingested.detectedRoleFamily, "site-venue-operations");
  assert.deepEqual(ingested.tags, [
    "family:site-venue-operations",
    "lane-1",
    "matched-title:site-manager"
  ]);
  assert.equal(ingested.discoveredAt, "2026-06-09T14:00:00.000Z");
});
