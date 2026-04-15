'use client';

import { useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  type Node,
  type Edge,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

interface SubTaskNode {
  id: string;
  description: string;
  files: string[];
  agent?: string;
  dependsOn?: string[];
  status?: 'pending' | 'running' | 'done' | 'failed';
}

interface DagViewProps {
  subTasks: SubTaskNode[];
  currentSubTaskId?: string;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  pending: { bg: '#1f2937', border: '#374151', text: '#9ca3af' },
  running: { bg: '#1e3a5f', border: '#3b82f6', text: '#60a5fa' },
  done: { bg: '#14532d', border: '#22c55e', text: '#4ade80' },
  failed: { bg: '#450a0a', border: '#ef4444', text: '#f87171' },
};

function getLayoutedElements(subTasks: SubTaskNode[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40 });

  const nodes: Node[] = subTasks.map(task => {
    g.setNode(task.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    const colors = STATUS_COLORS[task.status ?? 'pending'];
    return {
      id: task.id,
      position: { x: 0, y: 0 },
      data: { label: task.description.slice(0, 40) },
      style: {
        width: NODE_WIDTH,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        padding: '12px',
        color: colors.text,
        fontSize: '12px',
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });

  const edges: Edge[] = [];
  for (const task of subTasks) {
    for (const dep of task.dependsOn ?? []) {
      g.setEdge(dep, task.id);
      edges.push({
        id: `${dep}-${task.id}`,
        source: dep,
        target: task.id,
        animated: task.status === 'running',
        style: { stroke: '#4b5563', strokeWidth: 1.5 },
      });
    }
  }

  dagre.layout(g);

  for (const node of nodes) {
    const pos = g.node(node.id);
    node.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
  }

  return { nodes, edges };
}

export default function DagView({ subTasks }: DagViewProps) {
  const { nodes, edges } = useMemo(() => getLayoutedElements(subTasks), [subTasks]);

  if (subTasks.length === 0) {
    return (
      <div className="text-center text-gray-500 text-sm py-12">
        No sub-tasks in this plan (single task mode)
      </div>
    );
  }

  return (
    <div className="w-full h-[400px] rounded-lg overflow-hidden border border-gray-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
      >
        <Controls
          className="!bg-gray-900 !border-gray-700 !shadow-none [&>button]:!bg-gray-800 [&>button]:!border-gray-700 [&>button]:!text-gray-400 [&>button:hover]:!bg-gray-700"
        />
        <Background color="#374151" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
