// D16 → D17 화면 흐름 점검(Playwright).
//   node tests/e2e/flow.mjs              ← web/ 를 http://localhost:8765 로 띄운 상태에서
// 두 가지 모드를 돈다:
//   preview — config.js 비어 있음: localStorage + 대본 문장
//   mocked  — Supabase(인증·RPC·coach 함수)를 가짜 응답으로 흉내: 요청 형태와 화면 반영을 확인
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium } = pw;

const BASE = process.env.BASE_URL || 'http://localhost:8765';
const SUPABASE_UMD = process.env.SUPABASE_UMD; // 로컬 사본(없으면 CDN 그대로)
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(OUT, { recursive: true });

const D16Q2 = '내가 만든 겹겹 케이크를 바라보며, 어떤 감정이나 생각이 드는지 자유롭게 적어 보세요.';
const D17Q = [
  '나는 주변 사람들로부터 주로 어떤 유형의 질문을 받나요?',
  '나는 우리 반 아이들에게 주로 어떤 유형의 질문을 해 왔을까요?',
  '오늘의 활동을 통해 느끼고 생각한 것을 자유롭게 기재해 주세요.',
];

function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }

// ───────── 가짜 Supabase ─────────
function mockSupabase(page, log) {
  const db = { runs: {}, records: {}, me: null, turns: {}, reports: [] };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjo0MTAyNDQ0ODAwfQ.x',
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r1',
    user: { id: '00000000-0000-0000-0000-0000000000a1', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
  return page.route('https://mock.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: '' });
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    log.push({ path: url.pathname, query: url.search, body, headers: req.headers() });

    if (url.pathname === '/auth/v1/signup') return json(route, session);
    if (url.pathname === '/auth/v1/user') return json(route, session.user);
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors, body: '' });

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) {
      const fn = rpc[1];
      if (fn === 'claim_participant') {
        if (body.p_key !== 'demopass1') return json(route, { code: '28000', message: 'invalid_credentials' }, 400);
        db.me = { code: String(body.p_code).trim().toUpperCase(), child_alias: null, cohort: 'demo' };
        return json(route, db.me);
      }
      if (fn === 'me') return json(route, db.me);
      if (fn === 'set_child_alias') { db.me.child_alias = body.p_alias; return json(route, db.me); }
      if (fn === 'my_status') return json(route, []);
      if (fn === 'start_run') { const id = 'run-' + body.p_day + '-' + Object.keys(db.runs).length; db.runs[id] = { day: body.p_day }; db.records[id] = {}; db.turns[id] = 0; return json(route, id); }
      if (fn === 'save_record') { db.records[body.p_run][body.p_key] = body.p_value; return route.fulfill({ status: 204, headers: cors, body: '' }); }
      if (fn === 'latest_record') {
        const ids = Object.keys(db.runs).filter((id) => db.runs[id].day === body.p_day && body.p_key in db.records[id]);
        return json(route, ids.length ? db.records[ids[ids.length - 1]][body.p_key] : null);
      }
      if (fn === 'complete_run') { db.runs[body.p_run].completed = true; return json(route, new Date().toISOString()); }
      if (fn === 'report_turn') { db.reports.push(body.p_turn); return route.fulfill({ status: 204, headers: cors, body: '' }); }
      return json(route, { message: 'unknown rpc ' + fn }, 404);
    }

    if (url.pathname === '/functions/v1/coach') {
      const run = db.runs[body.run_id];
      assert(run, 'coach: unknown run ' + body.run_id);
      assert(/^Bearer /.test(req.headers()['authorization'] || ''), 'coach: no bearer token');
      assert(req.headers()['x-region'] === 'ap-northeast-2', 'coach: x-region header missing');
      assert(url.searchParams.get('forceFunctionRegion') === 'ap-northeast-2', 'coach: forceFunctionRegion missing');
      if (body.input.includes('사라지고 싶')) {
        return json(route, { turn_id: 900, turn: 0, kind: 'crisis', reply: '지금 많이 힘드신 것 같아 걱정됩니다. (고정 안내문)', question: '', done: false, source: 'crisis' });
      }
      const k = ++db.turns[body.run_id] + 1;
      const rec = db.records[body.run_id];
      if (run.day === 16) {
        assert(Array.isArray(rec.layers) && rec.layers.length === 3, 'D16 coach 호출 전에 layers가 저장돼야 함');
        if (k === 2) return json(route, { turn_id: 101, turn: 2, kind: 'answer', reply: `‘${body.input.slice(0, 10)}’ — 그렇게 들었습니다.`, question: D16Q2, done: false, source: 'llm' });
        return json(route, { turn_id: 102, turn: 3, kind: 'answer', reply: '(LLM) 오늘 초록의 층을 3겹 쌓으셨고, 그중 ‘모름’이 2층입니다. 모름으로 둔 층은 내일 다시 꺼내 봅니다. 오늘은 여기까지입니다.', question: '', done: true, source: 'llm' });
      }
      assert(Array.isArray(rec.questions) && rec.questions.filter((q) => q.t).length === 2, 'D17 coach 호출 전에 questions가 저장돼야 함');
      if (k <= 3) return json(route, { turn_id: 200 + k, turn: k, kind: 'answer', reply: `‘${body.input}’ — 그렇게 들었습니다.`, question: D17Q[k - 1], done: false, source: 'llm' });
      return json(route, { turn_id: 204, turn: 4, kind: 'answer', reply: '(LLM) 질문을 받는 쪽과 하는 쪽을 번갈아 돌아보셨습니다. 내일은 이 두 질문 중 하나를 마음에 두고 그 아이를 바라봅니다. 오늘은 여기까지입니다.', question: '', done: true, source: 'llm' });
    }
    return json(route, { message: 'unmocked ' + url.pathname }, 404);
  }).then(() => db);
}

