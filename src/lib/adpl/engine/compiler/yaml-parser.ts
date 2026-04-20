import * as yaml from 'js-yaml';
import type { AdplPipeline } from '@/lib/adpl/types';
import { AdplPipelineSchema } from '@/lib/adpl/schemas';

export interface ParsedPipeline {
  raw: AdplPipeline;
  sourceYaml: string;
  parsedAt: Date;
}

export class YamlParseError extends Error {
  constructor(
    message: string,
    public code: 'yaml_syntax' | 'schema_error' | 'empty_content',
    public sourcePath?: string,
    public zodIssues?: unknown,
  ) {
    super(message);
    this.name = 'YamlParseError';
  }
}

export async function parseYaml(input: {
  yaml: string;
  sourcePath?: string;
}): Promise<ParsedPipeline> {
  if (!input.yaml || input.yaml.trim() === '') {
    throw new YamlParseError('YAML 내용이 비어있습니다', 'empty_content', input.sourcePath);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(input.yaml);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new YamlParseError(`YAML 구문 오류: ${msg}`, 'yaml_syntax', input.sourcePath);
  }

  const result = AdplPipelineSchema.safeParse(parsed);
  if (!result.success) {
    throw new YamlParseError(
      '스키마 검증 실패',
      'schema_error',
      input.sourcePath,
      result.error.issues,
    );
  }

  return { raw: result.data, sourceYaml: input.yaml, parsedAt: new Date() };
}
