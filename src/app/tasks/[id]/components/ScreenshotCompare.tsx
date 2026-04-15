'use client';

import { useState, useRef, useCallback } from 'react';

interface ScreenshotCompareProps {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  height?: number;
}

export function ScreenshotCompare({
  beforeUrl,
  afterUrl,
  beforeLabel = 'Before',
  afterLabel = 'After',
  height = 400,
}: ScreenshotCompareProps) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.max(0, Math.min(100, x)));
  }, []);

  const onMouseDown = useCallback(() => {
    const onMove = (e: MouseEvent) => handleMove(e.clientX);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [handleMove]);

  const onTouchStart = useCallback(() => {
    const onMove = (e: TouchEvent) => {
      if (e.touches[0]) handleMove(e.touches[0].clientX);
    };
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);
  }, [handleMove]);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-lg border border-gray-800 select-none"
      style={{ height }}
    >
      {/* After image (full background) */}
      <img
        src={afterUrl}
        alt={afterLabel}
        className="absolute inset-0 w-full h-full object-contain bg-gray-950"
        draggable={false}
      />

      {/* Before image (clipped) */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img
          src={beforeUrl}
          alt={beforeLabel}
          className="w-full h-full object-contain bg-gray-950"
          draggable={false}
        />
      </div>

      {/* Slider handle */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-indigo-500 cursor-col-resize z-10"
        style={{ left: `${position}%` }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs shadow-lg shadow-indigo-500/30">
          ↔
        </div>
      </div>

      {/* Labels */}
      <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-black/70 text-white z-10">
        {beforeLabel}
      </span>
      <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded bg-black/70 text-white z-10">
        {afterLabel}
      </span>
    </div>
  );
}
