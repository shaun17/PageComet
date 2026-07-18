import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTER_INTERVAL_MS,
  createDecimalYearTicker,
  formatDecimalYear,
  formatYearProgressLabel,
} from "../src/lib/decimal-year.mjs";

test("formats exact decimal-year boundaries without floating-point drift", () => {
  const yearStart = new Date(2026, 0, 1).getTime();
  const nextYearStart = new Date(2027, 0, 1).getTime();
  const halfYear = new Date(yearStart + (nextYearStart - yearStart) / 2);

  assert.equal(
    formatDecimalYear(new Date(yearStart)),
    "2026.000000000000000000",
  );
  assert.equal(
    formatDecimalYear(halfYear),
    "2026.500000000000000000",
  );
  assert.equal(
    formatDecimalYear(halfYear, 2),
    "2026.50",
  );
});

test("describes decimal-year progress in a stable accessible label", () => {
  const yearStart = new Date(2026, 0, 1).getTime();
  const nextYearStart = new Date(2027, 0, 1).getTime();
  const halfYear = new Date(yearStart + (nextYearStart - yearStart) / 2);

  assert.equal(
    formatYearProgressLabel(halfYear),
    "2026 年已过去 50.00%",
  );
});

test("runs only while visible and motion is allowed", () => {
  const renders = [];
  const scheduled = [];
  const cancelled = [];
  let nextTimerId = 1;
  const ticker = createDecimalYearTicker({
    render: (decimalPlaces) => renders.push(decimalPlaces),
    schedule: (callback, intervalMs) => {
      const timer = { id: nextTimerId, callback, intervalMs };
      nextTimerId += 1;
      scheduled.push(timer);
      return timer.id;
    },
    cancel: (timerId) => cancelled.push(timerId),
  });

  ticker.sync({ hidden: false, reducedMotion: false });
  assert.deepEqual(renders, [18]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].intervalMs, COUNTER_INTERVAL_MS);
  scheduled[0].callback();
  assert.deepEqual(renders, [18, 18]);

  ticker.sync({ hidden: false, reducedMotion: true });
  assert.deepEqual(cancelled, [1]);
  assert.deepEqual(renders, [18, 18, 2]);
  assert.equal(scheduled.length, 1);

  ticker.sync({ hidden: true, reducedMotion: false });
  assert.deepEqual(renders, [18, 18, 2, 18]);
  assert.equal(scheduled.length, 1);

  ticker.sync({ hidden: false, reducedMotion: false });
  assert.equal(scheduled.length, 2);
  ticker.stop();
  assert.deepEqual(cancelled, [1, 2]);
});
