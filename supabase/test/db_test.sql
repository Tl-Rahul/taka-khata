-- Database-level tests: RLS isolation, integrity rules, bootstrap and restore.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase_stub.sql -f ../migrations/0001_init.sql -f db_test.sql
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, false);
end $$;

-- expect a statement to fail
create or replace function pg_temp.expect_fail(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok (rejected): % -> %', label, sqlerrm;
    return;
  end;
  raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', label;
end $$;

create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'CHECK FAILED: %', label; end if;
  raise notice 'ok: %', label;
end $$;

grant execute on all functions in schema pg_temp to authenticated;

-- ===== user A =====
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select bootstrap_user();
select bootstrap_user(); -- idempotent
select pg_temp.check((select count(*) from categories) > 40, 'categories seeded once');
select pg_temp.check((select count(*) from categories where system_key is not null) = 3, 'system categories');
select pg_temp.check((select count(*) from profiles) = 1, 'profile created');

insert into accounts (id, name, type, opening_balance) values
  ('a0000000-0000-0000-0000-000000000001', 'Cash', 'cash', 1000),
  ('a0000000-0000-0000-0000-000000000002', 'bKash', 'bkash', 500);
insert into contacts (id, name) values ('c0000000-0000-0000-0000-000000000001', 'Karim');

-- income with income category OK
insert into transactions (type, date, amount, account_id, category_id)
select 'income', '2026-10-01', 5000, 'a0000000-0000-0000-0000-000000000001', id
from categories where name = 'Salary';

-- expense must use expense category
select pg_temp.expect_fail($$insert into transactions (type, date, amount, account_id, category_id)
  select 'expense', '2026-10-01', 10, 'a0000000-0000-0000-0000-000000000001', id from categories where name='Salary'$$,
  'expense with income category');
select pg_temp.expect_fail($$insert into transactions (type, date, amount, account_id)
  values ('expense', '2026-10-01', 10, 'a0000000-0000-0000-0000-000000000001')$$, 'expense without category');
select pg_temp.expect_fail($$insert into transactions (type, date, amount, account_id, category_id)
  select 'expense', '2026-10-01', -5, 'a0000000-0000-0000-0000-000000000001', id from categories where name='Groceries'$$,
  'negative expense');
select pg_temp.expect_fail($$insert into transactions (type, date, amount, account_id, to_account_id)
  values ('transfer', '2026-10-01', 10, 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001')$$,
  'transfer to same account');
select pg_temp.expect_fail($$insert into transactions (type, date, amount, account_id, category_id)
  select 'transfer', '2026-10-01', 10, 'a0000000-0000-0000-0000-000000000001', id from categories where name='Groceries'$$,
  'transfer without destination');
select pg_temp.expect_fail($$insert into transactions (type, date, amount, account_id)
  values ('borrow', '2026-10-01', 10, 'a0000000-0000-0000-0000-000000000001')$$, 'borrow without loan');

insert into loans (id, direction, contact_id, start_date) values
  ('10000000-0000-0000-0000-000000000001', 'borrowed', 'c0000000-0000-0000-0000-000000000001', '2026-09-01'),
  ('10000000-0000-0000-0000-000000000002', 'lent', 'c0000000-0000-0000-0000-000000000001', '2026-09-01');
insert into transactions (type, date, amount, account_id, loan_id)
  values ('borrow', '2026-09-01', 2000, 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
select pg_temp.expect_fail($$insert into transactions (type, date, amount, account_id, loan_id)
  values ('lend', '2026-09-01', 10, 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$,
  'lend against a borrowed loan');
-- interest-only repayment allowed
insert into transactions (type, date, amount, interest, account_id, loan_id)
  values ('debt_repayment', '2026-10-01', 0, 50, 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
select pg_temp.expect_fail($$insert into transactions (type, date, amount, interest, account_id, loan_id)
  values ('debt_repayment', '2026-10-01', 0, 0, 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$,
  'zero repayment');
select pg_temp.expect_fail($$insert into transactions (type, date, amount, interest, account_id, category_id)
  select 'income', '2026-10-01', 10, 5, 'a0000000-0000-0000-0000-000000000001', id from categories where name='Salary'$$,
  'interest on plain income');
select pg_temp.expect_fail($$update loans set direction = 'lent' where id = '10000000-0000-0000-0000-000000000001'$$,
  'change loan direction after payments');

-- recurring: one payment per occurrence
insert into recurring (id, kind, name, amount, frequency, start_date, account_id, category_id)
select 'b0000000-0000-0000-0000-000000000001', 'expense', 'Internet', 1200, 'monthly', '2026-01-05',
       'a0000000-0000-0000-0000-000000000001', id from categories where name = 'Internet';
insert into transactions (type, date, amount, account_id, category_id, recurring_id, occurrence_date)
select 'expense', '2026-10-05', 1200, 'a0000000-0000-0000-0000-000000000001', id,
       'b0000000-0000-0000-0000-000000000001', '2026-10-05' from categories where name = 'Internet';
select pg_temp.expect_fail($$insert into transactions (type, date, amount, account_id, category_id, recurring_id, occurrence_date)
  select 'expense', '2026-10-06', 1200, 'a0000000-0000-0000-0000-000000000001', id,
       'b0000000-0000-0000-0000-000000000001', '2026-10-05' from categories where name = 'Internet'$$,
  'bill occurrence paid twice');

-- refunds only of expenses
insert into transactions (id, type, date, amount, account_id, category_id)
select 'e0000000-0000-0000-0000-000000000001', 'expense', '2026-10-02', 800, 'a0000000-0000-0000-0000-000000000001', id
from categories where name = 'Clothing';
insert into transactions (type, date, amount, account_id, category_id, refund_of)
select 'refund', '2026-10-03', 300, 'a0000000-0000-0000-0000-000000000002', id, 'e0000000-0000-0000-0000-000000000001'
from categories where name = 'Clothing';

-- category rules
select pg_temp.expect_fail($$insert into categories (kind, name, parent_id)
  select 'expense', 'Deep', id from categories where name = 'Groceries'$$, 'three category levels');
select pg_temp.expect_fail($$insert into categories (kind, name, parent_id)
  select 'income', 'Mismatch', id from categories where name = 'Shopping'$$, 'subcategory kind mismatch');
select pg_temp.expect_fail($$delete from categories where name = 'Clothing'$$, 'delete used category');
select pg_temp.expect_fail($$delete from accounts where name = 'Cash'$$, 'delete account with transactions');

-- budgets
insert into budgets (month, category_id, amount) values ('2026-10-01', null, 20000);
select pg_temp.expect_fail($$insert into budgets (month, category_id, amount) values ('2026-10-01', null, 1)$$, 'duplicate overall budget');
select pg_temp.expect_fail($$insert into budgets (month, category_id, amount) values ('2026-10-15', null, 1)$$, 'budget month not first day');

-- ===== user B: isolation =====
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select bootstrap_user();
select pg_temp.check((select count(*) from accounts) = 0, 'B cannot see A accounts');
select pg_temp.check((select count(*) from transactions) = 0, 'B cannot see A transactions');
select pg_temp.check((select count(*) from profiles) = 1, 'B sees only own profile');
select pg_temp.expect_fail($$insert into transactions (type, date, amount, account_id, category_id)
  select 'expense', '2026-10-01', 10, 'a0000000-0000-0000-0000-000000000001', id from categories where name = 'Groceries'$$,
  'B writes to A account');
select pg_temp.expect_fail($$insert into accounts (user_id, name, type) values ('11111111-1111-1111-1111-111111111111', 'x', 'cash')$$,
  'B inserts row owned by A');
update accounts set name = 'hacked'; -- affects nothing
delete from transactions;             -- affects nothing

-- ===== anon =====
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_temp.expect_fail($$select count(*) from transactions$$, 'anon reads transactions');
select pg_temp.expect_fail($$select bootstrap_user()$$, 'anon bootstrap');
reset role;
select pg_temp.check((select count(*) from accounts where name = 'hacked') = 0, 'A data untouched by B');
select pg_temp.check((select count(*) from transactions where user_id = '11111111-1111-1111-1111-111111111111') = 6, 'A transactions intact');

-- ===== restore roundtrip for A =====
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
create temp table snap as select jsonb_build_object(
  'app', 'personal-finance', 'version', 1,
  'profile', (select to_jsonb(p) from profiles p),
  'contacts', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from contacts t),
  'accounts', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from accounts t),
  'categories', (select coalesce(jsonb_agg(to_jsonb(t) order by parent_id nulls last), '[]') from categories t),
  'loans', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from loans t),
  'recurring', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from recurring t),
  'transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by refund_of nulls last), '[]') from transactions t),
  'budgets', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from budgets t),
  'goals', '[]'::jsonb, 'goal_entries', '[]'::jsonb, 'holdings', '[]'::jsonb, 'holding_valuations', '[]'::jsonb
) as j;
-- reversed order to prove the restore does its own ordering
update snap set j = jsonb_set(j, '{categories}', (select jsonb_agg(e order by e->>'parent_id' nulls last) from jsonb_array_elements(j->'categories') e));
update snap set j = jsonb_set(j, '{transactions}', (select jsonb_agg(e order by e->>'refund_of' nulls last) from jsonb_array_elements(j->'transactions') e));
delete from transactions where type = 'income';
select restore_backup((select j from snap));
select pg_temp.check((select count(*) from transactions) = 6, 'restore brings back all transactions');
select pg_temp.check((select count(*) from categories) > 40, 'restore categories with parents');
select pg_temp.expect_fail($$select restore_backup('{"app":"other"}')$$, 'restore rejects foreign file');
-- tampered backup trying to write into user B is rewritten to the caller
select restore_backup(jsonb_set((select j from snap), '{contacts,0,user_id}', '"22222222-2222-2222-2222-222222222222"'));
reset role;
select pg_temp.check((select count(*) from contacts where user_id = '22222222-2222-2222-2222-222222222222') = 0, 'restore cannot write other users data');
select pg_temp.check((select count(*) from transactions where user_id = '11111111-1111-1111-1111-111111111111') = 6, 'second restore idempotent');
-- backups produced by the app omit updated_at (and may omit created_at)
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
update snap set j = (
  select jsonb_object_agg(k, case when jsonb_typeof(v) = 'array'
           then (select coalesce(jsonb_agg(x - 'updated_at' - 'created_at'), '[]') from jsonb_array_elements(v) x) else v end)
  from jsonb_each(j) as t(k, v));
select restore_backup((select j from snap));
reset role;
select pg_temp.check((select count(*) from transactions where user_id = '11111111-1111-1111-1111-111111111111' and updated_at is not null) = 6, 'restore fills missing timestamps');

\echo ALL DB TESTS PASSED
