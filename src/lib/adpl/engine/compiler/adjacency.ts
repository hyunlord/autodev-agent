import type { FlatExtractionResult, FlatNode } from './flat-extractor';
import type { ResolvedReferences } from './ref-resolver';

export interface AdjacencyGraph {
  /** prereq pathId → dependent pathIds */
  forward: Map<string, Set<string>>;
  /** dependent pathId → prereq pathIds */
  reverse: Map<string, Set<string>>;
  /** 모든 노드 pathIds (순회 편의) */
  allNodes: string[];
}

// 순차 prereq: 같은 siblings 배열에서 바로 앞 노드.
// 첫 번째 노드(index=0)는 parentFlowId 를 prereq 로 삼는다.
// (parallel/loop/branch 내부 첫 노드는 컨테이너 노드 완료 후 시작)
// top-level 첫 노드(parentFlowId=null)는 prereq 없음.
function getSequentialPrereq(node: FlatNode): string | null {
  const myIndex = node.siblings.indexOf(node.pathId);
  if (myIndex > 0) return node.siblings[myIndex - 1];
  return node.parentFlowId; // null if top-level first node
}

function getReferencePrereqs(pathId: string, resolved: ResolvedReferences): string[] {
  const refs = resolved.byNode.get(pathId);
  if (!refs) return [];
  return refs.references
    .filter((r) => r.resolution.kind === 'resolved')
    .map((r) => (r.resolution as { kind: 'resolved'; targetPathId: string }).targetPathId);
}

export function buildAdjacency(
  extraction: FlatExtractionResult,
  resolved: ResolvedReferences,
): AdjacencyGraph {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();

  for (const node of extraction.nodes) {
    forward.set(node.pathId, new Set());
    reverse.set(node.pathId, new Set());
  }

  function addEdge(prereq: string, dependent: string): void {
    if (prereq === dependent) return;
    forward.get(prereq)?.add(dependent);
    reverse.get(dependent)?.add(prereq);
  }

  for (const node of extraction.nodes) {
    // 1. 순차 의존 (siblings 기반)
    const seqPrereq = getSequentialPrereq(node);
    if (seqPrereq) addEdge(seqPrereq, node.pathId);

    // 2. 참조 의존 (resolved $nodes.X 에서)
    // v2: `after` 배열 지원 예정 — 여기서 추가하면 됨
    for (const prereq of getReferencePrereqs(node.pathId, resolved)) {
      addEdge(prereq, node.pathId);
    }
  }

  return { forward, reverse, allNodes: extraction.nodes.map((n) => n.pathId) };
}
