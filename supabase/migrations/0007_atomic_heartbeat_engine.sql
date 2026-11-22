-- Atomic practice-heartbeat accumulator.
-- Serializes writes per student and updates the session watermark plus daily
-- accumulator in one transaction.

create or replace function public.record_practice_heartbeat(
  p_student_id    uuid,
  p_session_id    uuid,
  p_assignment_id uuid,
  p_now           timestamptz,
  p_daily_cap     integer,
  p_per_beat_cap  integer,
  p_max_attempts  integer
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_session public.speaking_sessions%rowtype;
  v_elapsed integer;
  v_per_beat integer;
  v_remaining integer;
  v_credited integer;
  v_daily_total integer;
  v_attempt_number integer;
  v_used integer;
  v_assigned boolean;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_student_id::text, 0)
  );

  select * into v_session
  from public.speaking_sessions
  where id = p_session_id;

  if not found then
    v_attempt_number := null;

    if p_assignment_id is not null then
      select exists (
        select 1
        from public.student_assignments
        where student_id = p_student_id
          and assignment_id = p_assignment_id
      ) into v_assigned;

      if not v_assigned then
        raise exception 'ASSIGNMENT_NOT_ASSIGNED';
      end if;

      select count(*) into v_used
      from public.speaking_sessions
      where student_id = p_student_id
        and assignment_id = p_assignment_id;

      if v_used >= p_max_attempts then
        raise exception 'RETAKE_LIMIT_EXCEEDED'
          using detail = format('used=%s max=%s', v_used, p_max_attempts);
      end if;
      v_attempt_number := v_used + 1;
    end if;

    insert into public.speaking_sessions (
      id, student_id, assignment_id, attempt_number,
      seconds_accumulated, status, started_at, last_heartbeat_at
    ) values (
      p_session_id, p_student_id, p_assignment_id, v_attempt_number,
      0, 'active', p_now, p_now
    );

    select seconds_practiced into v_daily_total
    from public.practice_sessions
    where student_id = p_student_id
      and session_date = (p_now at time zone 'utc')::date;

    v_daily_total := coalesce(v_daily_total, 0);

    return jsonb_build_object(
      'creditedSeconds', 0,
      'sessionSeconds', 0,
      'dailyTotalSeconds', v_daily_total,
      'dailyGoalSeconds', 600,
      'dailyCapSeconds', p_daily_cap,
      'goalMet', v_daily_total >= 600,
      'dailyCapReached', v_daily_total >= p_daily_cap,
      'attemptNumber', v_attempt_number,
      'isNewSession', true,
      'intervalSeconds', 30
    );
  end if;

  if v_session.student_id <> p_student_id then
    raise exception 'SESSION_FORBIDDEN';
  end if;

  if v_session.assignment_id is distinct from p_assignment_id then
    raise exception 'SESSION_FORBIDDEN';
  end if;

  if v_session.status = 'ended' then
    raise exception 'SESSION_ENDED';
  end if;

  if p_now > v_session.last_heartbeat_at then
    v_elapsed := floor(
      extract(epoch from (p_now - v_session.last_heartbeat_at))
    )::integer;
  else
    v_elapsed := 0;
  end if;
  v_per_beat := least(v_elapsed, p_per_beat_cap);

  select seconds_practiced into v_daily_total
  from public.practice_sessions
  where student_id = p_student_id
    and session_date = (p_now at time zone 'utc')::date;
  v_daily_total := coalesce(v_daily_total, 0);

  v_remaining := greatest(0, p_daily_cap - v_daily_total);
  v_credited := least(v_per_beat, v_remaining);

  update public.speaking_sessions
  set seconds_accumulated = v_session.seconds_accumulated + v_credited,
      last_heartbeat_at = greatest(v_session.last_heartbeat_at, p_now)
  where id = p_session_id;

  v_daily_total := v_daily_total + v_credited;

  if v_credited > 0 then
    insert into public.practice_sessions (
      student_id, seconds_practiced, session_date
    ) values (
      p_student_id,
      v_daily_total,
      (p_now at time zone 'utc')::date
    )
    on conflict (student_id, session_date)
    do update set seconds_practiced = excluded.seconds_practiced;
  end if;

  return jsonb_build_object(
    'creditedSeconds', v_credited,
    'sessionSeconds', v_session.seconds_accumulated + v_credited,
    'dailyTotalSeconds', v_daily_total,
    'dailyGoalSeconds', 600,
    'dailyCapSeconds', p_daily_cap,
    'goalMet', v_daily_total >= 600,
    'dailyCapReached', v_daily_total >= p_daily_cap,
    'attemptNumber', v_session.attempt_number,
    'isNewSession', false,
    'intervalSeconds', 30
  );
end;
$$;

revoke all on function public.record_practice_heartbeat(
  uuid, uuid, uuid, timestamptz, integer, integer, integer
) from public;
revoke all on function public.record_practice_heartbeat(
  uuid, uuid, uuid, timestamptz, integer, integer, integer
) from anon, authenticated;
grant execute on function public.record_practice_heartbeat(
  uuid, uuid, uuid, timestamptz, integer, integer, integer
) to service_role;
