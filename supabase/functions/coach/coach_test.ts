// deno test supabase/functions/coach/coach_test.ts
import nodeAssert from "node:assert/strict";

const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);
const assertStringIncludes = (s: string, sub: string) => nodeAssert.ok(s.includes(sub), `expected to include:\n  ${sub}\nin:\n  ${s}`);
import { ClaudeRequest, CoachError, Deps, TurnState, handleTurn, isSkip } from "./coach.ts";
import { CRISIS_MESSAGE, DAYS, FIXED, TurnRow } from "./prompt.ts";
import { josa } from "./ko.ts";

const TERMS = ["자살", "죽고싶", "사라지고싶"];
const D16Q2 = DAYS[16].questions("ㅇㅇ")[1];
const D17Q = DAYS[17].questions("ㅇㅇ");

function fake(outputs: (string | Error)[], log: ClaudeRequest[] = []): Deps {
  let i = 0;
  return {
    crisisTerms: TERMS,
    callClaude: (req) => {
      log.push(req);
      const o = outputs[i++];
      if (o instanceof Error) return Promise.reject(o);
      return Promise.resolve({ text: o, stopReason: "end_turn", model: "claude-sonnet-5-5" });
    },
  };
}

const layers = [
  { cat: "성격", val: "말수 적음", unknown: false },
  { cat: "좋아하는 것", val: "그림", unknown: false },
  { cat: "몰입 수준", val: "수학은 멍", unknown: false },
  { cat: "가족의 형태", val: "", unknown: true },
  { cat: "두려워하는 것", val: "", unknown: true },
];
const d16 = (turns: TurnRow[] = []): TurnState => ({ day: 16, alias: "ㅇㅇ", records: { layers }, turns });

Deno.test("D16 턴2: 반영+인정 뒤 질문 2를 글자 그대로 붙인다", async () => {
  const log: ClaudeRequest[] = [];
  const r = await handleTurn(d16(), "선물하기엔 아직 비어 있는 층이 많아요", fake([
    `‘아직 비어 있는 층이 많아요’ — 그렇게 들었습니다. ${D16Q2}`,
  ], log));
  assertEquals(r.source, "llm");
  assertEquals(r.turn, 2);
  assertEquals(r.question, D16Q2);
  assertEquals(r.reply, "‘아직 비어 있는 층이 많아요’ — 그렇게 들었습니다.");
  assertStringIncludes(log[0].system[1], "[현재 턴] 2/3");
  assertStringIncludes(log[0].system[1], "가족의 형태·모름");
  assertStringIncludes(log[0].system[1], "(N=5, n=2)");
  assertStringIncludes(log[0].system[1], "— 그렇게 들었습니다. ‘~라고 답하셨습니다’");
  assertEquals(log[0].messages, [{ role: "user", content: "선물하기엔 아직 비어 있는 층이 많아요" }]);
});

Deno.test("모델이 질문을 빼먹어도 질문은 앱이 글자 그대로 붙인다", async () => {
  const r = await handleTurn(d16(), "잘 모르겠어요", fake(["‘잘 모르겠어요’ — 그렇게 들었습니다."]));
  assertEquals(r.source, "llm");
  assertEquals(r.question, D16Q2);
});

Deno.test("조언 패턴은 대본 문장으로 대체", async () => {
  const r = await handleTurn(d16(), "어떻게 다가가야 할지 모르겠어요", fake([
    `‘어떻게 다가가야 할지’ — 그렇게 들었습니다. 먼저 말을 걸어 보세요. ${D16Q2}`,
  ]));
  assertEquals(r.source, "fallback");
  assert(r.violations.includes("advice"));
  assertEquals(r.reply, "‘어떻게 다가가야 할지 모르겠어요’ — 그렇게 들었습니다.");
  assertEquals(r.question, D16Q2);
  assert(r.llmOutput?.includes("말을 걸어"));
});

Deno.test("질문 2개·느낌표·칭찬·안심시키기 → 대체", async () => {
  for (const [out, v] of [
    [`좋은 생각이에요. 가족은 어떤가요? ${D16Q2}`, "extra_question"],
    [`‘네’ — 그렇게 들었습니다! ${D16Q2}`, "exclamation"],
    [`‘네’ — 그렇게 들었습니다. 잘하셨어요. ${D16Q2}`, "praise"],
    [`‘네’ — 그렇게 들었습니다. 괜찮아질 거예요. ${D16Q2}`, "reassure"],
  ] as const) {
    const r = await handleTurn(d16(), "네 할 수 있을 것 같아요", fake([out]));
    assertEquals(r.source, "fallback", out);
    assert(r.violations.includes(v), `${out} → ${r.violations}`);
  }
});

Deno.test("심리 상태 이름 붙이기: 참여자가 쓰지 않은 말이면 대체, 쓴 말이면 허용", async () => {
  const a = await handleTurn(d16(), "케이크가 생각보다 작아요", fake([`케이크 앞에서 불안하신 것 같네요. ${D16Q2}`]));
  assert(a.violations.includes("psych_label"));
  const b = await handleTurn(d16(), "조금 불안해졌어요", fake([`‘조금 불안해졌어요’ — 그렇게 들었습니다. ${D16Q2}`]));
  assertEquals(b.source, "llm");
});

