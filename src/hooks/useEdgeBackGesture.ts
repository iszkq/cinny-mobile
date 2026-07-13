import { TouchEvent, useRef } from 'react';

type GestureStart = { x: number; y: number; at: number };

// 仅从左侧边缘开始识别，避免与时间线的正常滚动和媒体手势发生冲突。
export const useEdgeBackGesture = (onBack: () => void) => {
  const start = useRef<GestureStart>();

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    const point = event.touches[0];
    if (!point || point.clientX > 26) {
      start.current = undefined;
      return;
    }
    start.current = { x: point.clientX, y: point.clientY, at: Date.now() };
  };

  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const gesture = start.current;
    start.current = undefined;
    const point = event.changedTouches[0];
    if (!gesture || !point) return;

    const deltaX = point.clientX - gesture.x;
    const deltaY = Math.abs(point.clientY - gesture.y);
    const elapsed = Date.now() - gesture.at;
    if (deltaX >= 84 && deltaX > deltaY * 1.5 && elapsed < 800) onBack();
  };

  return { onTouchStart, onTouchEnd };
};
