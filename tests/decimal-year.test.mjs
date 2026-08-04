import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTER_INTERVAL_MS,
  createDecimalYearTicker,
  getDecimalYearSnapshot,
} from "../src/lib/decimal-year.mjs";

test("formats the current year, dynamic next year, and precise visual progress", () => {
  const yearStart = new Date(2026, 0, 1).getTime();
  const nextYearStart = new Date(2027, 0, 1).getTime();
  const halfYear = new Date(yearStart + (nextYearStart - yearStart) / 2);

  const startSnapshot = getDecimalYearSnapshot(new Date(yearStart));
  assert.equal(startSnapshot.value, "2026.000000000000000000.2027");
  assert.equal(startSnapshot.progressPercentage, "0.0000000%");
  assert.equal(startSnapshot.progressPosition, "0.0000000");

  const halfSnapshot = getDecimalYearSnapshot(halfYear);
  assert.equal(halfSnapshot.value, "2026.500000000000000000.2027");
  assert.equal(halfSnapshot.progressPercentage, "50.0000000%");
  assert.equal(halfSnapshot.progressPosition, "50.0000000");
  assert.equal(halfSnapshot.value.length, 28);
  assert.equal(getDecimalYearSnapshot(halfYear, 2).value, "2026.50.2027");

  const firstTick = getDecimalYearSnapshot(new Date(yearStart + 123_456_789));
  const secondTick = getDecimalYearSnapshot(new Date(yearStart + 123_456_889));
  assert.match(firstTick.progressPercentage, /^\d{1,2}\.\d{7}%$/);
  assert.match(secondTick.progressPercentage, /^\d{1,2}\.\d{7}%$/);
  assert.notEqual(firstTick.progressPercentage, secondTick.progressPercentage);
  assert.ok(Number.parseFloat(secondTick.progressPosition) > Number.parseFloat(firstTick.progressPosition));
  assert.equal(`${secondTick.progressPosition}%`, secondTick.progressPercentage);
});

test("keeps the dynamic target correct across year boundaries and leap years", () => {
  const yearStart = new Date(2026, 0, 1).getTime();
  const nextYearStart = new Date(2027, 0, 1).getTime();
  const duration = BigInt(nextYearStart - yearStart);
  const finalMillisecond = new Date(nextYearStart - 1);
  const finalFraction =
    (((duration - 1n) * 10n ** 18n) / duration)
      .toString()
      .padStart(18, "0");

  const finalSnapshot = getDecimalYearSnapshot(finalMillisecond);
  assert.equal(finalSnapshot.value, `2026.${finalFraction}.2027`);
  assert.equal(finalSnapshot.progressPercentage, "99.9999999%");
  assert.equal(finalSnapshot.progressPosition, "99.9999999");

  const nextYearSnapshot = getDecimalYearSnapshot(new Date(nextYearStart));
  assert.equal(nextYearSnapshot.value, "2027.000000000000000000.2028");
  assert.equal(nextYearSnapshot.progressPercentage, "0.0000000%");
  assert.equal(nextYearSnapshot.progressPosition, "0.0000000");
  assert.equal(nextYearSnapshot.currentYear, "2027");
  assert.equal(nextYearSnapshot.nextYear, "2028");

  const leapYearStart = new Date(2028, 0, 1).getTime();
  const nextLeapYearStart = new Date(2029, 0, 1).getTime();
  const leapYearHalfway = new Date(
    leapYearStart + (nextLeapYearStart - leapYearStart) / 2,
  );
  assert.equal(
    getDecimalYearSnapshot(leapYearHalfway).value,
    "2028.500000000000000000.2029",
  );
  assert.notEqual(
    getDecimalYearSnapshot(leapYearHalfway).progressPercentage,
    getDecimalYearSnapshot(new Date(leapYearHalfway.getTime() + 100)).progressPercentage,
  );
  assert.throws(() => getDecimalYearSnapshot(new Date(Number.NaN)), TypeError);
  assert.throws(() => getDecimalYearSnapshot(new Date(), 19), RangeError);
});

test("describes the annual countdown in one stable accessible label", () => {
  const yearStart = new Date(2026, 0, 1).getTime();
  const nextYearStart = new Date(2027, 0, 1).getTime();
  const halfYear = new Date(yearStart + (nextYearStart - yearStart) / 2);

  assert.equal(
    getDecimalYearSnapshot(halfYear).label,
    "2026 年已过去 50.00%，正在倒计时至 2027 年",
  );
});

test("runs only while visible and motion is allowed", () => {
  assert.equal(COUNTER_INTERVAL_MS, 100);

  const renders = [];
  const scheduled = [];
  const cancelled = [];
  let nextTimerId = 1;
  const ticker = createDecimalYearTicker({
    render: () => renders.push("render"),
    schedule: (callback, intervalMs) => {
      const timer = { id: nextTimerId, callback, intervalMs };
      nextTimerId += 1;
      scheduled.push(timer);
      return timer.id;
    },
    cancel: (timerId) => cancelled.push(timerId),
  });

  ticker.sync({ hidden: false, reducedMotion: false });
  assert.deepEqual(renders, ["render"]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].intervalMs, COUNTER_INTERVAL_MS);
  scheduled[0].callback();
  assert.deepEqual(renders, ["render", "render"]);

  ticker.sync({ hidden: false, reducedMotion: true });
  assert.deepEqual(cancelled, [1]);
  assert.deepEqual(renders, ["render", "render", "render"]);
  assert.equal(scheduled.length, 1);

  ticker.sync({ hidden: true, reducedMotion: false });
  assert.deepEqual(renders, ["render", "render", "render", "render"]);
  assert.equal(scheduled.length, 1);

  ticker.sync({ hidden: false, reducedMotion: false });
  assert.equal(scheduled.length, 2);
  ticker.stop();
  assert.deepEqual(cancelled, [1, 2]);
});
