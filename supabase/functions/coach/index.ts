// Supabase Edge Function: coach — 「돌아보기」 AI 코치
// 배포: supabase functions deploy coach --no-verify-jwt   (토큰은 함수 안에서 직접 확인)
// 비밀값: ANTHROPIC_API_KEY (필수) · ANTHROPIC_MODEL · COACH_TIMEOUT_MS · ALLOWED_ORIGINS
// 호출은 앱에서 서울 리전(ap-northeast-2)으로 고정한다(연구계획서 19번: Supabase 서울 → Anthropic).
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { ClaudeRequest, ClaudeResult, CoachError, handleTurn } from "./coach.ts";
import { DAYS, TurnRow } from "./prompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// 지침 6절: 모델 버전을 고정하고 기록. claude-sonnet-5-5는 고정 스냅샷 ID.
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";
const TIMEOUT_MS = Number(Deno.env.get("COACH_TIMEOUT_MS") ?? 8000); // 지침 6절: 8초
const MAX_TOKENS = 400; // 지침은 300 — 한국어 마지막 턴(5문장)이 잘리지 않도록 약간 여유. 길이는 후처리 필터가 막는다.
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// 위험 표현 사전: 연구자가 crisis_terms 테이블에서 관리. 5분 캐시.
let termsCache: { at: number; terms: string[] } | null = null;
async function crisisTerms(): Promise<string[]> {
  if (termsCache && Date.now() - termsCache.at < 5 * 60_000) return termsCache.terms;
  const { data, error } = await admin.from("crisis_terms").select("term");
  if (error) {
    console.error("crisis_terms", error.message);
    return termsCache?.terms ?? FALLBACK_TERMS;
  }
  termsCache = { at: Date.now(), terms: (data ?? []).map((r: { term: string }) => r.term) };
  return termsCache.terms;
}
const FALLBACK_TERMS = ["자살", "자해", "죽고싶", "사라지고싶", "살기싫", "극단적선택", "유서"];

// Claude Sonnet 5.5: temperature 등 샘플링 값을 바꾸면 400 → 보내지 않는다(지침 6절의 0.2~0.3은 적용 불가).
// 지연을 줄이려 사전 사고를 끄고(between_tools) effort를 낮춘다.
function modelOptions(model: string): Record<string, unknown> {
  if (/sonnet-5-5/.test(model)) return { thinking: { type: "between_tools" }, output_config: { effort: "low" } };
  return {};
}

async function callClaude(req: ClaudeRequest): Promise<ClaudeResult> {
  if (!ANTHROPIC_API_KEY) throw new CoachError("api_error", "ANTHROPIC_API_KEY missing");
  const deadline = Date.now() + TIMEOUT_MS;
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: req.system[0], cache_control: { type: "ephemeral" } },
      { type: "text", text: req.system[1] },
    ],
    messages: req.messages,
    ...modelOptions(MODEL),
  });
  let lastErr: CoachError = new CoachError("api_error");
  for (let attempt = 0; attempt < 2; attempt++) { // 재시도 1회(남은 시간 안에서)
    const remain = deadline - Date.now();
    if (remain < 1500) break;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), remain);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body,
        signal: ctl.signal,
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        console.error("anthropic", r.status, detail.slice(0, 500));
        lastErr = new CoachError("api_error", `status ${r.status}`);
        if (r.status === 429 || r.status >= 500) continue;
        break;
      }
      const j = await r.json();
      const text = (j.content ?? [])
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("\n")
        .trim();
      return { text, stopReason: j.stop_reason ?? null, model: j.model ?? MODEL };
    } catch (e) {
      lastErr = (e as Error).name === "AbortError" ? new CoachError("timeout") : new CoachError("api_error", String(e));
      if (lastErr.code === "timeout") break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED.length === 0 ? "*" : ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      req.headers.get("access-control-request-headers") ?? "authorization, x-client-info, apikey, content-type, x-region",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, h);
  const t0 = Date.now();
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401, h);
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u?.user) return json({ error: "unauthorized" }, 401, h);

    const { data: p } = await admin.from("participants").select("id, child_alias").eq("user_id", u.user.id).maybeSingle();
    if (!p) return json({ error: "not_participant" }, 403, h);

    const body = await req.json().catch(() => null);
    const runId = typeof body?.run_id === "string" ? body.run_id : "";
    const input = typeof body?.input === "string" ? body.input : "";
    if (!runId || !input.trim()) return json({ error: "bad_request" }, 400, h);

    const { data: run } = await admin.from("runs").select("id, day").eq("id", runId).eq("participant_id", p.id).maybeSingle();
    if (!run) return json({ error: "run_not_found" }, 404, h);
    if (!DAYS[run.day]) return json({ error: "unsupported_day" }, 400, h);

    const [recs, turns, terms] = await Promise.all([
      admin.from("records").select("key, value").eq("run_id", run.id),
      admin.from("coach_turns").select("turn, kind, user_input, ai_output").eq("run_id", run.id).order("id"),
      crisisTerms(),
    ]);
    if (recs.error || turns.error) throw new Error(recs.error?.message ?? turns.error?.message);

    const result = await handleTurn(
      {
        day: run.day,
        alias: p.child_alias || "ㅇㅇ",
        records: Object.fromEntries((recs.data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value])),
        turns: (turns.data ?? []) as TurnRow[],
      },
      input,
      { callClaude, crisisTerms: terms },
    );
    if (result.status === "closed") return json({ error: "closed", done: true }, 409, h);

    const { data: row, error: ie } = await admin.from("coach_turns").insert({
      run_id: run.id,
      participant_id: p.id,
      day: run.day,
      turn: result.turn,
      kind: result.kind,
      user_input: result.userInput,
      ai_output: result.text,
      llm_output: result.llmOutput,
      source: result.source,
      violations: result.violations,
      flagged: result.flagged,
      model: result.source === "llm" || result.llmOutput ? result.model : null,
      edge_region: Deno.env.get("SB_REGION") ?? null,
      latency_ms: Date.now() - t0,
    }).select("id").single();
    // 기록이 안 되면 다음 턴 계산이 어긋나므로 실패로 돌려보낸다(앱은 대본 문장으로 이어 간다).
    if (ie) throw new Error(`coach_turns insert: ${ie.message}`);

    return json({
      turn_id: row?.id ?? null,
      turn: result.turn,
      kind: result.kind,
      reply: result.reply,
      question: result.question,
      done: result.done,
      source: result.source,
    }, 200, h);
  } catch (e) {
    console.error("coach", e);
    return json({ error: "server_error" }, 500, h);
  }
});
