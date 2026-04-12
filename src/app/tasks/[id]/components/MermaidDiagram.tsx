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
          primaryColor: '#7c3aed',
          primaryTextColor: '#fff',
          lineColor: '#6b7280',
          secondaryColor: '#1f2937',
        },
      });
      mermaid.default.run({ nodes: [ref.current!] });
      setRendered(true);
    });
  }, [chart, rendered]);

  return <div ref={ref} className="mermaid text-sm overflow-x-auto">{chart}</div>;
}
