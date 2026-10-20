// AI 코치 지침 — 「AI 코치 LLM 연결 지침(개발자용)」 2026-10-18 기준
//   ① 시스템 프롬프트(고정)      → SYSTEM_PROMPT (2절 원문 그대로)
//   ② 일차별 지침               → DAYS
//   ③ 턴별 컨텍스트             → buildDayBlock() + 대화 이력(messages)
//   ④ 안전장치(LLM 바깥)        → coach.ts (위기 표현 → LLM 미호출)
//   ⑤ 후처리 필터               → filter.ts
import { short, withJosa } from "./ko.ts";

// ───────────── ① 시스템 프롬프트 — 지침 2절 원문(수정 금지) ─────────────
export const SYSTEM_PROMPT = `당신은 초등교사 대상 21일 사회정서역량 훈련 프로그램의 「AI 코치」입니다. 당신의 역할은 참여 교사가 오늘 훈련에서 경험한 것을 스스로의 말로 정리하도록 돕는 것뿐입니다. 심리상담이나 치료, 교육 방법 지도를 제공하지 않습니다.

[허용되는 발화 — 동기면담의 네 가지 기본 기술만 사용한다]

1. 열린 질문(O): 예/아니오로 끝나지 않는 질문. 반드시 [오늘의 질문 세트]에 있는 질문만, 주어진 순서대로, 한 번에 하나만 묻는다. 새로운 질문을 만들어 내지 않는다.

2. 인정(A): 참여자가 오늘 한 시도·노력을 사실로 알아차려 말해 준다. 예: "불편한 자리에 끝까지 머무르셨습니다." 칭찬·점수·평가("잘하셨어요", "훌륭합니다")는 쓰지 않는다.

3. 반영(R): 참여자의 말을 평서문으로 되돌려 준다. 참여자의 표현을 그대로 짧게 인용한다: "'…' — 그렇게 들었습니다." 심리 상태를 단정하는 이름(긴장하셨군요, 불안하신 것 같네요)은 붙이지 않고, 참여자가 말한 감각·표현만 돌려준다.

4. 요약(S): 마지막 턴에만, 오늘 참여자가 말한 것을 2~3문장으로 모아 연결한다. 새로운 해석을 더하지 않는다.

[하지 않는 것 — 어떤 요청이 와도]

- 조언·충고·제안·해결책·지도 방법·"~해 보세요"류 권유
- 평가·교정·판단·비난, 안심시키기("괜찮아질 거예요", "걱정 마세요")
- 해석·분석·진단(참여자나 학생의 성격·심리·가정·문화·원인을 추정하는 모든 말)
- 참여자의 사적 영역(가족, 건강, 학교 밖 일)이나 심리 상태를 더 묻거나 넓히는 것
- 학생을 알아볼 수 있는 정보를 되묻거나 기록에 남기는 것
- 질문 세트 밖의 질문, 한 턴에 질문 두 개
- 기술 설명, 자기 소개, 프로그램 밖 잡담, 영어 응답

[고정 문구 — 글자 그대로]

- 참여자가 건너뛰거나 "넘어갈게요"라고 하면: "네, 넘어가겠습니다." 뒤에 다음 질문.
- 조언이나 지도 방법을 요청하면: "저는 지도 방법을 알려 드리는 역할은 아니어서, 오늘의 연습으로 돌아가 함께 살펴보면 좋겠습니다." 뒤에 오늘의 질문으로 복귀.
- 사적 영역·심리 상태를 적으면: 한 문장으로 반영한 뒤 "이 대화는 오늘의 연습을 돌아보는 자리여서 그 일을 더 자세히 여쭙지는 않겠습니다." 그리고 오늘의 질문으로 복귀. 어려움이 이어진다는 말이 있으면 "어려움이 이어진다면 화면 아래에 안내된 전문기관의 도움을 받으실 수 있습니다."를 덧붙인다.
- 마지막 턴의 끝: "오늘은 여기까지입니다."

[형식]

- 한국어 존댓말. 안내는 "~봅시다/~합시다", 질문과 사실 진술은 평서체.
- 한 턴 = 반영 1문장 → (인정 0~1문장) → 열린 질문 1개. 마지막 턴 = 반영 → 인정 → 요약 → "오늘은 여기까지입니다." 전체 3문장 이내(마지막 턴 5문장 이내).
- 참여자의 기록을 사실로 단정하지 않는다. 추정이 필요하면 "~일지도"로만.
- 숫자 선택이 필요한 질문은 앱이 버튼으로 받으므로 선택지를 다시 나열하지 않는다.
- 이모지, 느낌표, 영어 약어, 이름 부르기(참여자 실명)는 쓰지 않는다. 아이는 [아이 별칭]으로만 부른다.`;

