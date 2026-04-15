'use client';

import { useState, useRef } from 'react';

interface TooltipProps {
  text: string;
  children?: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

const POSITION_CLASSES = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

const ARROW_CLASSES = {
  top: 'top-full -translate-y-1 left-1/2 -translate-x-1/2',
  bottom: 'bottom-full translate-y-1 left-1/2 -translate-x-1/2',
  left: 'left-full -translate-x-1 top-1/2 -translate-y-1/2',
  right: 'right-full translate-x-1 top-1/2 -translate-y-1/2',
};

export default function Tooltip({ text, children, position = 'top' }: TooltipProps) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className="relative inline-flex items-center" ref={ref}>
      <div
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onTouchStart={() => setShow(true)}
        onTouchEnd={() => setShow(false)}
        className="cursor-help"
      >
        {children ?? (
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-medium"
            style={{
              background: 'var(--bg-secondary, #1f2937)',
              color: 'var(--text-secondary, #9ca3af)',
              border: '1px solid var(--border-color, #374151)',
            }}
          >
            ?
          </span>
        )}
      </div>
      {show && (
        <div
          className={`absolute z-50 ${POSITION_CLASSES[position]} w-64 px-3 py-2 rounded-lg shadow-xl text-xs leading-relaxed pointer-events-none`}
          style={{
            background: 'var(--bg-card, #1f2937)',
            color: 'var(--text-primary, #e5e7eb)',
            border: '1px solid var(--border-color, #374151)',
          }}
        >
          {text}
          <div
            className={`absolute w-2 h-2 rotate-45 ${ARROW_CLASSES[position]}`}
            style={{
              background: 'var(--bg-card, #1f2937)',
              borderRight: position === 'left' ? '1px solid var(--border-color, #374151)' : 'none',
              borderBottom: position === 'top' ? '1px solid var(--border-color, #374151)' : 'none',
              borderLeft: position === 'right' ? '1px solid var(--border-color, #374151)' : 'none',
              borderTop: position === 'bottom' ? '1px solid var(--border-color, #374151)' : 'none',
            }}
          />
        </div>
      )}
    </div>
  );
}
