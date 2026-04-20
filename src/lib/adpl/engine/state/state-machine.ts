import type { NodeStatus } from './types';
import { InvalidTransitionError } from './types';

export const VALID_TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  pending:   ['ready', 'skipped', 'cancelled'],
  ready:     ['running', 'cancelled'],
  running:   ['success', 'failure', 'cancelled', 'waiting'],
  waiting:   ['running', 'cancelled'],
  success:   [],
  failure:   ['ready'],
  cancelled: [],
  skipped:   [],
};

export function canTransition(from: NodeStatus, to: NodeStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function validateTransition(nodeId: string, from: NodeStatus, to: NodeStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to, nodeId);
  }
}

export function isTerminal(status: NodeStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0;
}

export function isActiveStatus(status: NodeStatus): boolean {
  return status === 'running' || status === 'waiting';
}
