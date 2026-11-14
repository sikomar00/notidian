import type { PageRecord, RawLink, StoredText } from './types.ts';

/**
 * 토큰 없이 둘러보는 예시 워크스페이스(P2-7). 실제 노션과 상관없는 가짜 데이터이고 저장하지 않는다.
 * 그래프의 기능이 다 드러나게 짰다: 허브(팀 위키), DB 세 개(할 일·회의·자료), 읽을 수 없는 페이지, 연결 없는 페이지, 하위 페이지.
 */
export interface DemoData {
  pages: PageRecord[];
  links: RawLink[];
  databaseNames: Record<string, string>;
  /** 연결 안 된 언급을 보여 주려는 가짜 본문 */
  texts: StoredText[];
}

const PAGES: [id: string, title: string, database?: string, parent?: string][] = [
  ['wiki', '팀 위키'],
  ['onboarding', '온보딩 가이드', undefined, 'wiki'],
  ['plan', '프로젝트 A 기획', undefined, 'wiki'],
  ['design', '디자인 시스템', undefined, 'wiki'],
  ['api', 'API 명세', undefined, 'plan'],
  ['release', '릴리스 노트', undefined, 'plan'],
  ['roadmap', '로드맵 2027'],
  ['retro', '주간 회고'],
  ['interview', '고객 인터뷰 정리'],
  ['market', '경쟁사 분석'],
  ['hiring', '채용 계획'],
  ['metrics', '지표 대시보드'],
  ['memo', '메모'],
  ['task-login', '로그인 화면 만들기', 'db-tasks'],
  ['task-search', '검색 개선', 'db-tasks'],
  ['task-bug', '버그: 그래프 깜빡임', 'db-tasks'],
  ['task-docs', '문서 정리', 'db-tasks'],
  ['meet-1', '11월 1주 회의', 'db-meetings'],
  ['meet-2', '11월 2주 회의', 'db-meetings'],
  ['meet-design', '디자인 리뷰', 'db-meetings'],
  ['ref-links', '참고 링크 모음', 'db-refs'],
  ['ref-papers', '읽을거리', 'db-refs'],
];

const LINKS: [from: string, to: string][] = [
  ['wiki', 'onboarding'], ['wiki', 'plan'], ['wiki', 'design'], ['wiki', 'roadmap'], ['wiki', 'hiring'],
  ['onboarding', 'design'], ['onboarding', 'api'], ['onboarding', 'wiki'],
  ['plan', 'api'], ['plan', 'roadmap'], ['plan', 'interview'], ['plan', 'market'], ['plan', 'task-login'], ['plan', 'task-search'],
  ['roadmap', 'metrics'], ['roadmap', 'release'], ['release', 'task-bug'], ['release', 'api'],
  ['retro', 'meet-1'], ['retro', 'meet-2'], ['retro', 'task-bug'], ['retro', 'metrics'],
  ['meet-1', 'plan'], ['meet-1', 'task-login'], ['meet-2', 'task-search'], ['meet-2', 'roadmap'],
  ['meet-design', 'design'], ['meet-design', 'task-login'], ['design', 'ref-links'],
  ['interview', 'market'], ['interview', 'ref-papers'], ['market', 'ref-links'], ['market', 'locked'],
  ['task-docs', 'onboarding'], ['task-docs', 'api'], ['metrics', 'hiring'], ['hiring', 'locked'],
];

// "디자인 시스템"은 회고·회의에 글자로만 나오고(연결 안 된 언급), 디자인 리뷰는 이미 연결이 있어 빠진다. "메모"는 제목이 짧아 찾지 않는다
const TEXTS: [id: string, text: string][] = [
  ['retro', '이번 주에는 디자인 시스템의 버튼 색을 정리했다\n다음 주에도 디자인 시스템 문서를 이어서 본다'],
  ['meet-2', '참석: 기획·개발\n로그인 화면은 디자인 시스템 규칙을 따른다'],
  ['meet-design', '디자인 시스템 v2 검토'],
  ['hiring', '면접 과제는 API 명세를 읽고 질문을 만드는 것'],
  ['memo', '로드맵 2027을 다시 읽어 보기'],
];

export function demoData(): DemoData {
  const page = ([id, title, database, parent]: (typeof PAGES)[number]): PageRecord => ({
    id: `demo-${id}`,
    title,
    kind: database ? 'dbItem' : 'page',
    url: '',
    lastEdited: '2026-11-13T00:00:00.000Z',
    status: 'ok',
    failCount: 0,
    ...(database ? { databaseId: database } : {}),
    ...(parent ? { parentPageId: `demo-${parent}` } : {}),
  });
  const locked: PageRecord = { id: 'demo-locked', title: '', kind: 'page', url: '', lastEdited: '', status: 'unreadable', unreadableReason: 'forbidden', failCount: 0 };
  return {
    pages: [...PAGES.map(page), locked],
    links: LINKS.map(([from, to]) => ({ from: `demo-${from}`, to: `demo-${to}` })),
    databaseNames: { 'db-tasks': '할 일', 'db-meetings': '회의', 'db-refs': '자료' },
    texts: TEXTS.map(([id, text]) => ({ id: `demo-${id}`, text })),
  };
}