Deno.test("D16: '편견'을 AI가 먼저 쓰면 대체", async () => {
  const r = await handleTurn(d16(), "몇 층만 보고 있었네요", fake([`‘몇 층만 보고 있었네요’ — 그렇게 들었습니다. 편견을 알아차리셨습니다. ${D16Q2}`]));
  assert(r.violations.includes("avoid:편견"));
});

Deno.test("진단 표현: 참여자 말 인용은 허용, AI가 덧붙이면 대체", async () => {
  const ok = await handleTurn(d16(), "그 애는 ADHD 같아요", fake([`‘그 애는 ADHD 같아요’ — 그렇게 들었습니다. ${D16Q2}`]));
  assertEquals(ok.source, "llm");
  const bad = await handleTurn(d16(), "많이 돌아다녀요", fake([`‘많이 돌아다녀요’ — 그렇게 들었습니다. ADHD 성향이 있을지도 모릅니다. ${D16Q2}`]));
  assert(bad.violations.includes("diagnosis"));
});

Deno.test("고정 문구(역할 한계·사적 영역·전문기관·AI 정체)는 문장 수에서 빠진다", async () => {
  const a = await handleTurn(d16(), "그 아이가 수업 중에 계속 돌아다니는데 어떻게 지도해야 할까요?", fake([
    `‘계속 돌아다니는데’ — 그렇게 들었습니다. ${FIXED.roleLimit} ${D16Q2}`,
  ]));
  assertEquals(a.source, "llm", a.violations.join());
  const b = await handleTurn(d16(), "요즘 집안일까지 겹쳐서 너무 지치고 잠도 못 자요", fake([
    `‘너무 지치고 잠도 못 자요’ — 그렇게 들었습니다. ${FIXED.privacy} ${FIXED.referral} ${D16Q2}`,
  ]));
  assertEquals(b.source, "llm", b.violations.join());
  const c = await handleTurn(d16(), "너 AI야? 진짜 사람이야?", fake([`${FIXED.identity} ${D16Q2}`]));
  assertEquals(c.source, "llm", c.violations.join());
});

Deno.test("위기 표현: LLM을 부르지 않고 고정 안내문, 턴은 그대로", async () => {
  const log: ClaudeRequest[] = [];
  const r = await handleTurn(d16(), "요즘은 그냥 사라지고 싶어요", fake(["x"], log));
  assertEquals(log.length, 0);
  assertEquals(r.kind, "crisis");
  assertEquals(r.reply, CRISIS_MESSAGE);
  assert(r.flagged);
  assertEquals(r.done, false);
  // 다음 호출은 같은 턴(2)이고, 위기 입력은 이력으로 보내지 않는다
  const turns: TurnRow[] = [{ turn: 2, kind: "crisis", user_input: "요즘은 그냥 사라지고 싶어요", ai_output: CRISIS_MESSAGE }];
  const r2 = await handleTurn(d16(turns), "네", fake([`‘네’ — 그렇게 들었습니다. ${D16Q2}`], log));
  assertEquals(r2.turn, 2);
  assertEquals(log[0].messages.length, 1);
});

Deno.test("띄어쓰기를 바꾼 위기 표현도 감지", async () => {
  const r = await handleTurn(d16(), "죽고 싶 다는 생각", fake(["x"]));
  assertEquals(r.kind, "crisis");
});

Deno.test("건너뛰기(중간 턴): 고정 문구 + 다음 질문, LLM 미호출", async () => {
  const log: ClaudeRequest[] = [];
  const r = await handleTurn(d16(), "(건너뛰기)", fake([], log));
  assertEquals(r.text, `${FIXED.skip} ${D16Q2}`);
  assertEquals(r.kind, "skip");
  assertEquals(log.length, 0);
  assert(isSkip("오늘은 그냥 넘어갈게요."));
  assert(!isSkip("넘어가기 전에 생각해 보니 어려웠어요"));
});

Deno.test("빈 입력류(ㅇㅇ, .)는 같은 질문 한 번만 다시, 두 번째는 넘어감", async () => {
  const q1 = DAYS[16].questions("ㅇㅇ")[0];
  const r1 = await handleTurn(d16(), "ㅇㅇ", fake([]));
  assertEquals(r1.kind, "reask");
  assertEquals(r1.question, q1);
  const turns: TurnRow[] = [{ turn: 2, kind: "reask", user_input: "ㅇㅇ", ai_output: q1 }];
  const r2 = await handleTurn(d16(turns), ".", fake([]));
  assertEquals(r2.kind, "skip");
  assertEquals(r2.question, D16Q2);
});

const d16AfterQ2 = (): TurnState => d16([
  { turn: 2, kind: "answer", user_input: "아직은 못 줄 것 같아요", ai_output: `‘아직은 못 줄 것 같아요’ — 그렇게 들었습니다. ${D16Q2}` },
]);