async function skipBreathing(page) {
  for (let i = 0; i < 5; i++) {
    const skip = page.locator('#g-skip');
    if (await skip.isVisible()) await skip.click();
  }
  await page.locator('#g-next:not([disabled])').click();
}

async function runFlow(page, mode, log) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  // ── 첫 화면 ──
  await page.goto(`${BASE}/index.html?fast=1`);
  if (mode === 'mocked') {
    await page.locator('#login').waitFor();
    await page.fill('#code', 'demo01');
    await page.fill('#key', 'wrong-pass');
    await page.click('#loginBtn');
    await page.locator('#loginErr', { hasText: '맞지 않습니다' }).waitFor();
    await page.fill('#key', 'demopass1');
    await page.click('#loginBtn');
  }
  await page.locator('#home').waitFor();
  if (mode === 'mocked') assert((await page.textContent('#meCode')) === 'DEMO01', 'participant code shown');
  await page.fill('#alias', '초록');
  await page.click('#aliasBtn');
  await page.locator('#toast', { hasText: '초록' }).waitFor();
  assert(/fast=1/.test(await page.getAttribute('#goD16', 'href')), 'fast link');
  await page.screenshot({ path: `${OUT}/${mode}-0-home.png`, fullPage: true });

  // ── D16 ──
  await page.click('#goD16');
  await page.waitForURL(/d16\.html/);
  await page.locator('#appFooter').waitFor();
  await page.click('#startBtn');
  await skipBreathing(page);
  await page.fill('#r6040', '복도에서 한 번 해 봤어요');
  await page.click('#s2 .btn.primary');
  await page.click('#s3 .btn.primary');
  await page.locator('#s4.on').waitFor();
  assert((await page.textContent('#s4 .q')).includes('초록에 관해'), 'alias in D16 s4');
  for (const [chip, val] of [['성격', '조용함'], ['가족의 형태', null], ['경제 형편', null]]) {
    await page.locator('#chips .chip', { hasText: chip }).click();
    if (val) { await page.fill('#entryVal', val); await page.click('#entry .btn.primary'); }
    else await page.click('#entry .btn.ghost');
  }
  assert((await page.textContent('#cnt')) === '3', 'three layers');
  await page.click('#toNext');
  await page.locator('#chat .msg.ai', { hasText: '초록을 어떻게 바라보고' }).waitFor();
  await page.fill('#chatTxt', '아직은 선물하기엔 비어 있는 층이 많아요');
  await page.click('#sendBtn');
  await page.locator('#chat .msg.ai b', { hasText: D16Q2 }).waitFor();
  if (mode === 'mocked') {
    await page.locator('#chat .msg.ai .rpt').first().waitFor();
    page.once('dialog', (d) => d.accept());
    await page.locator('#chat .msg.ai .rpt').first().click();
    await page.locator('#chat .msg.ai .rpt', { hasText: '신고했습니다' }).waitFor();
  }
  // 위기 표현
  await page.fill('#chatTxt', '요즘은 그냥 사라지고 싶어요');
  await page.click('#sendBtn');
  await page.locator('#chat .msg.ai.crisis').waitFor();
  assert(await page.locator('#chatIn').isVisible(), 'crisis does not end the chat');
  await page.fill('#chatTxt', '생각보다 아는 게 적어서 놀랐어요');
  await page.click('#sendBtn');
  await page.locator('#chatDone').waitFor({ state: 'visible' });
  const finalD16 = await page.locator('#chat .msg.ai').last().textContent();
  assert(finalD16.includes('3겹') && finalD16.includes('2층') && finalD16.includes('오늘은 여기까지입니다'), 'D16 final summary: ' + finalD16);
  if (mode === 'mocked') assert(finalD16.includes('(LLM)'), 'mocked LLM text used');
  await page.screenshot({ path: `${OUT}/${mode}-1-d16-chat.png`, fullPage: true });
  await page.click('#chatDone .btn');
  await page.locator('#s6.on').waitFor();
  assert((await page.textContent('#unkSummary')).includes('가족의 형태 · 경제 형편'), 'unknown summary');
  await page.click('#finBtn');
  await page.locator('#finBtn', { hasText: 'D17로 이어서' }).waitFor();
  await page.screenshot({ path: `${OUT}/${mode}-2-d16-end.png`, fullPage: true });
  await page.click('#finBtn');

  // ── D17 ──
  await page.waitForURL(/d17\.html\?fast=1/);
  await page.locator('#s0 .nm', { hasText: '초록' }).first().waitFor();
  await page.click('#startBtn');
  await skipBreathing(page);
  await page.click('#s2 .btn.primary');
  await page.locator('#s3.on').waitFor();
  const unkTop = await page.textContent('#unkTop');
  assert(unkTop.includes('가족의 형태') && unkTop.includes('경제 형편') && !unkTop.includes('두려워하는 것'), 'D16 unknown layers carried over: ' + unkTop);
  await page.fill('#r6040', '눈이 마주칠 때 잊어버렸어요');
  await page.click('#s3 .btn.primary');
  await page.locator('#s4.on').waitFor();
  assert((await page.textContent('#s4 .q')).startsWith('초록을 배려하면서'), 'josa 을 after 초록');
  await page.fill('#qt1', '왜 그랬어?');
  await page.locator('#why1.show', { hasText: '따지는 질문' }).waitFor();
  assert(!(await page.content()).includes('심문'), "no '심문' wording");
  await page.locator('#unkIn span', { hasText: '가족의 형태' }).click();
  assert((await page.inputValue('#qt0')).startsWith('가족의 형태에 대해'), 'keyword fills first box');
  await page.fill('#qt0', '집에 가면 제일 먼저 뭐 해?');
  await page.fill('#qt1', '점심시간엔 뭐 하고 싶어?');
  await page.locator('#chk0 button').first().click();
  await page.click('#toPick');
  await page.fill('#rFace', '조금 놀랐다가 웃었을지도');
  await page.locator('#picks .pick').nth(1).click();
  await page.click('#toAI');
  await page.locator('#numChips button').first().waitFor();
  await page.locator('#numChips button', { hasText: '2)' }).click();
  await page.locator('#chat .msg.ai b', { hasText: 'Q2. ' + D17Q[1] }).waitFor();
  await page.locator('#numChips button', { hasText: '4)' }).click();
  await page.locator('#chat .msg.ai b', { hasText: D17Q[2] }).waitFor();
  assert(!(await page.locator('#numChips').isVisible()), 'chips hidden for free-text Q3');
  await page.fill('#chatTxt', '내가 하는 질문이 생각보다 답을 정해 두고 있었다');
  await page.click('#sendBtn');
  await page.locator('#chatDone').waitFor({ state: 'visible' });
  const finalD17 = await page.locator('#chat .msg.ai').last().textContent();
  assert(finalD17.includes('내일') && finalD17.includes('오늘은 여기까지입니다'), 'D17 final: ' + finalD17);
  if (mode === 'preview') assert(finalD17.includes('‘답이 정해진’') && finalD17.includes('‘판단·평가’') && finalD17.includes('질문 2가지'), 'preview D17 summary uses types: ' + finalD17);
  await page.screenshot({ path: `${OUT}/${mode}-3-d17-chat.png`, fullPage: true });
  await page.click('#chatDone .btn');
  await page.locator('#s7.on').waitFor();
  assert((await page.textContent('#pickedQ')).includes('점심시간엔 뭐 하고 싶어?'), 'picked question on last screen');
  await page.click('#finBtn');
  await page.locator('#finBtn', { hasText: '처음 화면으로' }).waitFor();
  await page.screenshot({ path: `${OUT}/${mode}-4-d17-end.png`, fullPage: true });

  assert(errors.length === 0, 'page errors: ' + errors.join(' | '));
}