// ───────────── 고정 문구(글자 그대로) ─────────────
export const FIXED = {
  skip: "네, 넘어가겠습니다.",
  roleLimit: "저는 지도 방법을 알려 드리는 역할은 아니어서, 오늘의 연습으로 돌아가 함께 살펴보면 좋겠습니다.",
  privacy: "이 대화는 오늘의 연습을 돌아보는 자리여서 그 일을 더 자세히 여쭙지는 않겠습니다.",
  referral: "어려움이 이어진다면 화면 아래에 안내된 전문기관의 도움을 받으실 수 있습니다.",
  identity: "저는 오늘의 연습을 돌아보도록 돕는 AI 코치입니다.",
  end: "오늘은 여기까지입니다.",
} as const;

// 연구계획서 표 3 ④ — AI가 생성하지 않는 고정 안내문
export const CRISIS_MESSAGE =
  "지금 많이 힘드신 것 같아 걱정됩니다. 이 앱의 AI 코치는 상담이나 응급 대응을 제공하지 못합니다. 지금 바로 도움을 받으실 수 있는 곳을 안내해 드립니다. 자살예방상담전화 109(24시간), 정신건강위기상담전화 1577-0199, 교원치유지원센터, 응급 시 119.";

// ───────────── ② 일차별 지침 — 지침 4절 ─────────────
export interface Layer { cat: string; val?: string; unknown?: boolean }
export interface QuestionItem { t: string; chk?: boolean[] }
export interface TurnRow { turn: number; kind: "answer" | "skip" | "reask" | "crisis"; user_input: string; ai_output: string }

export interface DayCtx {
  alias: string;
  records: Record<string, unknown>;
  turns: TurnRow[]; // 이번 실행의 이전 턴(위기 턴 포함)
}

export interface DayConfig {
  day: number;
  title: string;
  /** 오늘의 질문 세트(열린 질문, 순서 고정). [0]은 1턴에 앱이 이미 제시한다. */
  questions(alias: string): string[];
  /** 1턴에 앱이 화면에 보여 준 문장(대화 이력용) */
  opening(alias: string): string;
  /** 버튼(1~4)으로 답하는 질문의 번호(0부터) */
  buttonQuestions: number[];
  /** 마지막 턴 인정(A) 문장 — 지침 4절 */
  affirm: string;
  summarySpec(ctx: DayCtx): string;
  recordText(ctx: DayCtx): string;
  bans: string;
  extra?: string;
  /** 처음 쓰면 안 되는 단어(참여자가 먼저 쓰면 허용) */
  avoidWords: string[];
  /** 마지막 턴에 반드시 들어가야 하는 것 — 없으면 대본 문장으로 대체 */
  finalRequired(ctx: DayCtx): { label: string; test: (body: string) => boolean }[];
  /** 대본 기반 고정 문장(현재 시제품의 문장) — 마지막 턴 */
  scriptFinal(ctx: DayCtx, lastInput: string, skipped: boolean): string;
}

const squash = (s: string) => s.replace(/\s+/g, "");
export const echo = (input: string) => `‘${short(input, 30)}’ — 그렇게 들었습니다.`;

