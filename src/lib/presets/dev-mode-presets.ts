export interface DevModePreset {
  id: string;
  name: string;
  description: string;
  techStack: string[];
  planningHints: string;    // Planning Agent에 추가할 힌트
  codingHints: string;      // Coding Agent에 추가할 힌트
  verifyHints: string;      // Verify Agent에 추가할 힌트
}

export const DEV_MODE_PRESETS: DevModePreset[] = [
  {
    id: 'web-frontend',
    name: 'Web Frontend',
    description: 'HTML/CSS/JS, React, Vue, Next.js 등 웹 프론트엔드',
    techStack: ['HTML', 'CSS', 'JavaScript', 'React', 'Vue', 'Next.js'],
    planningHints: '반응형 디자인을 고려해라. 접근성(a11y)을 신경 써라. 브라우저 호환성을 확인해라. 세련된 시각 디자인을 포함해라 — 색상 팔레트, 타이포그래피, 간격, 그림자, 둥근 모서리, 호버 효과를 구체적으로 지정해라.',
    codingHints: '시맨틱 HTML 사용. CSS는 모바일 퍼스트. 이벤트 핸들러에 에러 처리. XSS 방지를 위해 textContent 사용. 모든 UI 요소에 의도적인 스타일링 필수 — 기본 브라우저 스타일 금지. 일관된 색상 스킴, 적절한 간격, 부드러운 트랜지션 적용.',
    verifyHints: 'Playwright로 실제 렌더링 확인. 콘솔 에러 0건. 반응형은 사용자가 명시적으로 요청한 경우에만 검증. 시각적 완성도 확인: 기본 브라우저 스타일만 사용한 요소가 있으면 이슈로 보고.',
  },
  {
    id: 'api-backend',
    name: 'API Backend',
    description: 'REST API, GraphQL, Express, FastAPI 등 백엔드',
    techStack: ['Node.js', 'Express', 'Python', 'FastAPI', 'REST', 'GraphQL'],
    planningHints: 'API 엔드포인트 목록을 명확히 정의해라. 에러 응답 형식을 통일해라. 인증/인가를 고려해라.',
    codingHints: '입력 검증 필수. 에러 핸들링 미들웨어. HTTP 상태 코드 정확히. 환경 변수로 설정.',
    verifyHints: 'curl로 각 엔드포인트 호출. 에러 케이스 테스트 (잘못된 입력, 인증 없음). 응답 형식 일관성.',
  },
  {
    id: 'fullstack',
    name: 'Full Stack',
    description: '프론트엔드 + 백엔드 통합',
    techStack: ['Next.js', 'React', 'Node.js', 'Database'],
    planningHints: '프론트/백 분리 구조. API 인터페이스 먼저 정의. DB 스키마 설계 포함.',
    codingHints: '타입을 프론트/백에서 공유. API 호출에 에러 핸들링. 로딩/에러 상태 UI. 프론트엔드 UI는 시각적으로 완성된 상태여야 함 — 기본 스타일 금지.',
    verifyHints: '프론트엔드 렌더링 + API 응답 모두 확인. E2E 흐름 검증. UI 시각적 완성도 확인.',
  },
  {
    id: 'cli-tool',
    name: 'CLI Tool',
    description: '커맨드라인 도구, 스크립트',
    techStack: ['Node.js', 'Python', 'Bash', 'Commander.js', 'argparse'],
    planningHints: '--help 출력을 먼저 설계. 종료 코드를 정의. stdin/stdout/stderr 용도를 구분.',
    codingHints: 'argument parsing 라이브러리 사용. 에러 시 stderr + exit 1. 진행 표시. --verbose 옵션.',
    verifyHints: '다양한 인자 조합으로 실행. --help 출력 확인. 에러 케이스 (잘못된 인자, 파일 없음).',
  },
  {
    id: 'game',
    name: 'Game',
    description: '브라우저 게임, Canvas, WebGL',
    techStack: ['HTML5 Canvas', 'JavaScript', 'WebGL', 'CSS Animation'],
    planningHints: '게임 루프 구조를 명확히. 승패/점수 로직을 수식으로 정의. 상태 관리 (시작/진행/종료).',
    codingHints: '게임 로직을 구체적 입력으로 트레이스. requestAnimationFrame 사용. 키보드/마우스 이벤트. 상태 머신. 게임 UI는 시각적으로 몰입감 있게 — 배경, 색상, 애니메이션 포함.',
    verifyHints: '승패 로직을 모든 경우의 수로 검증. 리셋이 모든 상태를 초기화하는지. 점수가 정확한지.',
  },
  {
    id: 'mobile',
    name: 'Mobile App',
    description: 'React Native, Flutter, 모바일 웹',
    techStack: ['React Native', 'Flutter', 'PWA', 'Mobile Web'],
    planningHints: '터치 인터랙션 우선. 오프라인 동작 고려. 화면 크기 대응.',
    codingHints: '터치 타겟 최소 44px. 스크롤 성능. 네트워크 상태 처리. 모바일 네이티브 느낌의 UI — 부드러운 트랜지션, 적절한 간격, 시스템 폰트.',
    verifyHints: '모바일 뷰포트에서 렌더링. 터치 이벤트 동작. 오프라인 모드.',
  },
];

export function getPresetById(id: string): DevModePreset | undefined {
  return DEV_MODE_PRESETS.find(p => p.id === id);
}

export function detectPresetFromProject(projectConfig: any): DevModePreset | undefined {
  if (!projectConfig) return undefined;
  const type = projectConfig.type ?? '';
  if (type.includes('next') || type.includes('react') || type.includes('vue')) return getPresetById('web-frontend');
  if (type.includes('express') || type.includes('fastapi')) return getPresetById('api-backend');
  if (type === 'static-html') return getPresetById('web-frontend');
  return undefined;
}
