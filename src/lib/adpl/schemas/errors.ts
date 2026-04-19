import { z } from 'zod';

export function setupKoreanErrorMap(): void {
  const errorMap: z.ZodErrorMap = (issue, ctx) => {
    switch (issue.code) {
      case z.ZodIssueCode.invalid_type:
        return {
          message: `타입이 올바르지 않습니다. 예상: ${issue.expected}, 실제: ${issue.received}`,
        };
      case z.ZodIssueCode.invalid_enum_value:
        return {
          message: `허용되지 않은 값입니다. 허용: ${(issue.options as string[]).join(', ')}`,
        };
      case z.ZodIssueCode.invalid_literal:
        return { message: `정확히 "${String(issue.expected)}" 값이어야 합니다` };
      case z.ZodIssueCode.unrecognized_keys:
        return { message: `인식할 수 없는 키: ${issue.keys.join(', ')}` };
      case z.ZodIssueCode.invalid_union_discriminator:
        return {
          message: `type 필드가 없거나 인식할 수 없는 type입니다. 허용: ${(issue.options as string[]).join(', ')}`,
        };
      case z.ZodIssueCode.too_small:
        return { message: `너무 작습니다. 최소: ${issue.minimum}` };
      case z.ZodIssueCode.too_big:
        return { message: `너무 큽니다. 최대: ${issue.maximum}` };
      default:
        return { message: ctx.defaultError };
    }
  };
  z.setErrorMap(errorMap);
}