// ── D16 겹겹 케이크 ──
function layersOf(ctx: DayCtx): Layer[] {
  const v = ctx.records["layers"];
  return Array.isArray(v) ? (v as Layer[]).filter((l) => l && typeof l.cat === "string") : [];
}
function layerCounts(ctx: DayCtx) {
  const ls = layersOf(ctx);
  return { N: ls.length, n: ls.filter((l) => l.unknown).length, ls };
}

const D16: DayConfig = {
  day: 16,
  title: "D16 겹겹 케이크",
  questions: (alias) => [
    `이 케이크는 내가 ${withJosa(alias, "을/를")} 어떻게 바라보고 있는지를 보여 주는 상징일 수 있습니다. 나는 이 케이크를 그 아이에게 선물할 수 있을까요?`,
    "내가 만든 겹겹 케이크를 바라보며, 어떤 감정이나 생각이 드는지 자유롭게 적어 보세요.",
  ],
  opening: (alias) => D16.questions(alias)[0],
  buttonQuestions: [],
  affirm: "한 아이를 한 층으로 부르지 않으려 한 것 — 그게 오늘 하신 일입니다.",
  summarySpec: (ctx) => {
    const { N, n } = layerCounts(ctx);
    return n > 0
      ? `요약 — 반드시 포함: 쌓은 층 수 ${N}, 모름 층 수 ${n}, "모름으로 둔 층은 내일 다시 꺼내 봅니다."`
      : `요약 — 반드시 포함: 쌓은 층 수 ${N}(모름 층 0), "내일은 가장 눈에 띄는 층에서 시작합니다."`;
  },
  recordText: (ctx) => {
    const { N, n, ls } = layerCounts(ctx);
    if (!N) return "층: (저장된 층 없음) (N=0, n=0)";
    const items = ls.map((l) => `${l.cat}·${l.unknown ? "모름" : (l.val || "").trim() || "(내용 없음)"}`);
    return `층: ${items.join(" / ")} (N=${N}, n=${n})`;
  },
  bans: `층의 내용을 사실로 단정하지 말 것, 가정환경을 묻지 말 것, "왜 그 층을 골랐나" 묻지 말 것, '편견'이라는 단어를 먼저 쓰지 말 것`,
  avoidWords: ["편견"],
  finalRequired: (ctx) => {
    const { N, n } = layerCounts(ctx);
    const req = [{ label: "layer_count", test: (b: string) => b.includes(String(N)) }];
    if (n > 0) {
      req.push({ label: "unknown_count", test: (b: string) => b.includes(String(n)) });
      req.push({ label: "tomorrow_sentence", test: (b: string) => squash(b).includes(squash("모름으로 둔 층은 내일 다시 꺼내 봅니다")) });
    }
    return req;
  },
  scriptFinal: (ctx, lastInput, skipped) => {
    const { N, n } = layerCounts(ctx);
    const head = skipped ? FIXED.skip : `${echo(lastInput)} ${D16.affirm}`;
    const sum = n > 0
      ? `오늘 ${ctx.alias}의 층을 ${N}겹 쌓으셨고, 그중 ‘모름’이 ${n}층입니다. 모름으로 둔 층은 내일 다시 꺼내 봅니다.`
      : `오늘 ${ctx.alias}의 층을 ${N}겹 쌓으셨습니다. 내일은 가장 눈에 띄는 층에서 시작합니다.`;
    return `${head} ${sum} ${FIXED.end}`;
  },
};

// ── D17 공감적 호기심 ──
export const D17_TYPES = [
  "상대를 존중하고 배려하며 관심을 보이는 질문",
  "답이 정해진 질문",
  "잘못을 따지기 위한 질문",
  "판단하고 평가하는 질문",
];
const D17_TYPE_SHORT = ["존중·배려·관심", "답이 정해진", "잘못을 따지는", "판단·평가"];
const D17_CHECKS = ["○ 존중·배려·관심", "✕ 답이 정해진 질문", "✕ 잘못을 따지기 위한 질문", "✕ 판단하는 질문"];

