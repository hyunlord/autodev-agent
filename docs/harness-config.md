# Harness 자연어 설정 변경

"auto-approve 켜줘" 같은 자연어 요청을 구체 JSON/YAML 변경으로 매핑하는 가이드.

사용자가 harness 설정 변경을 요청하면 해당 `.autodev/` 파일을 직접 수정한다.

## MCP 설정 변경
요청 예시: "Planning에서 context7 빼줘", "Verification에 firecrawl 추가해줘"
→ `.autodev/mcp/config.json` 파일의 `pipeline_mapping` 수정
→ 파일이 없으면 생성 (기본값 기반)

```json
{
  "servers": {},
  "pipeline_mapping": {
    "planning": ["context7", "websearch"],
    "coding": ["codex"],
    "verification": ["playwright"]
  }
}
```

## 에이전트 프롬프트 변경
요청 예시: "planner에 React 규칙 추가해줘", "verifier에서 빈 파일 기준 100바이트로"
→ `.autodev/agents/{role}.md` 파일 수정
→ frontmatter(`---`) 유지, 본문만 수정

## 파이프라인 흐름 변경
요청 예시: "auto-approve 기본으로 켜줘", "retry 5번으로 늘려줘"
→ `.autodev/config.yaml` 생성/수정

```yaml
default_coding_agent: auto
default_planning_mode: claude-cli
auto_approve: true
max_retries: 5
```

## 규칙
- 변경 후 반드시 변경된 파일 내용을 보여줘서 확인
- JSON/YAML 문법 에러 없는지 확인
- 기존 설정 유지하면서 요청된 부분만 수정
- "리셋해줘" → 해당 `.autodev/` 파일 삭제 (코드 기본값으로 폴백)

> 이 가이드는 CLAUDE.md에서 분리됨 (2026-04-17 균형 슬리밍)
