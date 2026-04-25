import yaml from 'js-yaml';
import { AdplPipelineSchema } from '@/lib/adpl/schemas';

export function validateYaml(content: string): {
  ok: boolean;
  error?: string;
  parsed?: unknown;
} {
  if (!content.trim()) {
    return { ok: false, error: 'YAML 파싱 실패: 내용이 비어 있습니다' };
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (e) {
    return { ok: false, error: `YAML 파싱 실패: ${(e as Error).message}` };
  }
  const result = AdplPipelineSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: `ADPL 스키마 일치 실패: ${result.error.issues[0]?.message}`,
    };
  }
  return { ok: true, parsed: result.data };
}
