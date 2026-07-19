const PORTRAIT_IMAGE_MIN_ASPECT_RATIO = 4 / 3;

/** 根据图片实际宽高判断是否应使用竖图版式，无效或未知尺寸保持普通版式。 */
export const isPortraitImageDimensions = (
  width: number | undefined,
  height: number | undefined,
): boolean => {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return false;
  return height / width >= PORTRAIT_IMAGE_MIN_ASPECT_RATIO;
};
