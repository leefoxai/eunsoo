// 한 턴 처리(입출력 없음 — index.ts가 DB·API를 주입한다). 단위 테스트: coach_test.ts
import { CRISIS_MESSAGE, DAYS, DayCtx, FIXED, SYSTEM_PROMPT, TurnRow, buildDayBlock, echo } from "./prompt.ts";
import { finalize } from "./filter.ts";

export type Kind = TurnRow["kind"];
export type Source = "llm" | "fallback" | "fixed" | "crisis";

export interface ClaudeRequest {
  system: [string, string]; // [고정 시스템 프롬프트, 일차·턴 블록]
  messages: { role: "user" | "assistant"; content: string }[];
}
export interface ClaudeResult { text: string; stopReason: string | null; model: string | null }
export class CoachError extends Error {
  constructor(public code: "timeout" | "api_error", message?: string) { super(message ?? code); }
}

export interface Deps {
  callClaude(req: ClaudeRequest): Promise<ClaudeResult>;
  crisisTerms: string[];
}

export interface TurnState extends DayCtx { day: number }

export interface TurnResult {
  status: "ok" | "closed";
  turn: number;
  kind: Kind;
  reply: string;
  question: string;
  text: string; // 화면에 나간 전체 문장(로그용)
  done: boolean;
  source: Source;
  violations: string[];
  flagged: boolean;
  llmOutput: string | null;
  model: string | null;
  userInput: string;
}

export const MAX_INPUT = 1000;

const squash = (s: string) => s.replace(/\s+/g, "");

export function isCrisis(input: string, terms: string[]): boolean {
  const s = squash(input);
  return terms.some((t) => t && s.includes(squash(t)));
}

export function isSkip(input: string): boolean {
  const s = input.trim();
  if (s === "(건너뛰기)") return true;
  return /^(?:오늘은\s*)?(?:그냥\s*)?(?:넘어갈게요?|넘어갈래요|넘어가요|넘어가겠습니다|건너뛸게요?|건너뛰기|건너뛸래요|패스|pass|skip)\s*[.!~]*$/i.test(s);
}

/** 빈 입력·"ㅇㅇ"·"." 같은 것 — 지침 7절: 같은 질문을 한 번만 다시 제시 */
export function isEmptyish(input: string): boolean {
  return /^[\sㄱ-ㅎㅏ-ㅣ.,!?~…·\-_]*$/.test(input);
}

export async function handleTurn(state: TurnState, rawInput: string, deps: Deps): Promise<TurnResult> {
  const cfg = DAYS[state.day];
  if (!cfg) throw new Error(`unsupported_day:${state.day}`);
  const qs = cfg.questions(state.alias);
  const finalTurn = qs.length + 1;
  const advanced = state.turns.filter((t) => t.kind === "answer" || t.kind === "skip").length;
  const k = advanced + 2; // 이번에 생성할 AI 턴(1턴은 앱이 제시한 첫 질문)
  const input = rawInput.trim().slice(0, MAX_INPUT);

  const base = { turn: k, flagged: false, violations: [] as string[], llmOutput: null, model: null, userInput: input };
  if (k > finalTurn) {
    return { ...base, status: "closed", kind: "answer", reply: "", question: "", text: "", done: true, source: "fixed" };
  }
  const isFinal = k === finalTurn;
  const answering = qs[k - 2];
  const next = isFinal ? null : qs[k - 1];

  // ④ 위기 표현 → LLM 호출 없이 고정 안내문, 턴은 넘어가지 않는다
  if (isCrisis(input, deps.crisisTerms)) {
    return { ...base, status: "ok", kind: "crisis", reply: CRISIS_MESSAGE, question: "", text: CRISIS_MESSAGE, done: false, source: "crisis", flagged: true };
  }

  let skipped = isSkip(input);
  if (!skipped && isEmptyish(input)) {
    const last = state.turns[state.turns.length - 1];
    const alreadyReasked = !!last && last.kind === "reask" && last.turn === k;
    if (!alreadyReasked) {
      return { ...base, status: "ok", kind: "reask", reply: "", question: answering, text: answering, done: false, source: "fixed" };
    }
    skipped = true; // 두 번째부터는 넘어간다
  }

  if (skipped && !isFinal) {
    return { ...base, status: "ok", kind: "skip", reply: FIXED.skip, question: next!, text: `${FIXED.skip} ${next}`, done: false, source: "fixed" };
  }

  // ③ 턴 컨텍스트 + 이전 턴(위기 턴은 보내지 않는다)
  const history = state.turns.filter((t) => t.kind !== "crisis");
  const messages: ClaudeRequest["messages"] = [];
  for (const t of history) {
    messages.push({ role: "user", content: t.user_input });
    messages.push({ role: "assistant", content: t.ai_output });
  }
  messages.push({ role: "user", content: skipped ? "(건너뛰기)" : input });
  const system: [string, string] = [
    SYSTEM_PROMPT,
    `${buildDayBlock(cfg, state, k, skipped)}\n[1턴에 앱이 보여 준 문장] ${cfg.opening(state.alias)}`,
  ];

  const participantText = [
    ...history.map((t) => t.user_input),
    input,
    JSON.stringify(state.records),
  ].join("\n");

  const kind: Kind = skipped ? "skip" : "answer";
  const script = () =>
    isFinal ? cfg.scriptFinal(state, input, skipped) : `${echo(input)} ${next}`;
  const scriptParts = () =>
    isFinal ? { reply: script(), question: "" } : { reply: echo(input), question: next! };

  let res: ClaudeResult | null = null;
  let err: string | null = null;
  try {
    res = await deps.callClaude({ system, messages });
  } catch (e) {
    err = e instanceof CoachError ? e.code : "api_error";
  }

  if (!res) {
    const p = scriptParts();
    return { ...base, status: "ok", kind, ...p, text: script(), done: isFinal, source: "fallback", violations: [err ?? "api_error"] };
  }

  const fin = finalize({
    raw: res.text,
    isFinal,
    skipped,
    nextQuestion: next,
    participantText,
    avoidWords: cfg.avoidWords,
    required: isFinal ? cfg.finalRequired(state) : [],
    truncated: res.stopReason === "max_tokens",
  });

  if (!fin.ok) {
    const p = scriptParts();
    return { ...base, status: "ok", kind, ...p, text: script(), done: isFinal, source: "fallback", violations: fin.violations, llmOutput: res.text, model: res.model };
  }
  const text = fin.question ? `${fin.reply} ${fin.question}` : fin.reply;
  return { ...base, status: "ok", kind, reply: fin.reply, question: fin.question, text, done: isFinal, source: "llm", llmOutput: res.text, model: res.model };
}
