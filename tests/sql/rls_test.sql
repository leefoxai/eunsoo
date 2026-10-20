-- 마이그레이션 적용 후 권한·RLS·RPC 동작 확인. 기대와 다르면 예외를 던진다.
\set ON_ERROR_STOP on

select public.create_participant('demo01', 'demopass1', 'demo') as created;
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED ERROR (%) BUT SUCCEEDED: %', needle, sql;
exception when others then
  if position(needle in sqlerrm) = 0 then
    raise exception 'WRONG ERROR for %: got "%" expected "%"', sql, sqlerrm, needle;
  end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to anon, authenticated;

-- ── 사용자 A(익명 세션) ──
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

do $$ begin
  if (select count(*) from public.participants) <> 0 then raise exception 'participants leaked via RLS'; end if;
  if public.me() is not null then raise exception 'me() should be null before claim'; end if;
end $$;
select pg_temp.expect_error('select public.start_run(16)', 'not_logged_in');
select pg_temp.expect_error($q$select public.claim_participant('demo01', 'wrong')$q$, 'invalid_credentials');
select pg_temp.expect_error($q$select public.create_participant('X1', 'abcdefgh')$q$, 'permission denied');
select pg_temp.expect_error($q$select public.reset_participant('DEMO01')$q$, 'permission denied');
select pg_temp.expect_error($q$insert into public.coach_turns (run_id, participant_id, day, turn, kind, user_input, ai_output, source) values (gen_random_uuid(), gen_random_uuid(), 16, 2, 'answer', 'x', 'y', 'llm')$q$, 'row-level security');
select pg_temp.expect_error($q$select * from research.coach_log$q$, 'permission denied');

select public.claim_participant(' Demo01 ', 'demopass1') as claimed;
select public.set_child_alias('초록이') as alias_set;
select pg_temp.expect_error($q$select public.set_child_alias('열세글자가넘는아주긴별칭입니다')$q$, 'alias_too_long');

do $$
declare r uuid; v jsonb;
begin
  r := public.start_run(16);
  perform public.save_record(r, 'layers', '[{"cat":"성격","val":"조용함","unknown":false},{"cat":"가족의 형태","val":"","unknown":true}]');
  perform public.save_record(r, 'layers', '[{"cat":"성격","val":"조용함","unknown":false},{"cat":"가족의 형태","val":"","unknown":true},{"cat":"경제 형편","val":"","unknown":true}]');
  v := public.latest_record(16, 'layers');
  if jsonb_array_length(v) <> 3 then raise exception 'latest_record wrong: %', v; end if;
  perform public.complete_run(r);
  if (public.my_status()->0->>'completed')::int <> 1 then raise exception 'my_status wrong: %', public.my_status(); end if;
  perform set_config('test.run_a', r::text, false);
end $$;

-- ── 사용자 B: A의 기록에 접근 불가 ──
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
do $$ begin
  if public.latest_record(16, 'layers') is not null then raise exception 'B can read A record'; end if;
  if (select count(*) from public.runs) <> 0 then raise exception 'runs leaked via RLS'; end if;
  if (select count(*) from public.records) <> 0 then raise exception 'records leaked via RLS'; end if;
end $$;
select pg_temp.expect_error(format($q$select public.save_record(%L, 'x', '1')$q$, current_setting('test.run_a')), 'not_logged_in');

-- B가 같은 참여번호로 로그인하면(다른 기기) A 세션은 연결이 끊긴다
select public.claim_participant('DEMO01', 'demopass1') as claimed_by_b;
do $$ begin
  if jsonb_array_length(public.latest_record(16, 'layers')) <> 3 then raise exception 'B should see DEMO01 data after claim'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin
  if public.me() is not null then raise exception 'A should be detached'; end if;
end $$;

-- ── anon 역할은 RPC 실행 불가 ──
reset role;
set role anon;
select pg_temp.expect_error('select public.me()', 'permission denied');
select pg_temp.expect_error('select public.start_run(16)', 'permission denied');

-- ── 서버 함수(service role)는 로그 기록 가능, 연구자 뷰 확인 ──
reset role;
insert into public.coach_turns (run_id, participant_id, day, turn, kind, user_input, ai_output, source)
select r.id, r.participant_id, 16, 2, 'answer', '네', '‘네’ — 그렇게 들었습니다.', 'llm' from public.runs r limit 1;
select set_config('test.turn_id', (select max(id) from public.coach_turns)::text, false);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select public.report_turn(current_setting('test.turn_id')::bigint, '테스트 신고');
reset role;
do $$ begin
  if (select count(*) from research.coach_log where reported) <> 1 then raise exception 'report not visible in research.coach_log'; end if;
  if (select count(*) from research.session_log) <> 1 then raise exception 'session_log wrong'; end if;
end $$;
select public.reset_participant('demo01') as deleted_runs;
do $$ begin
  if (select count(*) from public.coach_turns) <> 0 then raise exception 'reset should cascade'; end if;
end $$;

select 'ALL SQL TESTS PASSED' as result;
