import assert from "node:assert/strict";
import test from "node:test";
import { parseISO } from "date-fns";

import { calculateMonthlyInterest, calculateBookingDates } from "../actual-mortgage-interest.js";

test("calculateMonthlyInterest computes monthly interest", () => {
  const interest = calculateMonthlyInterest(100_000, 0.12); // 12% annual rate
  const expected = Math.round(100_000 * (0.12 / 365 * 30));
  assert.equal(interest, expected);
});

test("calculateBookingDates returns correct dates", () => {
  const cursor = parseISO("2024-05-01");
  const { bookDate, asOfDate } = calculateBookingDates(cursor, 25);
  assert.equal(bookDate.toISOString().slice(0, 10), "2024-05-25");
  assert.equal(asOfDate.toISOString().slice(0, 10), "2024-04-30");
});
