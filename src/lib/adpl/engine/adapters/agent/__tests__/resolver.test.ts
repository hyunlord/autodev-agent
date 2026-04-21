import { describe, it, expect } from 'vitest';
import {
  resolveBackend,
  AgentValidationError,
} from '../resolver';

describe('resolveBackend', () => {
  it('returns auto-cross-model backend for verifier + undefined model', () => {
    const backend = resolveBackend('verifier', undefined);
    expect(backend.id).toBe('auto-cross-model');
  });

  it('returns codex-cli backend for verifier + codex-cli', () => {
    const backend = resolveBackend('verifier', 'codex-cli');
    expect(backend.id).toBe('codex-cli');
  });

  it('throws AgentValidationError for invalid verifier model', () => {
    expect(() => resolveBackend('verifier', 'autodev-internal')).toThrow(AgentValidationError);
  });

  it('throws AgentValidationError for unsupported role', () => {
    expect(() => resolveBackend('evaluator', undefined)).toThrow(AgentValidationError);
  });

  it('throws AgentValidationError for invalid model', () => {
    expect(() => resolveBackend('planner', 'invalid-model')).toThrow(AgentValidationError);
  });

  it('returns autodev-internal backend for planner + autodev-internal', () => {
    const backend = resolveBackend('planner', 'autodev-internal');
    expect(backend.id).toBe('autodev-internal');
  });

  it('returns codex-cli backend for coder + codex-cli', () => {
    const backend = resolveBackend('coder', 'codex-cli');
    expect(backend.id).toBe('codex-cli');
  });

  it('returns autodev-internal backend when role and model are undefined (defaults)', () => {
    const backend = resolveBackend(undefined, undefined);
    expect(backend.id).toBe('autodev-internal');
  });

  it('returns gemini-cli backend for planner + gemini-cli', () => {
    const backend = resolveBackend('planner', 'gemini-cli');
    expect(backend.id).toBe('gemini-cli');
  });
});