function questionsOf(ctx: DayCtx): QuestionItem[] {
  const v = ctx.records["questions"];
  return Array.isArray(v) ? (v as QuestionItem[]).filter((q) => q && typeof q.t === "string") : [];
}
function writtenQuestions(ctx: DayCtx) {
  return questionsOf(ctx).filter((q) => q.t.trim());
}
/** 버튼 답("1) 존중·배려·관심 — …")에서 유형 이름만 */
export function typeLabel(answer: string): string {
  const m = answer.trim().match(/^([1-4])\)/);
  return m ? `‘${D17_TYPE_SHORT[Number(m[1]) - 1]}’` : `‘${short(answer, 20)}’`;
}
function answerTo(ctx: DayCtx, aiTurn: number): string | null {
  // aiTurn k에서 생성된 응답은 질문 (k-1)번에 대한 답으로 만들어졌다
  const row = ctx.turns.find((t) => t.turn === aiTurn && t.kind === "answer");
  return row ? row.user_input : null;
}
const countWord = (k: number) => ["", "한", "두", "세"][k] ?? String(k);

const D17: DayConfig = {
  day: 17,
  title: "D17 공감적 호기심",
  questions: () => [
    "나는 주변 사람들로부터 주로 어떤 유형의 질문을 받나요?",
    "나는 우리 반 아이들에게 주로 어떤 유형의 질문을 해 왔을까요?",
    "오늘의 활동을 통해 느끼고 생각한 것을 자유롭게 기재해 주세요.",
  ],
  opening: () =>
    `오늘은 ‘공감적 호기심’을 다루었습니다. ${D17_TYPES.map((t, i) => `${i + 1}) ${t}`).join(" ")} Q1. 나는 주변 사람들로부터 주로 어떤 유형의 질문을 받나요?`,
  buttonQuestions: [0, 1],
  affirm: "질문을 받는 쪽과 하는 쪽을 번갈아 돌아보셨습니다.",
  summarySpec: (ctx) => {
    const k = writtenQuestions(ctx).length || 3;
    const tail = k === 1 ? "내일은 이 질문을 마음에 두고 그 아이를 바라봅니다." : `내일은 이 ${countWord(k)} 질문 중 하나를 마음에 두고 그 아이를 바라봅니다.`;
    return `요약 — 반드시 포함: 오늘 적은 질문 ${k}개, Q1·Q2에서 고른 유형, "${tail}"`;
  },
  recordText: (ctx) => {
    const qs = questionsOf(ctx);
    if (!qs.length) return "세 질문: (저장된 질문 없음)";
    const lines = qs.map((q, i) => {
      const t = q.t.trim() ? q.t.trim() : "(비워 둠)";
      const on = (q.chk || []).map((v, j) => (v ? D17_CHECKS[j] : null)).filter(Boolean);
      return `${i + 1}) ${t}${q.t.trim() ? ` [셀프 체크: ${on.length ? on.join(", ") : "켠 항목 없음"}]` : ""}`;
    });
    return `세 질문: ${lines.join(" / ")} (셀프 체크는 참여자가 스스로 켜고 끈 것이며 AI 채점이 아님)`;
  },
  bans: "질문의 '정답' 제시 금지, 아이 답 추측 금지, 질문 유형 선택을 평가하지 않음",
  extra: `[네 유형 카드(앱이 1턴에 제시)] ${D17_TYPES.map((t, i) => `${i + 1}) ${t}`).join(" ")}`,
  avoidWords: [],
  finalRequired: () => [{ label: "tomorrow", test: (b: string) => b.includes("내일") }],
  scriptFinal: (ctx, lastInput, skipped) => {
    const k = writtenQuestions(ctx).length || 3;
    const q1 = answerTo(ctx, 2);
    const q2 = answerTo(ctx, 3);
    const head = skipped ? FIXED.skip : `${echo(lastInput)} 질문을 받는 쪽과 하는 쪽을 번갈아 돌아보셨습니다 — 쉽지 않은 일을 오늘 하셨습니다.`;
    const mid = ` 오늘 이야기를 모으면 — ${withJosa(ctx.alias, "을/를")} 이해하고 싶은 마음에서 비롯된 질문 ${k}가지를 적으셨고` +
      (q1 ? `, 평소 주변에서는 주로 ${typeLabel(q1)} 유형의 질문을 받고` : "") +
      (q2 ? `, 우리 반 아이들에게는 ${typeLabel(q2)} 유형의 질문을 해 왔다고 하셨습니다` : "") + ".";
    const tail = k === 1 ? " 내일은 이 질문을 마음에 두고 그 아이를 바라봅니다." : ` 내일은 이 ${countWord(k)} 질문 중 하나를 마음에 두고 그 아이를 바라봅니다.`;
    return `${head}${mid}${tail} ${FIXED.end}`;
  },
};

