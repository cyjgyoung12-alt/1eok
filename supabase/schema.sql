-- 1억 모으기 익명 키 동기화 스키마
-- Supabase 대시보드 → SQL Editor에 전체를 붙여넣고 Run 한 번이면 끝.
-- 테이블 직접 접근은 전부 차단하고, sync_push / sync_pull 함수로만 읽고 쓴다.
-- 동기화 키(sync_key)를 아는 쪽만 자기 행에 접근할 수 있다.

create table if not exists public.sync_states (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.sync_states enable row level security;
-- 정책을 만들지 않는다: anon의 직접 select/insert/update/delete 전부 거부
revoke all on table public.sync_states from anon, authenticated;

create or replace function public.sync_push(sync_key text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(sync_key) < 20 then
    raise exception 'invalid key';
  end if;
  if pg_column_size(payload) > 1048576 then
    raise exception 'payload too large';
  end if;
  insert into public.sync_states as s (key, data, updated_at)
  values (sync_key, payload, now())
  on conflict (key) do update set data = excluded.data, updated_at = now();
end;
$$;

create or replace function public.sync_pull(sync_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select data from public.sync_states where key = sync_key;
$$;

revoke all on function public.sync_push(text, jsonb) from public;
revoke all on function public.sync_pull(text) from public;
grant execute on function public.sync_push(text, jsonb) to anon;
grant execute on function public.sync_pull(text) to anon;
