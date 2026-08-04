import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTER_INTERVAL_MS,
  PROGRESS_INTERVAL_MS,
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

test("runs the default value at 20ms and progress at 100ms without leaking timers", () => {
  assert.equal(COUNTER_INTERVAL_MS, 20);
  assert.equal(PROGRESS_INTERVAL_MS, 100);

  const renders = [];
  const scheduled = [];
  const cancelled = [];
  let nextTimerId = 1;
  const ticker = createDecimalYearTicker({
    render: (parts) => renders.push(parts),
    schedule: (callback, intervalMs) => {
      const timer = { id: nextTimerId, callback, intervalMs };
      nextTimerId += 1;
      scheduled.push(timer);
      return timer.id;
    },
    cancel: (timerId) => cancelled.push(timerId),
  });

  ticker.sync({ hidden: false, reducedMotion: false });
  assert.deepEqual(renders, [{ value: true, progress: true }]);
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[0].intervalMs, COUNTER_INTERVAL_MS);
  assert.equal(scheduled[1].intervalMs, PROGRESS_INTERVAL_MS);

  for (let tick = 0; tick < 5; tick += 1) scheduled[0].callback();
  scheduled[1].callback();
  assert.deepEqual(renders.slice(1), [
    { value: true, progress: false },
    { value: true, progress: false },
    { value: true, progress: false },
    { value: true, progress: false },
    { value: true, progress: false },
    { value: false, progress: true },
  ]);

  ticker.sync({ hidden: false, reducedMotion: true });
  assert.deepEqual(cancelled, [1, 2]);
  assert.deepEqual(renders.at(-1), { value: true, progress: true });
  assert.equal(scheduled.length, 2);

  ticker.sync({ hidden: true, reducedMotion: false });
  assert.deepEqual(renders.at(-1), { value: true, progress: true });
  assert.equal(scheduled.length, 2);

  ticker.sync({ hidden: false, reducedMotion: false });
  assert.equal(scheduled.length, 4);
  assert.equal(scheduled[2].intervalMs, COUNTER_INTERVAL_MS);
  assert.equal(scheduled[3].intervalMs, PROGRESS_INTERVAL_MS);
  ticker.stop();
  ticker.stop();
  assert.deepEqual(cancelled, [1, 2, 3, 4]);
});

test("updates the complete progress group together when the two cadences cross a year", () => {
  const nextYearStart = new Date(2027, 0, 1).getTime();
  let nowMs = nextYearStart - 10;
  const state = { value: "", progress: undefined };
  const scheduled = [];
  const ticker = createDecimalYearTicker({
    render: ({ value, progress }) => {
      const snapshot = getDecimalYearSnapshot(new Date(nowMs));
      if (value) state.value = snapshot.value;
      if (progress) {
        state.progress = {
          currentYear: snapshot.currentYear,
          nextYear: snapshot.nextYear,
          percentage: snapshot.progressPercentage,
          fill: snapshot.progressPosition,
          markerStart: snapshot.progressPosition,
          markerEnd: snapshot.progressPosition,
        };
      }
    },
    schedule: (callback, intervalMs) => {
      scheduled.push({ callback, intervalMs });
      return scheduled.length;
    },
    cancel: () => {},
  });

  ticker.sync({ hidden: false, reducedMotion: false });
  assert.match(state.value, /^2026\./);
  assert.deepEqual(state.progress, {
    currentYear: "2026",
    nextYear: "2027",
    percentage: "99.9999999%",
    fill: "99.9999999",
    markerStart: "99.9999999",
    markerEnd: "99.9999999",
  });

  nowMs = nextYearStart + 10;
  scheduled.find(({ intervalMs }) => intervalMs === COUNTER_INTERVAL_MS).callback();
  assert.match(state.value, /^2027\./);
  assert.equal(state.progress.currentYear, "2026");

  scheduled.find(({ intervalMs }) => intervalMs === PROGRESS_INTERVAL_MS).callback();
  assert.deepEqual(state.progress, {
    currentYear: "2027",
    nextYear: "2028",
    percentage: "0.0000000%",
    fill: "0.0000000",
    markerStart: "0.0000000",
    markerEnd: "0.0000000",
  });
});