const browser = await chromium.launch();
let failed = false;
for (const mode of ['preview', 'mocked']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const log = [];
  if (SUPABASE_UMD) {
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SUPABASE_UMD, 'utf8') }));
  }
  let db = null;
  if (mode === 'mocked') {
    await page.route('**/assets/config.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: "window.APP_CONFIG={SUPABASE_URL:'https://mock.supabase.co',SUPABASE_KEY:'sb_publishable_mock',FUNCTION_REGION:'ap-northeast-2',RESEARCHER_CONTACT:'연구자 이메일(예시)'};" }));
    db = await mockSupabase(page, log);
  }
  try {
    await runFlow(page, mode, log);
    if (mode === 'mocked') {
      const coachCalls = log.filter((l) => l.path === '/functions/v1/coach');
      assert(coachCalls.length === 6, 'coach calls: ' + coachCalls.length);
      assert(db.reports.length === 1 && db.reports[0] === 101, 'report_turn sent with turn id');
      const runs = Object.values(db.runs);
      assert(runs.length === 2 && runs.every((r) => r.completed), 'both runs completed');
      const d17 = Object.keys(db.runs).find((id) => db.runs[id].day === 17);
      assert(db.records[d17].picked && db.records[d17].picked.t === '점심시간엔 뭐 하고 싶어?', 'picked saved');
      assert(db.records[d17].rFace === '조금 놀랐다가 웃었을지도', 'face saved');
      assert(db.records[d17].r6040, 'r6040 saved');
    }
    console.log(`✓ ${mode} flow passed`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${mode} flow failed:`, e.message);
    await page.screenshot({ path: `${OUT}/${mode}-FAIL.png`, fullPage: true }).catch(() => {});
  }
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
