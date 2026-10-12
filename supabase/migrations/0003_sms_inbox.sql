-- SMS inbox: transaction SMS waiting for review (pasted, shared, or sent by the Android helper app).
-- Nothing becomes a transaction until the user approves it in the app.

create table public.sms_inbox (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sender         text check (sender is null or length(sender) <= 60),
  body           text not null check (length(body) between 1 and 2000),
  received_at    timestamptz not null default now(),
  source         text not null default 'paste' check (source in ('paste','share','android')),
  hash           text not null check (length(hash) <= 120),
  status         text not null default 'pending' check (status in ('pending','imported','ignored')),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (user_id, hash)
);

create index sms_inbox_user_status_idx on public.sms_inbox (user_id, status, received_at desc);

alter table public.sms_inbox enable row level security;
create policy sms_inbox_owner on public.sms_inbox for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.sms_inbox from anon;

create or replace function public.check_sms_inbox() returns trigger
language plpgsql set search_path = public as $$
begin
  perform assert_owner('public.transactions', new.transaction_id, new.user_id);
  return new;
end $$;
create trigger sms_inbox_check before insert or update on public.sms_inbox
  for each row execute function public.check_sms_inbox();
