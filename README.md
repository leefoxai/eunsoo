# 21일 프로그램 — D16·D17 시연

초등교사 사회정서역량 21일 프로그램 중 3주차 **D16 겹겹 케이크**와 **D17 공감적 호기심**의 시연용 웹앱입니다.
「돌아보기」의 AI 코치는 실제 Claude API에 연결되고, 기록은 Supabase(서울)에 참여번호로만 저장됩니다.

```
휴대폰 브라우저 ──(정적 화면)── Vercel
       │
       └─(로그인·기록·AI 요청)── Supabase · 서울 ap-northeast-2
                                   ├ DB: 참여번호·세션 시작/완료·기록·AI 대화 로그
                                   └ coach 함수 ──► Anthropic Claude API(미국)
```

Vercel은 화면 파일만 내려 줍니다. 참여자가 입력한 내용은 Vercel을 거치지 않고 Supabase(서울)로 가며, AI 응답을 만들 때만 Anthropic으로 전송됩니다. 연구계획서 19번에 고지된 경로(Supabase 서울 → Anthropic)와 같습니다.

## 폴더

| 경로 | 내용 |
|---|---|
| `web/` | 배포되는 화면. `index.html`(참여번호 로그인·별칭), `d16.html`, `d17.html`, `assets/` |
| `web/assets/config.js` | Supabase 주소·공개 키·연구자 문의처. **비어 있으면 미리보기 모드** |
| `supabase/migrations/` | DB 스키마·RLS·RPC(한 파일) |
| `supabase/functions/coach/` | AI 코치 서버 함수(지침 다섯 겹) |
| `tests/` | SQL·코치 로직·화면 흐름 테스트 |

## 설정 순서

### 1. Supabase 프로젝트 만들기
- **Region: Northeast Asia (Seoul)** — 만든 뒤에는 바꿀 수 없습니다.
- 플랜: **Free 권장.** Free는 자동 백업이 없어 계획서 11번의 "자동 백업 기능을 사용하지 않는 구성" 서술과 맞습니다. Pro는 일일 백업(7일 보관)이 기본 포함됩니다.
- Free 프로젝트는 **1주일 동안 요청이 없으면 일시정지**됩니다. 시연 전에 대시보드에서 상태를 확인하세요.

### 2. DB 만들기
대시보드 → **SQL Editor** → `supabase/migrations/20261020000000_init.sql` 전체를 붙여 넣고 **Run**.

### 3. 익명 로그인 켜기
대시보드 → **Authentication → Sign In / Providers → Allow anonymous sign-ins** 켜기.
참여번호 로그인은 "익명 세션 + 참여번호·접속 코드 확인" 방식입니다(이메일·이름 없음).

### 4. 참여번호 발급
SQL Editor에서:
```sql
select public.create_participant('DEMO01', '접속코드8자이상', 'demo');   -- 시연용
select public.create_participant('EXP01',  '다른접속코드99', 'expert'); -- 연구 1 전문가 검토용
```
참여번호와 사람을 잇는 매칭키는 앱 밖에서 따로 보관합니다(계획서 19번).

