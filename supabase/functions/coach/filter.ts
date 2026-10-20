// ⑤ 후처리 필터 — 지침 5절: 문장 수 초과 · 금지 패턴 · 물음표 2개 이상 · 영어 비율 · 실명
// 하나라도 걸리면 호출부(coach.ts)가 그 턴의 대본 문장으로 대체하고 로그에 남긴다.
import { FIXED } from "./prompt.ts";

const QUOTE_RE = /‘[^’]{0,400}’|“[^”]{0,400}”|'[^']{0,400}'|"[^"]{0,400}"|「[^」]{0,400}」/g;

export function stripQuotes(s: string): string {
  return s.replace(QUOTE_RE, "「인용」");
}

function quotes(s: string): string[] {
  return (s.match(QUOTE_RE) || []).map((q) => q.slice(1, -1));
}

const squash = (s: string) => s.replace(/\s+/g, "");

/** 고정 문구는 문장 수·패턴 검사에서 뺀다(글자 그대로 쓰도록 지시된 문장이므로). */
export function removeFixed(s: string): string {
  let out = s;
  for (const f of Object.values(FIXED)) {
    const re = new RegExp(escapeRe(f).replace(/\\ /g, "\\s*").replace(/ /g, "\\s*"), "g");
    out = out.replace(re, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sentences(s: string): string[] {
  return s
    .split(/(?<=[.?!。？！])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => /[가-힣A-Za-z0-9]/.test(x));
}

/** 출력 정리: 머리말·마크다운 기호·여분 공백 제거 */
export function clean(raw: string): string {
  return raw
    .replace(/^\s*(AI\s*코치|코치)\s*[:：]\s*/i, "")
    .replace(/\*\*/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

interface CheckOpts {
  maxSentences: number;
  /** 참여자가 쓴 글(입력·기록) — 참여자가 먼저 쓴 낱말은 허용 */
  participantText: string;
  avoidWords: string[];
  requireBody: boolean;
}

const ADVICE = /(?:보세요|보시면|보시길|보시는 건|보시는 것|하시길|하시면 좋|하세요|하십시오|해야 합니다|해야 해요|하는 것이 좋|하는 게 좋|좋겠습니다|권해|권합니다|권유|추천|제안드|시도해|주세요)/;
const PRAISE = /(?:잘하셨|잘 하셨|훌륭|대단하|대단해|멋지|멋있|최고|완벽|칭찬|좋은 답|좋은 질문|좋은 생각|좋습니다|좋네요|좋아요)/;
const REASSURE = /(?:괜찮아질|괜찮을 거|괜찮을거|걱정 ?마|걱정하지 마|잘 될 거|잘될 거|나아질 거)/;
const PSYCH = /(불안|긴장|우울|스트레스|상처|두려|죄책|외로|무기력|소진|지치|지쳐|힘드|힘들|속상|서운|답답|화가|분노|좌절|부담|슬프|슬픔|미안)[가-힣\s]{0,12}?(?:것 같네요|것 같아요|것 같습니다|군요|보이네요|보입니다|느껴지네요)/g;
const DIAG = /(ADHD|자폐|장애|증후군|진단|우울증|과잉행동|발달 ?지연|성향이|기질이|트라우마|애착)/gi;
const EMOJI = /\p{Extended_Pictographic}/u;

export function checkBody(body: string, o: CheckOpts): string[] {
  const v: string[] = [];
  const unq = removeFixed(stripQuotes(body));
  const ptext = squash(o.participantText);

  // 반영(인용) 또는 고정 문구(예: AI 정체 문장) 중 하나는 있어야 한다
  if (o.requireBody && !/[가-힣]/.test(stripQuotes(body))) v.push("empty");
  if (sentences(unq).length > o.maxSentences) v.push("too_many_sentences");
  if (/[?？]/.test(unq)) v.push("extra_question");
  if (/[!！]/.test(unq)) v.push("exclamation");
  if (EMOJI.test(body)) v.push("emoji");
  if (/[<>#`]|\*\*|^\s*[-•]\s/m.test(body)) v.push("format");

  const latin = (unq.match(/[A-Za-z]/g) || []).length;
  const hangul = (unq.match(/[가-힣]/g) || []).length;
  if (latin >= 8 && latin / Math.max(1, latin + hangul) > 0.2) v.push("english");

  if (ADVICE.test(unq)) v.push("advice");
  if (PRAISE.test(unq)) v.push("praise");
  if (REASSURE.test(unq)) v.push("reassure");

  for (const m of unq.matchAll(PSYCH)) {
    if (!ptext.includes(squash(m[1]))) { v.push("psych_label"); break; }
  }
  for (const m of unq.matchAll(DIAG)) {
    if (!ptext.toLowerCase().includes(squash(m[1]).toLowerCase())) { v.push("diagnosis"); break; }
  }
  for (const w of o.avoidWords) {
    if (unq.includes(w) && !ptext.includes(w)) v.push(`avoid:${w}`);
  }
  if (quotes(body).some((q) => q.length > 50)) v.push("long_quote");
  return v;
}

/** 출력에서 다음 질문(글자 그대로)과 'Q2.' 같은 머리표를 떼어 낸다. */
export function removeQuestion(text: string, question: string): { rest: string; found: boolean } {
  const pat = escapeRe(question.trim()).replace(/\s+/g, "\\s*");
  const re = new RegExp(`(?:Q\\d\\.\\s*)?[「“"']?${pat}[」”"']?`, "g");
  const found = re.test(text);
  const rest = text.replace(re, " ").replace(/(?:Q\d\.\s*)$/, "").replace(/\s+/g, " ").replace(/\s*[—–-]\s*$/, "").trim();
  return { rest, found };
}

export interface FinalizeIn {
  raw: string;
  isFinal: boolean;
  skipped: boolean;
  nextQuestion: string | null;
  participantText: string;
  avoidWords: string[];
  required: { label: string; test: (b: string) => boolean }[];
  truncated: boolean;
}
export interface FinalizeOut {
  ok: boolean;
  violations: string[];
  reply: string;
  question: string;
}

export function finalize(i: FinalizeIn): FinalizeOut {
  const v: string[] = [];
  if (i.truncated) v.push("truncated");
  let t = clean(i.raw);
  if (!t) return { ok: false, violations: ["empty_output"], reply: "", question: "" };

  if (!i.isFinal) {
    const q = i.nextQuestion ?? "";
    const { rest } = removeQuestion(t, q);
    v.push(...checkBody(rest, {
      maxSentences: 2,
      participantText: i.participantText,
      avoidWords: i.avoidWords,
      requireBody: true,
    }));
    return { ok: v.length === 0, violations: v, reply: rest, question: q };
  }

  // 마지막 턴: 끝 문장 떼고 검사 → 다시 붙인다
  const endRe = new RegExp(`${escapeRe(FIXED.end).replace(/\\?\s+/g, "\\s*")}\\s*$`);
  let body = t.replace(endRe, "").trim();
  body = body.replace(new RegExp(escapeRe(FIXED.end).replace(/\\?\s+/g, "\\s*"), "g"), " ").trim();
  if (i.skipped && !squash(body).startsWith(squash(FIXED.skip))) body = `${FIXED.skip} ${body}`;
  v.push(...checkBody(body, {
    maxSentences: 4,
    participantText: i.participantText,
    avoidWords: i.avoidWords,
    requireBody: true,
  }));
  for (const r of i.required) if (!r.test(body)) v.push(`missing:${r.label}`);
  t = `${body} ${FIXED.end}`.replace(/\s+/g, " ").trim();
  return { ok: v.length === 0, violations: v, reply: t, question: "" };
}
