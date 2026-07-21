export interface JournalTextRect {
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface JournalTextLine {
  top: number;
  bottom: number;
}

export interface JournalCollapseMeasurement {
  lineCount: number;
  shouldCollapse: boolean;
  collapsedHeight: number;
  fadeHeight: number;
}

const MINIMUM_RECT_SIZE = 0.5;
const MINIMUM_VERTICAL_OVERLAP = 0.5;

/**
 * 把同一视觉行里的多个富文本片段合并，避免链接、加粗或行内代码被误算成多行。
 */
export const groupJournalTextRects = (
  rects: JournalTextRect[],
): JournalTextLine[] => {
  const visibleRects = rects
    .filter(
      ({ top, bottom, width, height }) =>
        [top, bottom, width, height].every(Number.isFinite) &&
        width > MINIMUM_RECT_SIZE &&
        height > MINIMUM_RECT_SIZE &&
        bottom > top,
    )
    .sort((left, right) => left.top - right.top || left.bottom - right.bottom);

  const lines: JournalTextLine[] = [];
  for (const rect of visibleRects) {
    const previous = lines.at(-1);
    const overlap = previous
      ? Math.min(previous.bottom, rect.bottom) - Math.max(previous.top, rect.top)
      : 0;
    if (previous && overlap > MINIMUM_VERTICAL_OVERLAP) {
      previous.top = Math.min(previous.top, rect.top);
      previous.bottom = Math.max(previous.bottom, rect.bottom);
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom });
    }
  }
  return lines;
};

/**
 * 仅在第四行及以后存在时折叠；裁切落在第三行底部，渐隐完整覆盖第三行。
 */
export const measureJournalTextCollapse = (
  rects: JournalTextRect[],
  containerTop: number,
  visibleLineCount = 3,
): JournalCollapseMeasurement => {
  const lines = groupJournalTextRects(rects);
  const fadeLine = lines[visibleLineCount - 1];
  const shouldCollapse = visibleLineCount > 0 && lines.length > visibleLineCount && !!fadeLine;
  if (!shouldCollapse || !fadeLine) {
    return {
      lineCount: lines.length,
      shouldCollapse: false,
      collapsedHeight: 0,
      fadeHeight: 0,
    };
  }

  return {
    lineCount: lines.length,
    shouldCollapse: true,
    collapsedHeight: Math.max(0, fadeLine.bottom - containerTop),
    fadeHeight: Math.max(0, fadeLine.bottom - fadeLine.top),
  };
};
