'use client';

import { useRef, useState, useEffect } from 'react';

interface Props {
  chart: string;
}

export default function MermaidDiagram({ chart }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!ref.current || rendered) return;
    import('mermaid').then(mermaid => {
      mermaid.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#6366f1',
          primaryTextColor: '#e5e7eb',
          primaryBorderColor: '#4f46e5',
          lineColor: '#4b5563',
          secondaryColor: '#1e1b4b',
          tertiaryColor: '#1f2937',
          fontSize: '13px',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          nodeBkg: '#1f2937',
          nodeTextColor: '#e5e7eb',
          nodeBorder: '#4b5563',
          edgeLabelBackground: '#111827',
          clusterBkg: '#111827',
          clusterBorder: '#374151',
        },
      });
      mermaid.default.run({ nodes: [ref.current!] });
      setRendered(true);
    });
  }, [chart, rendered]);

  return (
    <div className="rounded-lg overflow-hidden">
      <div ref={ref} className="mermaid text-sm overflow-x-auto">{chart}</div>
    </div>
  );
}
