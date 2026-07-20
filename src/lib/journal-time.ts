/** 读取 Intl 格式化结果中的指定字段；缺失表示运行环境不完整，应阻止发布。 */
const readPart = (
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string => {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) throw new Error(`流水账时间格式缺少 ${type} 字段`);
  return value;
};

/** 将完整时间解析成有效 Date，避免无效值在格式化或排序时悄悄变成 NaN。 */
const parseJournalTimestamp = (value: string): Date => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`流水账时间「${value}」格式无效`);
  return date;
};

/** 日期型值保持原日历日期；完整时间按指定时区返回可稳定排序的日期键。 */
export const readJournalCalendarDate = (value: string, timeZone: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parts = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parseJournalTimestamp(value));
  return `${readPart(parts, "year")}-${readPart(parts, "month")}-${readPart(parts, "day")}`;
};

/** 日期型值保持原日历日期，完整时间则明确转换到站点配置的时区。 */
export const formatJournalTimestamp = (
  value: string,
  locale: string,
  timeZone: string,
): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", ".");

  const parts = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parseJournalTimestamp(value));
  return `${readPart(parts, "year")}.${readPart(parts, "month")}.${readPart(parts, "day")} ${readPart(parts, "hour")}:${readPart(parts, "minute")}`;
};
