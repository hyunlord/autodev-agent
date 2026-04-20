import type { AdjacencyGraph } from './adjacency';

export interface CycleError {
  code: 'cycle_detected';
  cycleNodes: string[];
  message: string;
}

export interface CycleDetectionResult {
  hasCycle: boolean;
  /** Cycle 없음: 의존성 순 정렬. Cycle 있음: 빈 배열. */
  topologicalOrder: string[];
  cycleNodes: string[];
  error: CycleError | null;
}

function formatCycleError(cycleNodes: string[]): string {
  const list = cycleNodes.map((p) => `"${p}"`).join(' → ');
  return (
    `순환 의존성 감지: 노드들 ${list} 가 서로 참조하여 cycle 을 형성합니다. ` +
    `각 노드가 다른 노드의 결과에 의존하고 있어 실행 순서를 결정할 수 없습니다.`
  );
}

/** Kahn's algorithm — O(V+E) */
export function detectCycle(graph: AdjacencyGraph): CycleDetectionResult {
  const inDegree = new Map<string, number>();
  for (const node of graph.allNodes) {
    inDegree.set(node, graph.reverse.get(node)?.size ?? 0);
  }

  const queue: string[] = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const dep of graph.forward.get(current) ?? []) {
      const newDeg = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  if (sorted.length === graph.allNodes.length) {
    return { hasCycle: false, topologicalOrder: sorted, cycleNodes: [], error: null };
  }

  // in-degree > 0 인 노드들 = cycle 에 속한 노드 집합
  // v1: 전체 cycle path 추적 없음 — v1.5에서 개선
  const cycleNodes = graph.allNodes.filter((n) => (inDegree.get(n) ?? 0) > 0);
  return {
    hasCycle: true,
    topologicalOrder: [],
    cycleNodes,
    error: { code: 'cycle_detected', cycleNodes, message: formatCycleError(cycleNodes) },
  };
}
