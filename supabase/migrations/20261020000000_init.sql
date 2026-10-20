-- ════════════════════════════════════════════════════════════════════
-- 21일 프로그램 시연(D16·D17) — 초기 스키마
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--          (또는 CLI: supabase db push)
--
-- 원칙(연구계획서 19번 · AI 코치 LLM 연결 지침 5절)
--   · 앱 DB에는 참여번호만 저장한다. 이름·연락처·소속은 저장하지 않는다.
--   · 모든 테이블은 RLS로 잠근다. 참여자는 아래 RPC 함수로만 읽고 쓴다.
--   · AI 대화 기록(coach_turns)은 서버 함수(service role)만 쓴다.
--   · 연구자 점검용 뷰는 API에 노출되지 않는 research 스키마에 둔다.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── 테이블 ─────────────────────────

create table public.participants (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  access_hash   text not null,
  user_id       uuid unique references auth.users(id) on delete set null,
  child_alias   text check (char_length(child_alias) between 1 and 12),
  cohort        text not null default 'demo' check (cohort in ('demo', 'expert', 'pilot')),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
comment on table public.participants is
  '참여번호(code)와 접속 코드 해시만 저장. 이름·연락처와의 매칭키는 앱 밖에서 별도 보관(연구계획서 19번).';
comment on column public.participants.child_alias is
  '그 아이의 별칭(학생 실명 금지). AI 요청에는 이 별칭만 전송된다.';

create table public.runs (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  day            smallint not null check (day between 1 and 21),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index runs_participant_day on public.runs (participant_id, day, started_at desc);
comment on table public.runs is '세션 1회 실행. 시작·완료 시각 = 앱 사용 기록(연구계획서 표 5 ④).';

create table public.records (
  run_id         uuid not null references public.runs(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  key            text not null check (char_length(key) between 1 and 40),
  value          jsonb not null,
  updated_at     timestamptz not null default now(),
  primary key (run_id, key)
);
comment on table public.records is '세션 기록 입력(예: D16 layers, D17 questions). AI 턴 컨텍스트로 쓰인다.';

create table public.coach_turns (
  id             bigint generated always as identity primary key,
  run_id         uuid not null references public.runs(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  day            smallint not null,
  turn           smallint not null,
  kind           text not null check (kind in ('answer', 'skip', 'reask', 'crisis')),
  user_input     text not null,
  ai_output      text not null,
  llm_output     text,
  source         text not null check (source in ('llm', 'fallback', 'fixed', 'crisis')),
  violations     text[] not null default '{}',
  flagged        boolean not null default false,
  model          text,
  edge_region    text,
  latency_ms     integer,
  created_at     timestamptz not null default now()
);
create index coach_turns_run on public.coach_turns (run_id, id);
comment on table public.coach_turns is
  'AI 성찰 대화 로그: 참여번호·일차·턴·입력·LLM 출력·후처리 대체 여부·플래그(LLM 연결 지침 5절). 서버 함수만 기록.';
comment on column public.coach_turns.llm_output is '모델이 실제로 낸 원문(대체된 경우에도 보존). 화면에 나간 문장은 ai_output.';
comment on column public.coach_turns.source is
  'llm=모델 응답 / fallback=규칙 위반·지연으로 대본 문장 대체 / fixed=건너뛰기·재질문 고정 문구 / crisis=위기 안내문(LLM 미호출)';

create table public.coach_reports (
  id             bigint generated always as identity primary key,
  turn_id        bigint not null references public.coach_turns(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  note           text check (char_length(note) <= 500),
  created_at     timestamptz not null default now()
);
comment on table public.coach_reports is '참여자가 누른 「부적절한 응답 신고」(연구계획서 11번 셋째).';

create table public.crisis_terms (
  term       text primary key check (char_length(term) between 2 and 30),
  created_at timestamptz not null default now()
);
comment on table public.crisis_terms is
  '위험 표현 사전. 입력에 포함되면 LLM을 호출하지 않고 고정 안내문을 낸다. 연구자가 Table Editor에서 관리.';

alter table public.participants  enable row level security;
alter table public.runs          enable row level security;
alter table public.records       enable row level security;
alter table public.coach_turns   enable row level security;
alter table public.coach_reports enable row level security;
alter table public.crisis_terms  enable row level security;
-- 정책(policy)을 하나도 두지 않는다 → anon/authenticated는 테이블에 직접 접근할 수 없다.

-- ─────────────────── 위험 표현 사전(초안 — 연구자 검토 필요) ───────────────────
-- 띄어쓰기를 지운 뒤 포함 여부로 비교한다(서버 함수에서 처리).
insert into public.crisis_terms (term) values
  ('자살'), ('자해'), ('죽고싶'), ('죽고만싶'), ('죽어버리'), ('죽어야겠'), ('죽을래'),
  ('죽는게낫'), ('사라지고싶'), ('없어지고싶'), ('살기싫'), ('살고싶지않'), ('그만살고'),
  ('끝내고싶'), ('극단적선택'), ('극단적인선택'), ('목숨을끊'), ('스스로목숨'),
  ('손목을긋'), ('뛰어내리'), ('목을매'), ('유서')
on conflict do nothing;

-- ───────────────────────── 내부 도우미 ─────────────────────────

create or replace function public.current_participant_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.participants p where p.user_id = auth.uid()
$$;

create or replace function public.require_participant()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select p.id into v from public.participants p where p.user_id = auth.uid();
  if v is null then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  return v;
end $$;

-- ───────────────────────── 참여자용 RPC ─────────────────────────

-- 참여번호 + 접속 코드로 로그인(익명 세션에 참여번호를 연결). 다른 기기에서 다시 로그인하면 그 기기로 옮겨진다.
create or replace function public.claim_participant(p_code text, p_key text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_hash text;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if auth.uid() is null then
    raise exception 'no_session' using errcode = '28000';
  end if;
  select p.id, p.access_hash into v_id, v_hash from public.participants p where p.code = v_code;
  if v_id is null or v_hash is distinct from extensions.crypt(coalesce(p_key, ''), v_hash) then
    raise exception 'invalid_credentials' using errcode = '28000';
  end if;
  update public.participants set user_id = null where user_id = auth.uid() and id <> v_id;
  update public.participants set user_id = auth.uid(), last_login_at = now() where id = v_id;
  return (select json_build_object('code', p.code, 'child_alias', p.child_alias, 'cohort', p.cohort)
            from public.participants p where p.id = v_id);
end $$;

create or replace function public.me()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('code', p.code, 'child_alias', p.child_alias, 'cohort', p.cohort)
    from public.participants p where p.user_id = auth.uid()
$$;

create or replace function public.set_child_alias(p_alias text)
returns json language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := public.require_participant();
        v_alias text := nullif(trim(coalesce(p_alias, '')), '');
begin
  if v_alias is not null and char_length(v_alias) > 12 then
    raise exception 'alias_too_long' using errcode = '22001';
  end if;
  update public.participants set child_alias = v_alias where id = v_pid;
  return public.me();
end $$;

create or replace function public.start_run(p_day int)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := public.require_participant();
        v_id  uuid;
begin
  if p_day is null or p_day not between 1 and 21 then
    raise exception 'bad_day' using errcode = '22023';
  end if;
  insert into public.runs (participant_id, day) values (v_pid, p_day) returning id into v_id;
  return v_id;
end $$;

create or replace function public.save_record(p_run uuid, p_key text, p_value jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := public.require_participant();
begin
  if not exists (select 1 from public.runs r where r.id = p_run and r.participant_id = v_pid) then
    raise exception 'run_not_found' using errcode = '42501';
  end if;
  if p_value is null or octet_length(p_value::text) > 20000 then
    raise exception 'value_too_large' using errcode = '22001';
  end if;
  insert into public.records (run_id, participant_id, key, value, updated_at)
  values (p_run, v_pid, p_key, p_value, now())
  on conflict (run_id, key) do update set value = excluded.value, updated_at = now();
end $$;

create or replace function public.complete_run(p_run uuid)
returns timestamptz language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := public.require_participant();
        v_at  timestamptz;
begin
  update public.runs set completed_at = coalesce(completed_at, now())
   where id = p_run and participant_id = v_pid
  returning completed_at into v_at;
  if v_at is null then
    raise exception 'run_not_found' using errcode = '42501';
  end if;
  return v_at;
end $$;

-- 해당 일차에서 가장 최근에 저장된 기록 하나(예: D17이 D16의 layers를 불러올 때).
create or replace function public.latest_record(p_day int, p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select rec.value
    from public.records rec
    join public.runs r on r.id = rec.run_id
   where r.participant_id = public.current_participant_id()
     and r.day = p_day
     and rec.key = p_key
   order by rec.updated_at desc
   limit 1
$$;

create or replace function public.my_status()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(s order by s.day), '[]'::json) from (
    select r.day,
           count(*)                                   as runs,
           count(r.completed_at)                      as completed,
           max(r.started_at)                          as last_started_at,
           max(r.completed_at)                        as last_completed_at
      from public.runs r
     where r.participant_id = public.current_participant_id()
     group by r.day
  ) s
$$;

create or replace function public.report_turn(p_turn bigint, p_note text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_pid uuid := public.require_participant();
begin
  if not exists (select 1 from public.coach_turns t where t.id = p_turn and t.participant_id = v_pid) then
    raise exception 'turn_not_found' using errcode = '42501';
  end if;
  insert into public.coach_reports (turn_id, participant_id, note)
  values (p_turn, v_pid, left(nullif(trim(coalesce(p_note, '')), ''), 500));
end $$;

-- ───────────────────────── 연구자용 함수 ─────────────────────────
-- SQL Editor에서만 실행(참여자·익명 역할은 실행 불가).

-- 참여번호 발급: select public.create_participant('P01', '접속코드8자이상', 'demo');
create or replace function public.create_participant(p_code text, p_key text, p_cohort text default 'demo')
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_code text := upper(trim(p_code));
begin
  if p_key is null or char_length(p_key) < 8 then
    raise exception '접속 코드는 8자 이상으로 정해 주세요' using errcode = '22023';
  end if;
  insert into public.participants (code, access_hash, cohort)
  values (v_code, extensions.crypt(p_key, extensions.gen_salt('bf', 8)), p_cohort)
  on conflict (code) do update set access_hash = excluded.access_hash, cohort = excluded.cohort;
  return v_code;
end $$;

-- 시연 계정 초기화(기록·대화 삭제, 별칭 비움): select public.reset_participant('DEMO01');
create or replace function public.reset_participant(p_code text)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_n int;
begin
  select id into v_id from public.participants where code = upper(trim(p_code));
  if v_id is null then raise exception 'no such participant'; end if;
  delete from public.runs where participant_id = v_id;
  get diagnostics v_n = row_count;
  update public.participants set child_alias = null where id = v_id;
  return v_n;
end $$;

-- ───────────────────────── 테이블 권한 ─────────────────────────
-- 프로젝트 생성 시 「Automatically expose new tables」를 켰든 껐든 같은 결과가 되도록 명시한다.
--   · 참여자(anon/authenticated): 테이블 직접 접근 없음 — 아래 RPC로만
--   · 서버 함수(service_role): AI 대화 로그 기록·컨텍스트 읽기
revoke all on public.participants, public.runs, public.records, public.coach_turns,
              public.coach_reports, public.crisis_terms from anon, authenticated;
grant select, insert, update, delete on public.participants, public.runs, public.records, public.coach_turns,
              public.coach_reports, public.crisis_terms to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ───────────────────────── 실행 권한 ─────────────────────────

revoke all on function public.current_participant_id()                   from public, anon, authenticated;
revoke all on function public.require_participant()                      from public, anon, authenticated;
revoke all on function public.claim_participant(text, text)              from public, anon;
revoke all on function public.me()                                       from public, anon;
revoke all on function public.set_child_alias(text)                      from public, anon;
revoke all on function public.start_run(int)                             from public, anon;
revoke all on function public.save_record(uuid, text, jsonb)             from public, anon;
revoke all on function public.complete_run(uuid)                         from public, anon;
revoke all on function public.latest_record(int, text)                   from public, anon;
revoke all on function public.my_status()                                from public, anon;
revoke all on function public.report_turn(bigint, text)                  from public, anon;
revoke all on function public.create_participant(text, text, text)       from public, anon, authenticated;
revoke all on function public.reset_participant(text)                    from public, anon, authenticated;

grant execute on function public.claim_participant(text, text)  to authenticated;
grant execute on function public.me()                           to authenticated;
grant execute on function public.set_child_alias(text)          to authenticated;
grant execute on function public.start_run(int)                 to authenticated;
grant execute on function public.save_record(uuid, text, jsonb) to authenticated;
grant execute on function public.complete_run(uuid)             to authenticated;
grant execute on function public.latest_record(int, text)       to authenticated;
grant execute on function public.my_status()                    to authenticated;
grant execute on function public.report_turn(bigint, text)      to authenticated;

-- ───────────────────── 연구자 점검용 뷰(API 비노출) ─────────────────────
-- 주 1회 점검(연구계획서 Ⅲ-4.3): SQL Editor에서  select * from research.coach_log;

create schema if not exists research;
revoke all on schema research from public, anon, authenticated;

create or replace view research.coach_log with (security_invoker = true) as
select t.created_at,
       p.code                                   as participant,
       t.day,
       t.turn,
       t.kind,
       t.user_input,
       t.ai_output,
       t.source,
       t.violations,
       t.flagged,
       exists (select 1 from public.coach_reports c where c.turn_id = t.id) as reported,
       t.llm_output,
       t.model,
       t.edge_region,
       t.latency_ms,
       t.run_id,
       t.id                                     as turn_id
  from public.coach_turns t
  join public.participants p on p.id = t.participant_id
 order by t.created_at desc;

create or replace view research.session_log with (security_invoker = true) as
select p.code                                   as participant,
       r.day,
       r.started_at,
       r.completed_at,
       round(extract(epoch from (r.completed_at - r.started_at)) / 60.0, 1) as minutes,
       r.id                                     as run_id
  from public.runs r
  join public.participants p on p.id = r.participant_id
 order by r.started_at desc;

create or replace view research.reports with (security_invoker = true) as
select c.created_at, p.code as participant, t.day, t.turn, t.user_input, t.ai_output, t.source, c.note
  from public.coach_reports c
  join public.coach_turns  t on t.id = c.turn_id
  join public.participants p on p.id = c.participant_id
 order by c.created_at desc;
