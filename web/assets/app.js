/* 공통 — Supabase 연결 · 세션 기록 · AI 코치 호출 · 화면 아래 안내 · 조사
 * 설정(assets/config.js)이 비어 있으면 「미리보기 모드」: localStorage에만 저장, AI는 대본 문장. */
(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var REGION = C.FUNCTION_REGION || 'ap-northeast-2';
  var params = new URLSearchParams(location.search);
  var sb = null;
  if (C.SUPABASE_URL && C.SUPABASE_KEY) {
    if (window.supabase && window.supabase.createClient) {
      sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'eunsoo-auth' },
      });
    } else {
      console.error('supabase-js를 불러오지 못했습니다');
    }
  }
  var online = !!sb;
  var me = null, runId = null, runDay = null;

  // ── localStorage(미리보기 모드·시연 편의) ──
  var LS = {
    get: function (k) { try { return JSON.parse(localStorage.getItem('eunsoo:' + k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('eunsoo:' + k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } },
  };

  // ── 조사 ──
  function hasBatchim(w) {
    var ch = String(w || '').trim().slice(-1);
    if (!ch) return false;
    var c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
    if (/[0-9]/.test(ch)) return '013678'.indexOf(ch) >= 0;
    return false;
  }
  /** pair: '을/를' '이/가' '은/는' '과/와' (받침 있을 때/없을 때) */
  function josa(w, pair) { var p = pair.split('/'); return hasBatchim(w) ? p[0] : p[1]; }
  var JOSA_OF = { '을': '을/를', '를': '을/를', '이': '이/가', '가': '이/가', '은': '은/는', '는': '은/는', '과': '과/와', '와': '과/와' };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /** .nm 자리에 별칭을 넣고, 바로 뒤 조사(를/가/와…)를 받침에 맞춘다 */
  function applyAlias(alias) {
    document.querySelectorAll('.nm').forEach(function (el) {
      el.textContent = alias;
      var n = el.nextSibling;
      if (n && n.nodeType === 3) {
        n.textContent = n.textContent.replace(/^(을|를|가|은|는|과|와)(?=[\s,.·—)]|$)/, function (m) { return josa(alias, JOSA_OF[m]); });
      }
    });
  }

  function toast(t) { if (typeof window.toast === 'function') window.toast(t); }

  function safeNext(n) {
    return n && /^[A-Za-z0-9_-]+(\.html)?(\?[A-Za-z0-9_=&%.-]*)?$/.test(n) ? n : null;
  }
  function toLogin() {
    var here = location.pathname.split('/').pop() + location.search;
    location.replace('index.html?next=' + encodeURIComponent(here));
    return new Promise(function () {});
  }

  function errMsg(e) {
    var m = (e && (e.message || e.error_description || e.msg)) || String(e);
    if (/invalid_credentials/.test(m)) return '참여번호 또는 접속 코드가 맞지 않습니다.';
    if (/anonymous/i.test(m) && /disabled/i.test(m)) return '로그인 설정이 아직 꺼져 있습니다(관리자: Supabase에서 Anonymous sign-ins 켜기).';
    if (/rate limit|too many/i.test(m)) return '잠시 후 다시 시도해 주세요(요청이 너무 많습니다).';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return '네트워크에 연결할 수 없습니다.';
    return '문제가 생겼습니다: ' + m;
  }

  var App = {
    online: online,
    debug: params.get('debug') === '1',
    fast: params.get('fast') === '1',
    josa: josa,
    esc: esc,
    applyAlias: applyAlias,
    errMsg: errMsg,
    safeNext: safeNext,

    /** 세션 화면에서 호출: 로그인 확인 후 참여자 정보. 로그인 안 됐으면 첫 화면으로 보낸다. */
    ready: function () {
      if (!online) {
        me = { code: '미리보기', child_alias: LS.get('alias') || null, preview: true };
        return Promise.resolve(me);
      }
      return sb.auth.getSession().then(function (r) {
        if (!r.data.session) return toLogin();
        return sb.rpc('me').then(function (x) {
          if (x.error || !x.data) return toLogin();
          me = x.data;
          return me;
        });
      });
    },
    /** 첫 화면에서: 로그인돼 있으면 참여자 정보, 아니면 null */
    current: function () {
      if (!online) return Promise.resolve({ code: '미리보기', child_alias: LS.get('alias') || null, preview: true });
      return sb.auth.getSession().then(function (r) {
        if (!r.data.session) return null;
        return sb.rpc('me').then(function (x) { me = x.data || null; return me; });
      });
    },
    alias: function () { return (me && me.child_alias) || 'ㅇㅇ'; },
    code: function () { return me ? me.code : ''; },

    login: function (code, key) {
      return sb.auth.getSession().then(function (r) {
        if (r.data.session) return null;
        return sb.auth.signInAnonymously().then(function (x) { if (x.error) throw x.error; });
      }).then(function () {
        return sb.rpc('claim_participant', { p_code: code, p_key: key });
      }).then(function (x) {
        if (x.error) throw x.error;
        me = x.data;
        return me;
      });
    },
    logout: function () { return online ? sb.auth.signOut() : Promise.resolve(); },

    setAlias: function (a) {
      if (!online) { LS.set('alias', a || null); me = { code: '미리보기', child_alias: a || null, preview: true }; return Promise.resolve(me); }
      return sb.rpc('set_child_alias', { p_alias: a }).then(function (x) { if (x.error) throw x.error; me = x.data; return me; });
    },

    /** 일차별 완료 현황 [{day, runs, completed, last_started_at, last_completed_at}] */
    status: function () {
      if (!online) {
        return Promise.resolve([16, 17].map(function (d) {
          var r = LS.get('run:' + d);
          return r ? { day: d, runs: 1, completed: r.completed_at ? 1 : 0, last_started_at: r.started_at, last_completed_at: r.completed_at || null } : null;
        }).filter(Boolean));
      }
      return sb.rpc('my_status').then(function (x) { if (x.error) throw x.error; return x.data || []; });
    },

    startRun: function (day) {
      runDay = day;
      if (!online) {
        runId = 'local-' + Date.now();
        LS.set('run:' + day, { id: runId, started_at: new Date().toISOString(), records: {} });
        return Promise.resolve(runId);
      }
      return sb.rpc('start_run', { p_day: day }).then(function (x) {
        if (x.error) throw x.error;
        runId = x.data;
        return runId;
      });
    },

    save: function (key, value) {
      if (!runId) return Promise.resolve();
      if (!online) {
        var r = LS.get('run:' + runDay) || { records: {} };
        r.records = r.records || {};
        r.records[key] = value;
        LS.set('run:' + runDay, r);
        return Promise.resolve();
      }
      return sb.rpc('save_record', { p_run: runId, p_key: key, p_value: value }).then(function (x) {
        if (x.error) { console.warn('save_record', x.error); toast('저장하지 못했습니다 — 연결을 확인해 주세요'); }
      });
    },

    complete: function () {
      if (!runId) return Promise.resolve();
      if (!online) {
        var r = LS.get('run:' + runDay) || {};
        r.completed_at = new Date().toISOString();
        LS.set('run:' + runDay, r);
        return Promise.resolve();
      }
      return sb.rpc('complete_run', { p_run: runId }).then(function (x) { if (x.error) console.warn('complete_run', x.error); });
    },

    /** 해당 일차에서 가장 최근 저장 기록(예: D17 ← D16 layers) */
    latest: function (day, key) {
      if (!online) {
        var r = LS.get('run:' + day);
        return Promise.resolve(r && r.records && key in r.records ? r.records[key] : null);
      }
      return sb.rpc('latest_record', { p_day: day, p_key: key }).then(function (x) { if (x.error) throw x.error; return x.data; });
    },

    /** AI 코치 한 턴. 실패하면 throw → 화면은 대본 문장으로 이어 간다. */
    coach: function (input) {
      if (!online) return Promise.reject(new Error('preview'));
      if (!runId) return Promise.reject(new Error('no_run'));
      return sb.functions.invoke('coach', {
        body: { run_id: runId, input: input },
        region: REGION,
        timeout: 15000,
      }).then(function (x) {
        if (x.error) {
          var st = x.error.context && x.error.context.status;
          if (st === 409) return { kind: 'answer', reply: '', question: '', done: true, source: 'fixed', closed: true };
          throw x.error;
        }
        return x.data;
      });
    },

    /** AI 메시지 아래 「부적절한 응답 신고」 */
    reportLink: function (el, turnId) {
      if (!online || !turnId) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rpt';
      b.textContent = '부적절한 응답 신고';
      b.onclick = function () {
        if (!confirm('이 응답을 연구자에게 신고할까요?\n참여번호와 이 대화 한 턴(입력·응답·일차·시각)만 전달됩니다.')) return;
        b.disabled = true;
        sb.rpc('report_turn', { p_turn: turnId, p_note: null }).then(function (x) {
          if (x.error) throw x.error;
          b.textContent = '신고했습니다 — 연구자에게 전달됩니다';
        }).catch(function () {
          b.disabled = false;
          alert('신고를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
        });
      };
      el.appendChild(b);
    },

    /** 화면 아래 안내: AI 코치 성격 · 전문기관 · 연구자 문의 */
    footer: function (host) {
      var old = document.getElementById('appFooter');
      if (old) {
        var idl = old.querySelector('.app-foot-id');
        if (idl && online) idl.textContent = me ? '참여번호 ' + me.code : '';
        return;
      }
      var f = document.createElement('footer');
      f.id = 'appFooter';
      f.className = 'app-foot';
      f.innerHTML =
        '<p><b>AI 코치는 상담·치료를 제공하지 않습니다.</b> 성찰을 돕는 보조 도구이며, 대화를 실시간으로 지켜보지 않습니다.</p>' +
        '<p>도움이 필요하면 · 자살예방상담전화 <a href="tel:109">109</a>(24시간) · 정신건강위기상담전화 <a href="tel:15770199">1577-0199</a> · 교원치유지원센터 · 응급 <a href="tel:119">119</a></p>' +
        (C.RESEARCHER_CONTACT ? '<p>연구자 문의 · ' + esc(C.RESEARCHER_CONTACT) + '</p>' : '') +
        '<p class="app-foot-id">' + (online ? (me ? '참여번호 ' + esc(me.code) : '') : '미리보기 모드 — 기록은 이 브라우저에만 남고, AI 코치는 대본 문장으로 답합니다') + '</p>';
      (host || document.getElementById('app') || document.body).appendChild(f);
    },

    /** 미리보기 모드 안내 띠(상단 진행 줄 아래) */
    previewBand: function () {
      if (online || document.getElementById('previewBand')) return;
      var d = document.createElement('div');
      d.id = 'previewBand';
      d.className = 'preview-band';
      d.textContent = '미리보기 모드 — 서버가 연결되지 않아 기록은 이 브라우저에만 남고, AI 코치는 대본 문장으로 답합니다.';
      var top = document.querySelector('.top');
      if (top && top.parentNode) top.parentNode.insertBefore(d, top.nextSibling);
    },

    /** 서버에 닿지 못할 때(미리보기 포함)의 위기 표현 감지 — 서버의 crisis_terms와 같은 취지의 최소 목록 */
    localCrisis: function (t) {
      var s = String(t || '').replace(/\s+/g, '');
      var terms = ['자살', '자해', '죽고싶', '죽어버리', '사라지고싶', '없어지고싶', '살기싫', '살고싶지않', '극단적선택', '목숨을끊', '유서'];
      for (var i = 0; i < terms.length; i++) if (s.indexOf(terms[i]) >= 0) return App.CRISIS_MESSAGE;
      return null;
    },
    CRISIS_MESSAGE: '지금 많이 힘드신 것 같아 걱정됩니다. 이 앱의 AI 코치는 상담이나 응급 대응을 제공하지 못합니다. 지금 바로 도움을 받으실 수 있는 곳을 안내해 드립니다. 자살예방상담전화 109(24시간), 정신건강위기상담전화 1577-0199, 교원치유지원센터, 응급 시 119.',

    /** 링크에 ?fast=1·?debug=1을 이어 붙인다 */
    link: function (page) {
      var q = [];
      if (App.fast) q.push('fast=1');
      if (App.debug) q.push('debug=1');
      return page + (q.length ? '?' + q.join('&') : '');
    },
  };

  window.App = App;
})();
