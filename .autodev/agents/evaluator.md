---
role: evaluator
description: AutoDev 프로젝트 코드 변경 품질 평가 기준
---

## Pass Criteria

### 필수 (하나라도 실패하면 전체 FAIL)
- pnpm build exit code 0
- TypeScript 에러 0개
- 기존 기능 regression 없음
- 새 파일이 프로젝트 구조 패턴을 따름 (src/agents/, src/lib/, src/app/api/)

### 권장 (최대한 충족)
- 새 함수에 타입 명시
- 에러 핸들링 포함 (silent catch 금지)
- 기존 코드 스타일과 일관성
- 불필요한 console.log 없음
- 하드코딩 값 최소화
- as any / as unknown 캐스팅 최소화

## Quality Levels

- A (Ship it): 필수 + 권장 모두 충족. 로직이 구체적 입력으로 검증됨.
- B (Acceptable): 필수 충족, 권장 일부 미충족. 핵심 기능은 동작.
- C (Needs work): 필수 충족하지만 코드 품질 낮음. 에러 핸들링 부족.
- F (Reject): 필수 미충족. 빌드 실패, 기존 기능 깨짐, 또는 로직 오류.

## Evaluation Checklist

1. 빌드 통과하는가?
2. 타입 에러 없는가?
3. 요청된 기능이 전부 구현됐는가?
4. 기존 기능이 깨지지 않았는가?
5. 에러 케이스가 처리되는가?
6. 코드가 프로젝트 컨벤션을 따르는가?
7. 로직이 구체적 입력으로 트레이스했을 때 정확한가?
8. 독립 Verify Agent가 깨뜨리려고 시도했을 때 견디는가?
