import type { NodeSpec } from '@/lib/adpl/types';
import type { ParsedPipeline } from './yaml-parser';

export interface FlatNode {
  pathId: string;
  userId: string;
  spec: NodeSpec;
  depth: number;
  parentFlowId: string | null;
  siblings: string[];
  children: string[];
}

export interface FlatExtractionResult {
  nodes: FlatNode[];
  rootNodes: string[];
  nodesByPath: Map<string, FlatNode>;
  userIdToPath: Map<string, string[]>;
}

export function extractFlat(pipeline: ParsedPipeline): FlatExtractionResult {
  const nodes: FlatNode[] = [];
  const nodesByPath = new Map<string, FlatNode>();
  const userIdToPath = new Map<string, string[]>();

  function walk(
    nodeList: NodeSpec[],
    parentPath: string,
    parentFlowId: string | null,
    depth: number,
  ): string[] {
    const pathIds: string[] = [];

    nodeList.forEach((node, index) => {
      const pathId = `${parentPath}.${index}`;
      pathIds.push(pathId);

      const childPaths: string[] = [];

      if (node.type === 'branch') {
        node.cases.forEach((caseBlock, caseIdx) => {
          const caseChildren = walk(
            caseBlock.then,
            `${pathId}.cases.${caseIdx}.then`,
            pathId,
            depth + 1,
          );
          childPaths.push(...caseChildren);
        });
      } else if (node.type === 'parallel') {
        node.branches.forEach((branch, branchIdx) => {
          const branchChildren = walk(
            branch.nodes,
            `${pathId}.branches.${branchIdx}.nodes`,
            pathId,
            depth + 1,
          );
          childPaths.push(...branchChildren);
        });
      } else if (node.type === 'loop') {
        const doChildren = walk(node.do, `${pathId}.do`, pathId, depth + 1);
        childPaths.push(...doChildren);
      }

      const flatNode: FlatNode = {
        pathId,
        userId: node.id,
        spec: node,
        depth,
        parentFlowId,
        siblings: [], // 채워질 예정 (아래에서)
        children: childPaths,
      };

      nodes.push(flatNode);
      nodesByPath.set(pathId, flatNode);

      const existing = userIdToPath.get(node.id) ?? [];
      existing.push(pathId);
      userIdToPath.set(node.id, existing);
    });

    // siblings 채우기 — 같은 레벨 모든 pathId 목록
    pathIds.forEach((path) => {
      const n = nodesByPath.get(path);
      if (n) {
        n.siblings = [...pathIds];
      }
    });

    return pathIds;
  }

  const rootNodes = walk(pipeline.raw.pipeline, 'pipeline', null, 0);

  return { nodes, rootNodes, nodesByPath, userIdToPath };
}
