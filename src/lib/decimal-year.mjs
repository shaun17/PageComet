export const FULL_DECIMAL_PLACES = 18;
export const PROGRESS_DECIMAL_PLACES = 7;
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

/** 按指定精度计算比例数字，统一年度进度的 BigInt 截断规则。 */
const formatFractionDigits = (numerator, denominator, decimalPlaces) => {
  const scale = 10n ** BigInt(decimalPlaces);
  return ((numerator * scale) / denominator)
    .toString()
    .padStart(decimalPlaces, "0");
};

/** 按指定精度格式化百分比，使用 BigInt 截断避免浮点数在边界处越界。 */
const formatPercentage = (numerator, denominator, decimalPlaces) => {
  const decimalScale = 10n ** BigInt(decimalPlaces);
  const scaledPercentage = (numerator * 100n * decimalScale) / denominator;
  const whole = scaledPercentage / decimalScale;
  const decimal = (scaledPercentage % decimalScale)
    .toString()
    .padStart(decimalPlaces, "0");
  return `${whole}.${decimal}%`;
};

/**
 * 生成同一时刻的年度倒计时快照，保证静态态、进度轨道和无障碍文案使用同一组年份。
 * 可见百分比保留七位小数，足以在 100ms 刷新周期内持续产生可见变化。
 */
export const getDecimalYearSnapshot = (
  date,
  decimalPlaces = FULL_DECIMAL_PLACES,
) => {
  const places = normalizeDecimalPlaces(decimalPlaces);
  const { year, start, end } = getLocalYearRange(date);
  const elapsed = BigInt(date.getTime() - start);
  const duration = BigInt(end - start);
  const fraction = places === 0
    ? ""
    : `.${formatFractionDigits(elapsed, duration, places)}`;
  const progressPercentage = formatPercentage(
    elapsed,
    duration,
    PROGRESS_DECIMAL_PLACES,
  );
  const accessibleProgressPercentage = formatPercentage(elapsed, duration, 2);
  const currentYear = String(year);
  const nextYear = String(year + 1);

  return {
    currentYear,
    nextYear,
    value: `${currentYear}${fraction}.${nextYear}`,
    progressPercentage,
    progressPosition: progressPercentage.slice(0, -1),
    label: `${currentYear} 年已过去 ${accessibleProgressPercentage}，正在倒计时至 ${nextYear} 年`,
  };
};

/**
 * 管理数字刷新周期；外部注入调度器，便于验证后台暂停和减少动态行为。
 * @param {{
 *   render: () => void,
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
    render();

    if (!hidden && !reducedMotion) {
      timerId = schedule(render, intervalMs);
    }
  };

  return { stop, sync };
};