Deno.test("D16 마지막 턴: 필수 요소가 있으면 통과, 끝 문장 보장", async () => {
  const r = await handleTurn(d16AfterQ2(), "생각보다 아는 게 적어서 놀랐어요", fake([
    "‘아는 게 적어서 놀랐어요’ — 그렇게 들었습니다. 한 아이를 한 층으로 부르지 않으려 한 것 — 그게 오늘 하신 일입니다. 오늘 ㅇㅇ의 층을 5겹 쌓으셨고, 그중 ‘모름’이 2층입니다. 모름으로 둔 층은 내일 다시 꺼내 봅니다.",
  ]));
  assertEquals(r.source, "llm", r.violations.join());
  assert(r.done);
  assert(r.reply.endsWith(FIXED.end));
  assertEquals(r.turn, 3);
});

Deno.test("D16 마지막 턴: '모름으로 둔 층은 내일…'이 빠지면 대본 문장", async () => {
  const r = await handleTurn(d16AfterQ2(), "생각보다 아는 게 적어서 놀랐어요", fake([
    "‘놀랐어요’ — 그렇게 들었습니다. 오늘 끝까지 하셨습니다. 5겹 중 2겹이 모름이었습니다. 오늘은 여기까지입니다.",
  ]));
  assertEquals(r.source, "fallback");
  assert(r.violations.includes("missing:tomorrow_sentence"));
  assertStringIncludes(r.reply, "5겹 쌓으셨고, 그중 ‘모름’이 2층입니다. 모름으로 둔 층은 내일 다시 꺼내 봅니다. 오늘은 여기까지입니다.");
});

Deno.test("시간 초과 → 대본 문장", async () => {
  const r = await handleTurn(d16(), "글쎄요 선물은 어렵겠어요", fake([new CoachError("timeout")]));
  assertEquals(r.source, "fallback");
  assertEquals(r.violations, ["timeout"]);
  assertEquals(r.question, D16Q2);
});

Deno.test("마지막 턴 뒤 호출은 closed", async () => {
  const s = d16AfterQ2();
  s.turns.push({ turn: 3, kind: "answer", user_input: "x", ai_output: "y" });
  const r = await handleTurn(s, "또", fake([]));
  assertEquals(r.status, "closed");
});

Deno.test("D17: 버튼 답 → Q2, 이어서 Q3, 마지막에 '내일' 필수", async () => {
  const records = { questions: [{ t: "점심시간엔 뭐 하고 싶어?", chk: [true, false, false, false] }, { t: "집에 가면 제일 먼저 뭐 해?", chk: [false, false, false, false] }, { t: "", chk: [false, false, false, false] }] };
  const log: ClaudeRequest[] = [];
  const s: TurnState = { day: 17, alias: "초록", records, turns: [] };
  const r2 = await handleTurn(s, "2) 답이 정해진", fake([`‘2) 답이 정해진’ — 그렇게 들었습니다. ${D17Q[1]}`], log));
  assertEquals(r2.source, "llm", r2.violations.join());
  assertEquals(r2.question, D17Q[1]);
  assertStringIncludes(log[0].system[1], "[현재 턴] 2/4");
  assertStringIncludes(log[0].system[1], "점심시간엔 뭐 하고 싶어? [셀프 체크: ○ 존중·배려·관심]");
  assertStringIncludes(log[0].system[1], "오늘 적은 질문 2개");
  s.turns.push({ turn: 2, kind: "answer", user_input: "2) 답이 정해진", ai_output: r2.text });
  const r3 = await handleTurn(s, "4) 판단·평가", fake([`‘4) 판단·평가’ — 그렇게 들었습니다. ${D17Q[2]}`]));
  assertEquals(r3.question, D17Q[2]);
  s.turns.push({ turn: 3, kind: "answer", user_input: "4) 판단·평가", ai_output: r3.text });
  const r4 = await handleTurn(s, "내가 하는 질문이 생각보다 정해진 답을 기대하고 있었다", fake([
    "‘정해진 답을 기대하고 있었다’ — 그렇게 들었습니다. 질문을 받는 쪽과 하는 쪽을 번갈아 돌아보셨습니다. 그래서 질문 유형이 중요합니다.",
  ]));
  assertEquals(r4.source, "fallback"); // '내일' 누락
  assertStringIncludes(r4.reply, `${"초록"}${josa("초록", "을/를")} 이해하고 싶은 마음에서 비롯된 질문 2가지를 적으셨고, 평소 주변에서는 주로 ‘답이 정해진’ 유형의 질문을 받고, 우리 반 아이들에게는 ‘판단·평가’ 유형의 질문을 해 왔다고 하셨습니다. 내일은 이 두 질문 중 하나를 마음에 두고 그 아이를 바라봅니다. 오늘은 여기까지입니다.`);
  assert(r4.done);
});

Deno.test("조사: 받침 유무", () => {
  assertEquals(josa("초록", "을/를"), "을");
  assertEquals(josa("하늘이", "을/를"), "를");
  assertEquals(josa("ㅇㅇ", "을/를"), "를");
  assertEquals(josa("민", "과/와"), "과");
});
