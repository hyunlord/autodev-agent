import type { FlatExtractionResult } from './flat-extractor';

export interface NodeReference {
  targetUserId: string;
  location: { field: string; raw: string };
  resolution:
    | { kind: 'resolved'; targetPathId: string }
    | { kind: 'unknown_target' }
    | { kind: 'forward_reference'; targetPathId: string }
    | { kind: 'parallel_sibling'; targetPathId: string; ancestorParallel: string };
}

export interface NodeReferences {
  pathId: string;
  references: NodeReference[];
}

export interface ResolvedReferences {
  byNode: Map<string, NodeReferences>;
  errors: ReferenceError[];
}

export interface ReferenceError {
  pathId: string;
  reference: NodeReference;
  code: 'unknown_target' | 'forward_reference' | 'parallel_sibling';
  message: string;
}

export class RefResolverError extends Error {
  constructor(
    message: string,
    public errors: ReferenceError[],
  ) {
    super(message);
    this.name = 'RefResolverError';
  }
}

// 자식 NodeSpec 여부 판별 (id+type 둘 다 string → NodeSpec으로 간주)
// 컨테이너 노드 spec 순회 시 자식 노드 중복 감지를 방지한다.
function looksLikeNodeSpec(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj['id'] === 'string' && typeof obj['type'] === 'string';
}

function collectRefsFromValue(value: unknown, fieldPath: string[], out: NodeReference[]): void {
  if (typeof value === 'string') {
    const re = /\$nodes\.([\w-]+)|\$nodes\[["']([\w-]+)["']\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) {
      const target = m[1] ?? m[2];
      out.push({
        targetUserId: target,
        location: { field: fieldPath.join('.') || 'root', raw: value },
        resolution: { kind: 'unknown_target' },
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      if (looksLikeNodeSpec(v)) return; // 자식 NodeSpec은 별도 FlatNode로 처리됨
      collectRefsFromValue(v, [...fieldPath, String(i)], out);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectRefsFromValue(v, [...fieldPath, k], out);
    }
  }
}

function rootIdx(pathId: string): number {
  return Number(pathId.split('.')[1]);
}

// v1: top-level (pipeline.N) 경로 우선 선택
function pickTargetPath(candidates: string[]): string {
  const topLevel = candidates.filter((p) => p.split('.').length === 2);
  return topLevel.length > 0 ? topLevel[0] : candidates[0];
}

// v1 제약: top-level target만 forward ref 검사.
// nested target의 순서 검증은 B3-3/B3-4에서 엄격화.
function isForwardReference(currentPath: string, targetPath: string): boolean {
  if (targetPath.split('.').length !== 2) return false;
  return rootIdx(targetPath) >= rootIdx(currentPath);
}

// 가장 가까운 parallel 조상 pathId 반환 (없으면 null)
function findAncestorParallel(pathId: string): string | null {
  const segments = pathId.split('.');
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] === 'branches') {
      return segments.slice(0, i).join('.');
    }
  }
  return null;
}

// parallel 조상 내에서 몇 번째 branch인지 반환
function parallelBranchIndex(pathId: string, parallelPath: string): string | null {
  const rel = pathId.slice(parallelPath.length + 1);
  const match = /^branches\.(\d+)\./.exec(rel);
  return match ? match[1] : null;
}

function formatRefError(
  code: ReferenceError['code'],
  ctx: { pathId: string; ref: NodeReference },
): string {
  const { field } = ctx.ref.location;
  const { targetUserId: target } = ctx.ref;

  switch (code) {
    case 'unknown_target':
      return (
        `${ctx.pathId}: 알 수 없는 노드 참조 "$nodes.${target}" (${field}). ` +
        `해당 id 의 노드가 파이프라인에 없습니다.`
      );
    case 'forward_reference':
      return (
        `${ctx.pathId}: 앞으로의 노드 참조 금지 "$nodes.${target}" (${field}). ` +
        `ADPL 은 forward reference 를 허용하지 않습니다. ` +
        `참조되는 노드 "${target}" 를 이 노드 이전에 배치하세요.`
      );
    case 'parallel_sibling':
      return (
        `${ctx.pathId}: 같은 parallel 내 형제 branch 참조 금지 ` +
        `"$nodes.${target}" (${field}). ` +
        `각 branch 는 독립 실행되므로 서로 참조할 수 없습니다. ` +
        `parallel 이전 노드를 참조하거나 병렬 실행이 아닌 순차 실행으로 변경하세요.`
      );
  }
}

export function resolveReferences(extraction: FlatExtractionResult): ResolvedReferences {
  const byNode = new Map<string, NodeReferences>();
  const errors: ReferenceError[] = [];

  for (const node of extraction.nodes) {
    const references: NodeReference[] = [];
    collectRefsFromValue(node.spec, [], references);

    for (const ref of references) {
      const targetPaths = extraction.userIdToPath.get(ref.targetUserId) ?? [];

      if (targetPaths.length === 0) {
        ref.resolution = { kind: 'unknown_target' };
        errors.push({
          pathId: node.pathId,
          reference: ref,
          code: 'unknown_target',
          message: formatRefError('unknown_target', { pathId: node.pathId, ref }),
        });
        continue;
      }

      const targetPath = pickTargetPath(targetPaths);

      if (isForwardReference(node.pathId, targetPath)) {
        ref.resolution = { kind: 'forward_reference', targetPathId: targetPath };
        errors.push({
          pathId: node.pathId,
          reference: ref,
          code: 'forward_reference',
          message: formatRefError('forward_reference', { pathId: node.pathId, ref }),
        });
        continue;
      }

      const currentParallel = findAncestorParallel(node.pathId);
      const targetParallel = findAncestorParallel(targetPath);

      if (
        currentParallel !== null &&
        targetParallel !== null &&
        currentParallel === targetParallel
      ) {
        const currentBranch = parallelBranchIndex(node.pathId, currentParallel);
        const targetBranch = parallelBranchIndex(targetPath, targetParallel);

        if (currentBranch !== null && targetBranch !== null && currentBranch !== targetBranch) {
          ref.resolution = {
            kind: 'parallel_sibling',
            targetPathId: targetPath,
            ancestorParallel: currentParallel,
          };
          errors.push({
            pathId: node.pathId,
            reference: ref,
            code: 'parallel_sibling',
            message: formatRefError('parallel_sibling', { pathId: node.pathId, ref }),
          });
          continue;
        }
      }

      ref.resolution = { kind: 'resolved', targetPathId: targetPath };
    }

    byNode.set(node.pathId, { pathId: node.pathId, references });
  }

  return { byNode, errors };
}