### 5. AI 코치 함수 배포
[Supabase CLI](https://supabase.com/docs/guides/cli)로 배포합니다(Node가 있으면 `npx`로 바로 실행 가능).
```bash
npx supabase login
npx supabase link --project-ref <프로젝트 ref>          # 대시보드 주소의 /project/<ref>
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy coach --no-verify-jwt     # 토큰은 함수 안에서 직접 확인
```
선택 비밀값:
- `ANTHROPIC_MODEL` — 기본 `claude-sonnet-5-5`(고정 스냅샷 ID)
- `ALLOWED_ORIGINS` — 예: `https://eunsoo.vercel.app` (설정하면 그 주소에서만 호출 허용)
- `COACH_TIMEOUT_MS` — 기본 8000

### 6. 화면 설정
`web/assets/config.js`에 채우고 커밋·푸시합니다.
- `SUPABASE_URL` — Project Settings → API → Project URL
- `SUPABASE_KEY` — **Publishable key**(또는 anon public key). 브라우저에 공개되도록 만든 키입니다. `service_role`/secret 키는 절대 넣지 않습니다.
- `RESEARCHER_CONTACT` — 화면 아래 연구자 문의처

### 7. Vercel 연결
Vercel → **Add New → Project → Import `leefoxai/eunsoo`** → Framework Preset **Other** → Deploy.
빌드 단계는 없고, `vercel.json`이 `web/` 폴더를 그대로 배포합니다. 이후 `main`에 푸시하면 자동 재배포됩니다.

### 8. 확인
배포 주소 → 참여번호 로그인 → 별칭 저장 → D16 → D17.
- `?debug=1`: AI 메시지에 출처 표시 — `llm`(모델 응답) · `fallback`(규칙 위반·지연으로 대본 문장 대체) · `fixed`(건너뛰기·재질문) · `crisis`(위기 안내문)
- `?fast=1` 또는 첫 화면 체크박스: 숨 고르기 각 단계 4초

## 시연 팁
- D17은 **가장 최근 D16에서 ‘모름’으로 둔 층**을 불러옵니다. D16을 안 했으면 예시 키워드와 함께 그 사실을 표시합니다.
- 시연 계정 초기화: `select public.reset_participant('DEMO01');`
- `config.js`가 비어 있으면 **미리보기 모드**(기록은 그 브라우저에만, AI는 대본 문장). Supabase 없이 화면만 보여 줄 때 씁니다.
- 서버 함수에 닿지 못하면 화면이 시제품의 대본 문장으로 이어 갑니다(시연이 멈추지 않음).

## 연구자 점검(주 1회 · 계획서 Ⅲ-4.3)
SQL Editor에서(`research` 스키마는 API에 노출되지 않습니다):
```sql
select * from research.coach_log;    -- 참여번호·일차·턴·입력·출력·대체 여부·위반 항목·플래그·신고 여부
select * from research.reports;      -- 「부적절한 응답 신고」
select * from research.session_log;  -- 세션 시작·완료 시각·소요(분)
```
위험 표현 사전은 **Table Editor → `crisis_terms`** 에서 관리합니다. 들어 있는 목록은 **초안이니 검토·보완이 필요합니다.**

## AI 코치 ↔ 「LLM 연결 지침」 대응

| 지침 | 구현 |
|---|---|
| ① 시스템 프롬프트(고정) | `prompt.ts` `SYSTEM_PROMPT` — 2절 원문 그대로, 매 호출 `system`에 포함 |
| ② 일차별 지침 | `prompt.ts` `DAYS` — 질문 세트(순서 고정)·인정 문장·요약 필수 요소·오늘만의 금지 |
| ③ 턴별 컨텍스트 | 3절 형식 블록(일차·별칭·현재 턴·질문 세트·오늘의 기록·금지) + 그날 대화 이력. 기록은 DB에서 서버가 직접 읽음 |
| ④ 안전장치(LLM 바깥) | `crisis_terms`에 걸리면 **LLM 미호출**, 고정 안내문(계획서 표 3 ④), 플래그. 위기 입력은 이후 이력에서도 제외. 신고 버튼. 로그 |
| ⑤ 후처리 필터 | `filter.ts` — 문장 수, 금지 패턴(조언·칭찬·안심·심리 이름 붙이기·진단), 물음표, 느낌표·이모지, 영어 비율, 인용 길이, D16 ‘편견’ 선사용, 마지막 턴 필수 요소. 걸리면 **시제품 대본 문장으로 대체**하고 원문은 `llm_output`에 보존 |
| 7절 테스트 입력 | 건너뛰기·"넘어갈게요" → 고정 문구, 빈 입력·"ㅇㅇ"·"." → 같은 질문 한 번만 다시, 1,000자 초과 절단 등 |

질문은 모델이 바꾸지 못하도록 **다음 질문을 서버가 글자 그대로 붙입니다**(모델이 다른 질문을 만들면 물음표 검사로 대체).

### 지침·계획서와 다르게 한 점(확인 필요)
1. **temperature 미적용** — 지침 6절은 0.2~0.3이지만, Claude Sonnet 5.5는 temperature·top_p·top_k를 기본값 아닌 값으로 보내면 400 오류를 냅니다. 대신 사전 사고 끄기(`between_tools`)·`effort: low`로 지연을 줄이고, 질문 고정·후처리 필터로 이탈을 막습니다. 지침 6절 문구 수정이 필요합니다.
2. **max_tokens 400** — 지침은 300. 한국어 마지막 턴(5문장)이 잘리는 것을 막으려 조금 늘렸고, 길이는 필터(문장 수)로 제한합니다.
3. **D17 ‘심문’ 표현 → ‘따지는 질문’** — 매뉴얼("유도·심문·평가 용어는 쓰지 않음")에 맞춤.
4. **60:40 안내문은 시제품(HTML) 문안 유지** — 매뉴얼 표와 ③④ 문장이 다릅니다. 확정본을 알려 주시면 바꿉니다.
5. **음성 안내 없음** — 시제품처럼 텍스트만. 계획서·매뉴얼에는 음성(0.7배속)이 있습니다.

## 테스트
```bash
# 코치 로직(위기·건너뛰기·재질문·필터·대체 문장·D16/D17 흐름) — 18개
npx deno test supabase/functions/coach/coach_test.ts

# DB 권한·RLS·RPC — 로컬 PostgreSQL에서(빈 DB에 stub → 마이그레이션 → 테스트)
psql -d <빈 DB> -f tests/sql/supabase_stub.sql -f supabase/migrations/20261020000000_init.sql -f tests/sql/rls_test.sql

# 화면 흐름 D16→D17(미리보기 모드 + 가짜 Supabase) — Playwright 필요
python3 -m http.server 8765 --directory web &
node tests/e2e/flow.mjs
```
