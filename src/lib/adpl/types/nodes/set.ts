import type { NodeSpecBase } from '../common';
import type { Expression } from '../expression';

export interface SetNodeSpec extends NodeSpecBase {
  type: 'set';
  values: Record<string, Expression>; // { key: Slot1Expression }
}
