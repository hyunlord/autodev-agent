import { describe, it, expect } from 'vitest';
import {
  canTransition,
  validateTransition,
  isTerminal,
  isActiveStatus,
  VALID_TRANSITIONS,
} from '../state-machine';
import { InvalidTransitionError } from '../types';

describe('VALID_TRANSITIONS', () => {
  it('covers all 8 NodeStatus values', () => {
    const statuses = ['pending', 'ready', 'running', 'success', 'failure', 'cancelled', 'skipped', 'waiting'];
    for (const s of statuses) {
      expect(VALID_TRANSITIONS).toHaveProperty(s);
    }
  });
});

describe('canTransition', () => {
  it('pending → ready: valid', () => {
    expect(canTransition('pending', 'ready')).toBe(true);
  });

  it('pending → skipped: valid', () => {
    expect(canTransition('pending', 'skipped')).toBe(true);
  });

  it('pending → cancelled: valid', () => {
    expect(canTransition('pending', 'cancelled')).toBe(true);
  });

  it('pending → running: invalid (must go through ready)', () => {
    expect(canTransition('pending', 'running')).toBe(false);
  });

  it('ready → running: valid', () => {
    expect(canTransition('ready', 'running')).toBe(true);
  });

  it('ready → cancelled: valid', () => {
    expect(canTransition('ready', 'cancelled')).toBe(true);
  });

  it('running → success: valid', () => {
    expect(canTransition('running', 'success')).toBe(true);
  });

  it('running → failure: valid', () => {
    expect(canTransition('running', 'failure')).toBe(true);
  });

  it('running → cancelled: valid', () => {
    expect(canTransition('running', 'cancelled')).toBe(true);
  });

  it('running → waiting: valid (gate)', () => {
    expect(canTransition('running', 'waiting')).toBe(true);
  });

  it('waiting → running: valid (gate resume)', () => {
    expect(canTransition('waiting', 'running')).toBe(true);
  });

  it('waiting → cancelled: valid', () => {
    expect(canTransition('waiting', 'cancelled')).toBe(true);
  });

  it('failure → ready: valid (retry)', () => {
    expect(canTransition('failure', 'ready')).toBe(true);
  });

  it('failure → success: invalid (must retry first)', () => {
    expect(canTransition('failure', 'success')).toBe(false);
  });

  it('success → anything: invalid (terminal)', () => {
    expect(canTransition('success', 'ready')).toBe(false);
    expect(canTransition('success', 'running')).toBe(false);
    expect(canTransition('success', 'failure')).toBe(false);
  });

  it('cancelled → anything: invalid (terminal)', () => {
    expect(canTransition('cancelled', 'pending')).toBe(false);
    expect(canTransition('cancelled', 'running')).toBe(false);
  });

  it('skipped → anything: invalid (terminal)', () => {
    expect(canTransition('skipped', 'pending')).toBe(false);
    expect(canTransition('skipped', 'ready')).toBe(false);
  });
});

describe('validateTransition', () => {
  it('valid transition: no throw', () => {
    expect(() => validateTransition('n1', 'pending', 'ready')).not.toThrow();
    expect(() => validateTransition('n1', 'ready', 'running')).not.toThrow();
    expect(() => validateTransition('n1', 'running', 'success')).not.toThrow();
  });

  it('invalid transition: throws InvalidTransitionError', () => {
    expect(() => validateTransition('n1', 'success', 'ready')).toThrow(InvalidTransitionError);
    expect(() => validateTransition('n1', 'pending', 'success')).toThrow(InvalidTransitionError);
  });

  it('error message includes nodeId, from, and to', () => {
    try {
      validateTransition('my-node', 'pending', 'success');
      expect.fail('should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const e = err as InvalidTransitionError;
      expect(e.message).toContain('my-node');
      expect(e.message).toContain('pending');
      expect(e.message).toContain('success');
      expect(e.from).toBe('pending');
      expect(e.to).toBe('success');
      expect(e.nodeId).toBe('my-node');
    }
  });
});

describe('isTerminal', () => {
  it('success, cancelled, skipped are terminal', () => {
    expect(isTerminal('success')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('skipped')).toBe(true);
  });

  it('pending, ready, running, failure, waiting are not terminal', () => {
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('ready')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('failure')).toBe(false);
    expect(isTerminal('waiting')).toBe(false);
  });
});

describe('isActiveStatus', () => {
  it('running and waiting are active', () => {
    expect(isActiveStatus('running')).toBe(true);
    expect(isActiveStatus('waiting')).toBe(true);
  });

  it('other statuses are not active', () => {
    expect(isActiveStatus('pending')).toBe(false);
    expect(isActiveStatus('ready')).toBe(false);
    expect(isActiveStatus('success')).toBe(false);
    expect(isActiveStatus('failure')).toBe(false);
    expect(isActiveStatus('cancelled')).toBe(false);
    expect(isActiveStatus('skipped')).toBe(false);
  });
});
