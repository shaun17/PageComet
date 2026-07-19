import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTER_INTERVAL_MS,
  createDecimalYearTicker,
  formatDecimalYear,
  formatRemainingYear,
  formatYearProgressLabel,
  formatYearRemainingLabel,
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
  assert.equal(
    formatRemainingYear(new Date(yearStart)),
    "1000000000000000000.2027",
  );
  assert.equal(
    formatRemainingYear(halfYear),
    "500000000000000000.2027",
  );
  assert.equal(
    formatRemainingYear(halfYear, 2),
    "50.2027",
  );
});

test("keeps the remaining-year countdown correct across year boundaries and leap years", () => {
  const yearStart = new Date(2026, 0, 1).getTime();
  const nextYearStart = new Date(2027, 0, 1).getTime();
  const duration = BigInt(nextYearStart - yearStart);
  const finalMillisecond = new Date(nextYearStart - 1);
  const finalFraction = (10n ** 18n / duration).toString().padStart(18, "0");

  assert.equal(formatRemainingYear(finalMillisecond), `${finalFraction}.2027`);
  assert.equal(
    formatRemainingYear(new Date(nextYearStart)),
    "1000000000000000000.2028",
  );

  const leapYearStart = new Date(2028, 0, 1).getTime();
  const nextLeapYearStart = new Date(2029, 0, 1).getTime();
  const leapYearHalfway = new Date(
    leapYearStart + (nextLeapYearStart - leapYearStart) / 2,
  );
  assert.equal(
    formatRemainingYear(leapYearHalfway),
    "500000000000000000.2029",
  );
  assert.throws(() => formatRemainingYear(new Date(Number.NaN)), TypeError);
});

test("describes decimal-year progress in a stable accessible label", () => {
  const yearStart = new Date(2026, 0, 1).getTime();
  const nextYearStart = new Date(2027, 0, 1).getTime();
  const halfYear = new Date(yearStart + (nextYearStart - yearStart) / 2);

  assert.equal(
    formatYearProgressLabel(halfYear),
    "2026 年已过去 50.00%",
  );
  assert.equal(
    formatYearRemainingLabel(halfYear),
    "距离 2027 年还有 50.00%",
  );
});

test("runs only while visible and motion is allowed", () => {
  assert.equal(COUNTER_INTERVAL_MS, 20);

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
