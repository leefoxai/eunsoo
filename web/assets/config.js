// 앱 설정 — Supabase 프로젝트를 만든 뒤 아래 두 값을 채우세요(README 3단계).
// 두 값이 비어 있으면 「미리보기 모드」로 동작합니다: 기록은 이 브라우저에만 남고, AI 코치는 대본 문장으로 답합니다.
window.APP_CONFIG = {
  // Supabase → Project Settings → API → Project URL   예) https://abcdefghijkl.supabase.co
  SUPABASE_URL: '',
  // Supabase → Project Settings → API Keys → Publishable key(또는 anon public key)
  // 브라우저에 공개되도록 만든 키입니다. service_role / secret 키는 절대 넣지 마세요.
  SUPABASE_KEY: '',
  // AI 코치 서버 함수를 서울 리전에서 실행(연구계획서 19번: Supabase 서울 → Anthropic)
  FUNCTION_REGION: 'ap-northeast-2',
  // 화면 아래에 표시할 연구자 문의처(연구계획서 19번 (1)). 예) '연구책임자 이메일 ○○○@yonsei.ac.kr'
  RESEARCHER_CONTACT: '',
};
