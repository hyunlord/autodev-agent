import { describe, it, expect } from 'vitest';
import { parseOutput, MAX_OUTPUT_BYTES } from '../output-parser';

function buf(s: string): Buffer {
  return Buffer.from(s, 'utf-8');
}

describe('parseOutput', () => {
  describe('text format', () => {
    it('trims whitespace', () => {
      expect(parseOutput(buf('  hello world\n  '), 'text')).toBe('hello world');
    });

    it('returns empty string for empty buffer', () => {
      expect(parseOutput(buf(''), 'text')).toBe('');
    });
  });

  describe('json format', () => {
    it('parses valid JSON object', () => {
      expect(parseOutput(buf('{"a":1,"b":"c"}'), 'json')).toEqual({ a: 1, b: 'c' });
    });

    it('parses JSON array', () => {
      expect(parseOutput(buf('[1,2,3]'), 'json')).toEqual([1, 2, 3]);
    });

    it('throws on invalid JSON', () => {
      expect(() => parseOutput(buf('not json'), 'json')).toThrow();
    });
  });

  describe('lines format', () => {
    it('splits by newline and filters empty lines', () => {
      expect(parseOutput(buf('a\nb\n\nc\n'), 'lines')).toEqual(['a', 'b', 'c']);
    });

    it('handles CRLF line endings', () => {
      expect(parseOutput(buf('a\r\nb\r\nc'), 'lines')).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array for empty buffer', () => {
      expect(parseOutput(buf(''), 'lines')).toEqual([]);
    });
  });

  describe('binary format', () => {
    it('returns base64 encoded data with size', () => {
      const data = Buffer.from([0x01, 0x02, 0x03]);
      const result = parseOutput(data, 'binary') as { encoding: string; data: string; size: number };
      expect(result.encoding).toBe('base64');
      expect(result.data).toBe(data.toString('base64'));
      expect(result.size).toBe(3);
    });
  });

  describe('auto format', () => {
    it('parses JSON when output is valid JSON', () => {
      expect(parseOutput(buf('{"key":"value"}'), 'auto')).toEqual({ key: 'value' });
    });

    it('falls back to text when output is not JSON', () => {
      expect(parseOutput(buf('hello world'), 'auto')).toBe('hello world');
    });

    it('returns empty string for empty output', () => {
      expect(parseOutput(buf(''), 'auto')).toBe('');
    });

    it('falls back to text for JSON-like but invalid', () => {
      expect(parseOutput(buf('{invalid}'), 'auto')).toBe('{invalid}');
    });
  });
});

describe('MAX_OUTPUT_BYTES', () => {
  it('is 10MB', () => {
    expect(MAX_OUTPUT_BYTES).toBe(10 * 1024 * 1024);
  });
});
