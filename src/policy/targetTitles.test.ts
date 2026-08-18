import assert from "node:assert/strict";
import test from "node:test";

import { lane1ExactJobTitles } from "./targetTitles.js";

test("includes bounded related operations and delivery titles for transferable-role discovery", () => {
  for (const title of [
    "Operations Manager",
    "Programme Manager",
    "Implementation Manager",
    "Service Delivery Manager",
    "Client Delivery Manager",
    "Client Operations Manager"
  ]) {
    assert.ok(lane1ExactJobTitles.includes(title));
  }
});

test("does not add unrestricted sales-first or specialist engineering titles", () => {
  assert.equal(lane1ExactJobTitles.includes("Sales Director"), false);
  assert.equal(lane1ExactJobTitles.includes("Engineering Manager"), false);
});
