# Prompt Library

이 폴더에 .md 파일을 넣으면 자동으로 에이전트 프롬프트에 주입됩니다.

## 파일명 규칙

- `planning-*.md` → Planning Agent
- `coding-*.md` → Coding Agent
- `verify-*.md` → Verify Agent
- `*.md` (접두사 없음) → 모든 단계

## 예시

```
.autodev/prompts/planning-react-patterns.md
.autodev/prompts/coding-no-any.md
.autodev/prompts/verify-accessibility.md
.autodev/prompts/always-korean.md   ← 모든 단계에 주입
```

## frontmatter로 단계 지정

파일명 대신 frontmatter로 단계를 명시할 수 있습니다:

```markdown
---
stage: coding
---
TypeScript에서 any 타입을 절대 사용하지 마라.
unknown 또는 구체적인 타입을 사용해라.
```

## 글로벌 프롬프트

`~/.autodev/prompts/` 폴더에 넣으면 모든 프로젝트에 공통 적용됩니다.