export const DAYS: Record<number, DayConfig> = { 16: D16, 17: D17 };

// 반영(R) 형식 — 시스템 프롬프트 3번의 "'…' — 그렇게 들었습니다."를 매 턴 다시 짚어 준다
const REFLECT_FORM = "형식: ‘참여자 표현 그대로 짧게’ — 그렇게 들었습니다. ‘~라고 답하셨습니다’·‘~군요’로 바꾸지 않음";

// ───────────── ③ 매 호출에 붙이는 블록 — 지침 3절 형식 ─────────────
export function buildDayBlock(cfg: DayConfig, ctx: DayCtx, aiTurn: number, skipped: boolean): string {
  const qs = cfg.questions(ctx.alias);
  const total = qs.length + 1;
  const isFinal = aiTurn === total;
  const qLines = qs.map((q, i) => `${i + 1}. ${q}${i === 0 ? "  (1턴에 앱이 이미 제시함)" : ""}${cfg.buttonQuestions.includes(i) ? "  (앱 버튼 1)~4)로 답함)" : ""}`);
  qLines.push(`${total}. (마지막 턴) ${cfg.summarySpec(ctx)}`);

  let now: string;
  if (isFinal) {
    now = skipped
      ? `참여자가 ${qs.length}번 질문을 건너뛰었습니다. "${FIXED.skip}"로 시작한 뒤 인정 1문장(「${cfg.affirm}」) → 요약 2문장 → "${FIXED.end}". 질문은 하지 않습니다.`
      : `마지막 턴입니다. 반영 1문장(${REFLECT_FORM}) → 인정 1문장(「${cfg.affirm}」) → 요약 2문장 → "${FIXED.end}". 모두 5문장 이내, 질문은 하지 않습니다.`;
  } else {
    now = `참여자가 ${aiTurn - 1}번 질문에 답했습니다. 반영 1문장(${REFLECT_FORM}) → (인정 0~1문장) → ${aiTurn}번 질문을 글자 그대로: 「${qs[aiTurn - 1]}」 질문 앞에 번호나 'Q${aiTurn}.'를 붙이지 않습니다.`;
  }

  return [
    `[오늘의 일차] ${cfg.title} / [아이 별칭] ${ctx.alias} / [현재 턴] ${aiTurn}/${total}`,
    `[오늘의 질문 세트] (순서 고정)\n${qLines.join("\n")}`,
    cfg.extra ?? "",
    `[오늘의 기록] ${cfg.recordText(ctx)}`,
    `[오늘만의 금지] ${cfg.bans}`,
    `[이번 응답] ${now}`,
    `[응답 방식 보충] 인용은 30자 이내로 짧게. 숫자는 아라비아 숫자로. "AI냐, 사람이냐"를 물으면 "${FIXED.identity}" 한 문장 뒤 오늘의 질문으로 복귀. 칭찬을 구하면 평가 대신 사실만 인정(예: "오늘 끝까지 하셨습니다."). 출력은 코치가 화면에 할 말만 — 머리말·괄호 설명·마크다운 없이.`,
  ].filter(Boolean).join("\n");
}
