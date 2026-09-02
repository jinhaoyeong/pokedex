import assert from "node:assert/strict";
import test from "node:test";

import { classifyActiveListingReject } from "../src/lib/market/active-listing-hygiene";

const pikachu = {
  name: "Pikachu",
  englishName: "Pikachu",
  setName: "151",
  setEnglishName: "151",
  collectorNumber: "025",
  language: "en" as const,
};

test("wrong print, number, language, finish, and grade listings are rejected", () => {
  assert.equal(
    classifyActiveListingReject("Charizard 199 Scarlet Violet Base English PSA 10", {
      ...pikachu,
      requestedGrade: "PSA 10",
    }),
    "name_mismatch",
  );
  assert.equal(
    classifyActiveListingReject("Pikachu 151 #171 Japanese PSA 10", {
      ...pikachu,
      requestedGrade: "PSA 10",
    }),
    "number_mismatch",
  );
  assert.equal(
    classifyActiveListingReject("Pikachu 025 151 Japanese PSA 10", {
      ...pikachu,
      requestedGrade: "PSA 10",
    }),
    "language_mismatch",
  );
  assert.equal(
    classifyActiveListingReject("Pikachu 025 151 Reverse Holo PSA 10", {
      ...pikachu,
      finish: "holofoil",
      requestedGrade: "PSA 10",
    }),
    "finish_mismatch",
  );
  assert.equal(
    classifyActiveListingReject("Pikachu 025 151 Pokemon PSA 9", {
      ...pikachu,
      requestedGrade: "PSA 10",
    }),
    "grade_mismatch",
  );
});

test("lots, proxies, fakes, mixed-card, digital, and sealed listings are rejected", () => {
  assert.equal(
    classifyActiveListingReject("Pikachu 025 151 lot of 10 PSA 10", {
      ...pikachu,
      requestedGrade: "PSA 10",
    }),
    "lot_or_bulk",
  );
  assert.equal(
    classifyActiveListingReject("Pikachu 025 151 proxy PSA 10", {
      ...pikachu,
      requestedGrade: "PSA 10",
    }),
    "proxy_or_fake",
  );
  assert.equal(
    classifyActiveListingReject("Pikachu 025 151 fake reproduction PSA 10", {
      ...pikachu,
      requestedGrade: "PSA 10",
    }),
    "proxy_or_fake",
  );
  assert.equal(
    classifyActiveListingReject("Pikachu 025 151 mixed 4 cards PSA 10", {
      ...pikachu,
      requestedGrade: "PSA 10",
    }),
    "mixed_quantity",
  );
  assert.equal(
    classifyActiveListingReject("Pikachu 025 151 PTCGL digital code card", {
      ...pikachu,
      requestedGrade: "Ungraded",
    }),
    "digital_or_sealed",
  );
  assert.equal(
    classifyActiveListingReject("Pikachu 025 151 booster box sealed", {
      ...pikachu,
      requestedGrade: "Ungraded",
    }),
    "digital_or_sealed",
  );
});

test("an exact PSA 10 single is accepted", () => {
  assert.equal(
    classifyActiveListingReject("Pikachu 025/165 151 Pokemon TCG PSA 10", {
      ...pikachu,
      requestedGrade: "PSA 10",
    }),
    null,
  );
});
