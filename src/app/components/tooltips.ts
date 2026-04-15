export const TOOLTIPS = {
  planningMode: {
    'claude-cli': 'Claude CLI가 구현 계획을 생성합니다. 가장 정확한 계획을 만들지만 크레딧이 필요합니다.',
    'gemini-cli': 'Google Gemini가 구현 계획을 생성합니다. 무료이고 빠르지만 계획 품질이 약간 낮을 수 있습니다.',
    'codex-cli': 'OpenAI Codex가 구현 계획을 생성합니다. 코드 중심의 상세한 계획을 만듭니다.',
    'api': 'Claude API를 직접 호출합니다. CLI가 없어도 사용 가능하며 API 키가 필요합니다.',
    'debate': '두 AI가 토론해서 더 좋은 계획을 만듭니다. Drafter가 초안, Challenger가 검토. 비용 2배, 품질 향상.',
    'manual': '직접 구현 계획을 작성합니다. 정확한 코딩 지시와 검증 체크리스트를 직접 제공합니다.',
  } as Record<string, string>,

  agent: {
    'auto': 'AutoDev가 비용 설정에 따라 최적의 에이전트를 자동 선택합니다.',
    'claude-code': 'Anthropic Claude Code. 가장 높은 코드 품질, 크레딧 필요.',
    'gemini-cli': 'Google Gemini CLI. 빠르고 무료, 디자인이 예쁨.',
    'codex-cli': 'OpenAI Codex CLI. 방어 코딩과 접근성 처리가 우수.',
    'aider': 'Aider — Git 기반 AI 페어 프로그래밍. diff 최적화.',
    'cline-cli': 'Cline CLI — 자동 파일 탐색과 컨텍스트 수집.',
  } as Record<string, string>,

  costPreference: {
    'cheap': 'Budget: 가장 저렴한 에이전트 우선. 간단한 작업에 적합.',
    'balanced': 'Balanced: 비용과 품질 균형. 대부분의 작업에 추천.',
    'quality': 'Quality: 최고 품질 에이전트 우선. 복잡하거나 중요한 작업에.',
  } as Record<string, string>,

  executionMode: {
    'single': 'Single: 한 번 실행 후 결과 확인. 검증 실패 시 수동 재시도.',
    'auto-cycle': 'Auto-cycle: 검증 실패 시 자동 재시도. 최대 N회까지 반복하며 피드백 반영.',
    'interview': 'Interview: 작업 시작 전 AI가 추가 질문. 모호한 요구사항을 명확하게.',
    'arena': 'Arena: 같은 작업을 여러 에이전트가 경쟁. 최고 결과를 자동 선택.',
  } as Record<string, string>,

  autoApprove: 'AI가 만든 계획을 자동으로 승인합니다. OFF면 계획을 직접 검토 후 승인/거부/수정할 수 있습니다.',

  verification: {
    'mechanical': '빌드 성공 여부, 필요한 파일 존재 여부를 자동으로 확인합니다. 항상 실행됩니다.',
    'browser': 'Playwright로 생성된 앱을 브라우저에서 열고 스크린샷을 캡처합니다.',
    'vlm': 'AI가 스크린샷을 보고 디자인 품질을 0-15점으로 채점합니다. 색상, 레이아웃, 완성도 평가.',
    'acceptance': 'Planning에서 정한 합격 기준을 자동으로 체크합니다. 특정 요소 존재, 동작 확인.',
    'sast': 'Semgrep으로 보안 취약점을 스캔합니다. SQL injection, XSS, 인증 우회 등 탐지.',
    'a11y': 'axe-core로 웹 접근성을 검사합니다. WCAG 2.2 AA 기준. 색상 대비, 키보드 탐색, aria 속성.',
    'llmReview': '다른 AI가 코드를 리뷰합니다. 코딩한 AI와 다른 모델이 리뷰하여 자기 합리화를 방지.',
    'propertyTest': 'AI가 불변 조건을 추출하고, fast-check로 수백 개의 랜덤 테스트를 자동 생성합니다.',
    'debate': '두 AI가 코드 품질에 대해 토론합니다. Primary가 리뷰, Challenger가 반박하여 정확도 향상.',
  } as Record<string, string>,
} as const;
