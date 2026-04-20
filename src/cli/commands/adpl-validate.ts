import { glob } from 'node:fs/promises';
import { AdplPipelineSchema } from '@/lib/adpl/schemas';
import type { z } from 'zod';
import { readYamlFile } from '../utils/file-reader';
import { formatError } from '../utils/error-formatter';
import { colors } from '../utils/output';
import type { FormattedError } from '../utils/error-formatter';

type AdplPipeline = z.infer<typeof AdplPipelineSchema>;

interface PipelineMetrics {
  adplVersion: number;
  pipelineName: string;
  triggerCount: number;
  triggerTypes: string[];
  nodeCount: number;
  nodeTypes: Record<string, number>;
  hasSettings: boolean;
}

export interface ValidationResult {
  path: string;
  valid: boolean;
  fileError?: string;
  errors?: FormattedError[];
  data?: AdplPipeline;
  metrics?: PipelineMetrics;
  elapsed?: number;
}

export interface ValidateOptions {
  format: 'pretty' | 'json';
  quiet: boolean;
}

function computeMetrics(pipeline: AdplPipeline): PipelineMetrics {
  const nodeTypes: Record<string, number> = {};
  for (const node of pipeline.pipeline) {
    nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
  }
  return {
    adplVersion: pipeline.adplVersion,
    pipelineName: pipeline.name,
    triggerCount: pipeline.triggers?.length ?? 0,
    triggerTypes: (pipeline.triggers ?? []).map((t) => t.type),
    nodeCount: pipeline.pipeline.length,
    nodeTypes,
    hasSettings: pipeline.settings !== undefined,
  };
}

export async function validateFile(filePath: string): Promise<ValidationResult> {
  const start = Date.now();
  const readResult = readYamlFile(filePath);

  if (!readResult.ok) {
    return {
      path: readResult.absPath,
      valid: false,
      fileError: readResult.error,
      elapsed: Date.now() - start,
    };
  }

  const parseResult = AdplPipelineSchema.safeParse(readResult.data);
  const elapsed = Date.now() - start;

  if (parseResult.success) {
    return {
      path: readResult.absPath,
      valid: true,
      data: parseResult.data,
      metrics: computeMetrics(parseResult.data),
      elapsed,
    };
  }
  return {
    path: readResult.absPath,
    valid: false,
    errors: parseResult.error.issues.map(formatError),
    elapsed,
  };
}

function printSingle(r: ValidationResult, quiet: boolean): void {
  if (quiet) return;

  if (r.fileError) {
    console.log(`${colors.error('✗')} ${r.path}\n`);
    console.log(`에러: ${r.fileError}`);
    console.log(`경로: ${r.path}`);
    console.log('');
    console.log(colors.dim('(exit code: 2)'));
    return;
  }

  if (r.valid && r.metrics) {
    const m = r.metrics;
    const nodeTypeStr = Object.entries(m.nodeTypes)
      .map(([t, n]) => `${t} × ${n}`)
      .join(', ');
    const triggerStr =
      m.triggerCount > 0 ? `${m.triggerCount}개 (${m.triggerTypes.join(', ')})` : '없음';
    console.log(`${colors.success('✓')} ${r.path} ${colors.success('유효합니다')}\n`);
    console.log(`  ADPL 버전: ${m.adplVersion}.0`);
    console.log(`  파이프라인 이름: ${m.pipelineName}`);
    console.log(`  트리거: ${triggerStr}`);
    console.log(`  노드: ${m.nodeCount}개 (${nodeTypeStr})`);
    console.log(`  설정: ${m.hasSettings ? '있음' : '없음'}`);
    console.log('');
    console.log(colors.dim(`검증 완료 (소요: ${r.elapsed ?? 0}ms)`));
    return;
  }

  const errors = r.errors ?? [];
  console.log(`${colors.error('✗')} ${r.path} ${colors.error('유효하지 않습니다')}\n`);

  if (errors.length === 1) {
    const e = errors[0];
    console.log(`위치: ${colors.warn(e.path)}`);
    console.log(`원인: ${e.message}`);
    console.log(
      `현재 값: ${e.currentValue !== undefined ? colors.dim(JSON.stringify(e.currentValue)) : colors.dim('(누락)')}`,
    );
    if (e.suggestion) console.log(`수정 제안: ${e.suggestion}`);
  } else {
    console.log(`에러 ${errors.length}개 발견:\n`);
    errors.forEach((e, idx) => {
      console.log(`  ${idx + 1}. 위치: ${colors.warn(e.path)}`);
      console.log(`     원인: ${e.message}`);
      console.log(
        `     현재 값: ${e.currentValue !== undefined ? colors.dim(JSON.stringify(e.currentValue)) : colors.dim('(누락)')}`,
      );
      if (e.suggestion) console.log(`     수정 제안: ${e.suggestion}`);
      if (idx < errors.length - 1) console.log('');
    });
  }
  console.log('');
  console.log(colors.error(`검증 실패 (${errors.length}개 에러)`));
}

function printMulti(results: ValidationResult[], quiet: boolean): void {
  if (quiet) return;
  const total = results.length;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const prefix = `[${i + 1}/${total}]`;
    if (r.fileError) {
      console.log(`${prefix} ${colors.error('✗')} ${r.path} ${colors.error(`(${r.fileError})`)}`);
    } else if (r.valid) {
      console.log(`${prefix} ${colors.success('✓')} ${r.path}`);
    } else {
      const cnt = r.errors?.length ?? 0;
      console.log(`${prefix} ${colors.error('✗')} ${r.path} ${colors.dim(`(${cnt} errors)`)}`);
    }
  }
  console.log('');
  const validCount = results.filter((r) => r.valid).length;
  const invalidCount = results.length - validCount;
  const validStr = colors.success(`${validCount} valid`);
  const invalidStr =
    invalidCount > 0 ? colors.error(`${invalidCount} invalid`) : `${invalidCount} invalid`;
  console.log(`결과: ${validStr}, ${invalidStr}`);
}

async function expandGlobs(patterns: string[]): Promise<string[]> {
  const expanded: string[] = [];
  for (const p of patterns) {
    if (p.includes('*') || p.includes('?') || p.includes('{')) {
      const matches: string[] = [];
      for await (const m of glob(p)) matches.push(m);
      // 매칭 없으면 원본 패턴 유지 — validateFile 이 "파일 없음" 에러를 표시
      expanded.push(...(matches.length > 0 ? matches.sort() : [p]));
    } else {
      expanded.push(p);
    }
  }
  return expanded;
}

export async function validateCommand(paths: string[], options: ValidateOptions): Promise<void> {
  const expanded = await expandGlobs(paths);
  const results = await Promise.all(expanded.map(validateFile));
  const multi = expanded.length > 1;

  if (options.format === 'json') {
    const validCount = results.filter((r) => r.valid).length;
    const invalidCount = results.length - validCount;
    console.log(JSON.stringify({ results, summary: { validCount, invalidCount } }, null, 2));
  } else if (multi) {
    printMulti(results, options.quiet);
  } else {
    printSingle(results[0], options.quiet);
  }

  if (results.some((r) => Boolean(r.fileError))) process.exit(2);
  if (results.some((r) => !r.valid)) process.exit(1);
  process.exit(0);
}
