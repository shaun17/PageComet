export const FULL_DECIMAL_PLACES = 18;
export const REDUCED_DECIMAL_PLACES = 2;
export const COUNTER_INTERVAL_MS = 100;

/** 校验日期并返回访客本地年份的起止毫秒，使数字与当前日历年份一致。 */
const getLocalYearRange = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("十进制年份需要有效日期");
  }

  const year = date.getFullYear();
  return {
    year,
    start: new Date(year, 0, 1).getTime(),
    end: new Date(year + 1, 0, 1).getTime(),
  };
};

/** 校验展示精度，避免异常参数触发过大的 BigInt 运算。 */
const normalizeDecimalPlaces = (decimalPlaces) => {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 18) {
    throw new RangeError("十进制年份精度必须是 0 到 18 之间的整数");
  }
  return decimalPlaces;
};

/** 将时间转换为十进制年份；BigInt 保证末尾数字稳定递增而非浮点抖动。 */
export const formatDecimalYear = (date, decimalPlaces = FULL_DECIMAL_PLACES) => {
  const places = normalizeDecimalPlaces(decimalPlaces);
  const { year, start, end } = getLocalYearRange(date);
  if (places === 0) return String(year);

  const scale = 10n ** BigInt(places);
  const elapsed = BigInt(date.getTime() - start);
  const duration = BigInt(end - start);
  const fraction = ((elapsed * scale) / duration).toString().padStart(places, "0");
  return `${year}.${fraction}`;
};

/** 为读屏器生成稳定且易懂的年度进度，不朗读持续跳动的长数字。 */
export const formatYearProgressLabel = (date) => {
  const { year, start, end } = getLocalYearRange(date);
  const elapsed = BigInt(date.getTime() - start);
  const duration = BigInt(end - start);
  const percentageHundredths = (elapsed * 10_000n) / duration;
  const whole = percentageHundredths / 100n;
  const decimal = (percentageHundredths % 100n).toString().padStart(2, "0");
  return `${year} 年已过去 ${whole}.${decimal}%`;
};

/**
 * 管理数字刷新周期；外部注入调度器，便于验证后台暂停和减少动态行为。
 * @param {{
 *   render: (decimalPlaces: number) => void,
 *   schedule: (callback: () => void, intervalMs: number) => unknown,
 *   cancel: (timerId: unknown) => void,
 *   intervalMs?: number,
 * }} options
 */
export const createDecimalYearTicker = ({
  render,
  schedule,
  cancel,
  intervalMs = COUNTER_INTERVAL_MS,
}) => {
  let timerId;

  /** 清除当前刷新任务，重复调用不会产生额外副作用。 */
  const stop = () => {
    if (timerId !== undefined) cancel(timerId);
    timerId = undefined;
  };

  /** 立即渲染一次，并仅在页面可见且允许动态时持续刷新。 */
  const sync = ({ hidden, reducedMotion }) => {
    stop();
    const decimalPlaces = reducedMotion
      ? REDUCED_DECIMAL_PLACES
      : FULL_DECIMAL_PLACES;
    render(decimalPlaces);

    if (!hidden && !reducedMotion) {
      timerId = schedule(() => render(FULL_DECIMAL_PLACES), intervalMs);
    }
  };

  return { stop, sync };
};
