'use client';

import { useEffect, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import 'highlight.js/styles/github-dark.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  maxHeight?: number;
  className?: string;
}

export function CodeBlock({ code, language, showLineNumbers = true, maxHeight = 500, className }: CodeBlockProps) {
  const codeRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!codeRef.current) return;
    const codeEls = codeRef.current.querySelectorAll('code[data-highlight]');
    codeEls.forEach(el => {
      // Reset previous highlighting
      el.removeAttribute('data-highlighted');
      hljs.highlightElement(el as HTMLElement);
    });
  }, [code, language]);

  const lines = code.split('\n');
  // Remove trailing empty line
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  const lang = language ?? 'plaintext';

  return (
    <div className={`overflow-hidden rounded-lg ${className ?? ''}`} style={{ background: '#0d1117' }}>
      <pre
        ref={codeRef}
        className="text-xs font-mono p-0 m-0 overflow-auto"
        style={{ maxHeight }}
      >
        {lines.map((line, i) => (
          <div key={i} className="flex hover:bg-gray-800/40 leading-5">
            {showLineNumbers && (
              <span className="w-10 text-right pr-3 select-none border-r flex-shrink-0" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}>
                {i + 1}
              </span>
            )}
            <code
              data-highlight
              className={`pl-3 language-${lang} flex-1`}
              style={{ background: 'transparent' }}
            >
              {line || ' '}
            </code>
          </div>
        ))}
      </pre>
    </div>
  );
}

/** Highlight a single line of code and return the HTML string */
export function highlightLine(text: string, language?: string): string {
  if (!language || language === 'plaintext') return escapeHtml(text);
  try {
    const result = hljs.highlight(text, { language, ignoreIllegals: true });
    return result.value;
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
