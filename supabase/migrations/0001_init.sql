-- Personal Finance Manager — core schema
-- Run in Supabase SQL editor (or `supabase db push`). Safe to run once on a fresh project.
--
-- Design notes
-- * Account balances are NEVER stored. They are derived from opening_balance + transactions,
--   so editing or deleting any transaction can never leave a stale balance behind.
-- * Every row belongs to one auth user (user_id) and Row Level Security restricts all access
--   to the owner. Cross-user references are blocked by ownership triggers.
-- * Money is numeric(14,2) (no floating point).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Raises if `rid` is not a row owned by `uid` in table `tbl`.
create or replace function public.assert_owner(tbl regclass, rid uuid, uid uuid) returns void
language plpgsql set search_path = public as $$
declare ok boolean;
begin
  if rid is null then return; end if;
  execute format('select exists(select 1 from %s where id = $1 and user_id = $2)', tbl)
    into ok using rid, uid;
  if not ok then
    raise exception 'Invalid reference: % % does not exist', tbl, rid using errcode = '23503';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- profiles (preferences)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text check (display_name is null or length(display_name) <= 80),
  locale        text not null default 'bn' check (locale in ('bn','en')),
  currency      text not null default 'BDT' check (length(currency) = 3),
  date_format   text not null default 'dd/MM/yyyy'
                check (date_format in ('dd/MM/yyyy','MM/dd/yyyy','yyyy-MM-dd','d MMM yyyy')),
  bangla_digits boolean not null default true,
  theme         text not null default 'system' check (theme in ('light','dark','system')),
  week_start    smallint not null default 6 check (week_start between 0 and 6),
  reminders     jsonb not null default
    '{"bills":true,"installments":true,"receivables":true,"budgets":true,"browser":false,"days_before":3}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- contacts (people, banks, lenders, borrowers)
-- ---------------------------------------------------------------------------
create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 120),
  kind       text not null default 'person' check (kind in ('person','bank','institution','other')),
  phone      text check (phone is null or length(phone) <= 30),
  notes      text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- accounts & wallets
-- ---------------------------------------------------------------------------
create table public.accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 80),
  type            text not null check (type in ('cash','bank','bkash','nagad','rocket','mfs_other',
                                                 'savings','fixed_deposit','credit_card','investment','other')),
  institution     text check (institution is null or length(institution) <= 120),
  last4           text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  -- Opening balance as of opening_date. For credit cards a negative number = amount owed.
  opening_balance numeric(14,2) not null default 0,
  opening_date    date not null default current_date,
  credit_limit    numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  is_liquid       boolean not null default true,
  maturity_date   date,
  interest_rate   numeric(7,3) check (interest_rate is null or interest_rate between 0 and 1000),
  color           text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order      int not null default 0,
  archived        boolean not null default false,
  notes           text check (notes is null or length(notes) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- categories (two levels: category -> subcategory)
-- ---------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('income','expense')),
  name        text not null check (length(btrim(name)) between 1 and 60),
  name_bn     text check (name_bn is null or length(name_bn) <= 60),
  parent_id   uuid references public.categories(id) on delete restrict,
  color       text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  icon        text check (icon is null or length(icon) <= 40),
  -- system categories used by the accounting rules: interest_paid, fees, interest_received
  system_key  text check (system_key is null or system_key in ('interest_paid','fees','interest_received')),
  sort_order  int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, system_key),
  check (parent_id is null or parent_id <> id)
);

-- ---------------------------------------------------------------------------
-- loans: money I owe (borrowed) and money owed to me (lent)
-- Principal outstanding = opening_principal + borrow/lend txns - principal repaid/collected
-- ---------------------------------------------------------------------------
create table public.loans (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,
  direction              text not null check (direction in ('borrowed','lent')),
  contact_id             uuid not null references public.contacts(id) on delete restrict,
  title                  text check (title is null or length(title) <= 120),
  -- Pre-existing balance when you start using the app (no cash movement recorded).
  opening_principal      numeric(14,2) not null default 0 check (opening_principal >= 0),
  opening_interest_due   numeric(14,2) not null default 0 check (opening_interest_due >= 0),
  start_date             date not null,
  due_date               date,
  interest_type          text not null default 'none' check (interest_type in ('none','fixed','simple_annual')),
  interest_rate          numeric(7,3) check (interest_rate is null or interest_rate between 0 and 1000),
  fixed_interest         numeric(14,2) check (fixed_interest is null or fixed_interest >= 0),
  installment_amount     numeric(14,2) check (installment_amount is null or installment_amount > 0),
  installment_frequency  text check (installment_frequency is null or installment_frequency in ('weekly','monthly','quarterly','yearly')),
  installment_count      int check (installment_count is null or installment_count between 1 and 1200),
  first_installment_date date,
  notes                  text check (notes is null or length(notes) <= 2000),
  closed                 boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (due_date is null or due_date >= start_date),
  check (interest_type <> 'simple_annual' or interest_rate is not null),
  check (interest_type <> 'fixed' or fixed_interest is not null)
);

-- ---------------------------------------------------------------------------
-- recurring schedules (bills, subscriptions, salary ...)
-- An occurrence counts as paid ONLY when a transaction with (recurring_id, occurrence_date) exists.
-- ---------------------------------------------------------------------------
create table public.recurring (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind               text not null check (kind in ('income','expense')),
  name               text not null check (length(btrim(name)) between 1 and 120),
  amount             numeric(14,2) not null check (amount > 0),
  account_id         uuid references public.accounts(id) on delete set null,
  category_id        uuid references public.categories(id) on delete set null,
  contact_id         uuid references public.contacts(id) on delete set null,
  frequency          text not null check (frequency in ('weekly','monthly','quarterly','yearly')),
  interval_count     int not null default 1 check (interval_count between 1 and 52),
  start_date         date not null,
  end_date           date,
  skipped_dates      date[] not null default '{}',
  is_bill            boolean not null default true,
  remind_days_before int not null default 3 check (remind_days_before between 0 and 60),
  active             boolean not null default true,
  notes              text check (notes is null or length(notes) <= 2000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

-- ---------------------------------------------------------------------------
-- transactions: the single ledger for every money movement
--
-- account effect (account_id unless noted):
--   income          +amount - fee
--   expense         -amount
--   transfer        -amount - fee ; to_account_id +amount
--   borrow          +amount - fee         (creates liability, NOT income)
--   lend            -amount - fee         (creates receivable, NOT expense)
--   debt_repayment  -(amount + interest + fee)  amount = principal, interest/fee = expense
--   collection      +(amount + interest) - fee  amount = principal, interest = income
--   refund          +amount               (reduces expense of its category)
--   adjustment      +amount (signed)      (balance correction / revaluation, neither income nor expense)
-- ---------------------------------------------------------------------------
create table public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type            text not null check (type in ('income','expense','transfer','borrow','lend',
                                                 'debt_repayment','collection','refund','adjustment')),
  date            date not null check (date between '1970-01-01' and '2200-12-31'),
  amount          numeric(14,2) not null,
  interest        numeric(14,2) not null default 0 check (interest >= 0),
  fee             numeric(14,2) not null default 0 check (fee >= 0),
  account_id      uuid not null references public.accounts(id) on delete restrict,
  to_account_id   uuid references public.accounts(id) on delete restrict,
  category_id     uuid references public.categories(id) on delete restrict,
  contact_id      uuid references public.contacts(id) on delete set null,
  loan_id         uuid references public.loans(id) on delete cascade,
  recurring_id    uuid references public.recurring(id) on delete set null,
  occurrence_date date,
  refund_of       uuid references public.transactions(id) on delete set null,
  description     text check (description is null or length(description) <= 200),
  notes           text check (notes is null or length(notes) <= 2000),
  attachment_path text check (attachment_path is null or length(attachment_path) <= 400),
  import_hash     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint tx_amount_valid check (
    (type = 'adjustment' and amount <> 0 and interest = 0 and fee = 0)
    or (type <> 'adjustment' and amount >= 0 and amount + interest + fee > 0)),
  constraint tx_main_amount check (type in ('debt_repayment','collection','adjustment') or amount > 0),
  constraint tx_interest_only_loans check (interest = 0 or type in ('debt_repayment','collection')),
  constraint tx_fee_types check (fee = 0 or type in ('income','transfer','borrow','lend','debt_repayment','collection')),
  constraint tx_transfer_shape check (
    ((type = 'transfer') = (to_account_id is not null))
    and (to_account_id is null or to_account_id <> account_id)),
  constraint tx_loan_shape check ((type in ('borrow','lend','debt_repayment','collection')) = (loan_id is not null)),
  constraint tx_category_shape check (type not in ('income','expense','refund') or category_id is not null),
  constraint tx_category_types check (category_id is null or type in ('income','expense','refund')),
  constraint tx_recurring_shape check ((recurring_id is null) = (occurrence_date is null)),
  constraint tx_refund_shape check (refund_of is null or type = 'refund')
);

-- one payment per scheduled occurrence: a bill can't be marked paid twice
create unique index transactions_recurring_occurrence_uq
  on public.transactions (recurring_id, occurrence_date) where recurring_id is not null;
create index transactions_user_date_idx on public.transactions (user_id, date desc, created_at desc);
create index transactions_account_idx on public.transactions (account_id);
create index transactions_to_account_idx on public.transactions (to_account_id) where to_account_id is not null;
create index transactions_loan_idx on public.transactions (loan_id) where loan_id is not null;
create index transactions_category_idx on public.transactions (category_id) where category_id is not null;
create index transactions_import_hash_idx on public.transactions (user_id, import_hash) where import_hash is not null;

-- ---------------------------------------------------------------------------
-- budgets: one row per month per category (category_id null = overall budget)
-- ---------------------------------------------------------------------------
create table public.budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  category_id uuid references public.categories(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique nulls not distinct (user_id, month, category_id)
);

-- ---------------------------------------------------------------------------
-- savings goals: allocations of money you already hold (never added to assets)
-- ---------------------------------------------------------------------------
create table public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 80),
  target_amount numeric(14,2) not null check (target_amount > 0),
  target_date   date,
  account_id    uuid references public.accounts(id) on delete set null,
  color         text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  icon          text check (icon is null or length(icon) <= 40),
  archived      boolean not null default false,
  notes         text check (notes is null or length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.goal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id    uuid not null references public.goals(id) on delete cascade,
  date       date not null,
  amount     numeric(14,2) not null check (amount <> 0), -- + contribution, - withdrawal
  notes      text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- other assets & liabilities with manual valuations (property, gold, shares, unpaid dues ...)
-- ---------------------------------------------------------------------------
create table public.holdings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('asset','liability')),
  name       text not null check (length(btrim(name)) between 1 and 120),
  category   text not null default 'other' check (category in
               ('investment','property','vehicle','gold','business','provident_fund','other',
                'bill','tax','loan','other_liability')),
  is_liquid  boolean not null default false,
  archived   boolean not null default false,
  notes      text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.holding_valuations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  holding_id uuid not null references public.holdings(id) on delete cascade,
  date       date not null,
  value      numeric(14,2) not null check (value >= 0),
  notes      text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  unique (holding_id, date)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','contacts','accounts','categories','loans','recurring',
                           'transactions','budgets','goals','holdings'] loop
    execute format('create trigger %I_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- integrity triggers: references must belong to the same user, kinds must match
-- ---------------------------------------------------------------------------
create or replace function public.check_category() returns trigger
language plpgsql set search_path = public as $$
declare p record;
begin
  if new.parent_id is not null then
    select * into p from categories where id = new.parent_id and user_id = new.user_id;
    if not found then raise exception 'Parent category not found' using errcode = '23503'; end if;
    if p.parent_id is not null then raise exception 'Only two category levels are allowed' using errcode = '23514'; end if;
    if p.kind <> new.kind then raise exception 'Subcategory kind must match its parent' using errcode = '23514'; end if;
    if exists (select 1 from categories c where c.parent_id = new.id) then
      raise exception 'A category with subcategories cannot become a subcategory' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.kind <> old.kind then
    if exists (select 1 from categories c where c.parent_id = new.id) then
      raise exception 'Category has subcategories; its type cannot change' using errcode = '23514';
    end if;
    if exists (select 1 from transactions where category_id = new.id) then
      raise exception 'Category is used by transactions; its type cannot change' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger categories_check before insert or update on public.categories
  for each row execute function public.check_category();

create or replace function public.check_loan() returns trigger
language plpgsql set search_path = public as $$
begin
  perform assert_owner('public.contacts', new.contact_id, new.user_id);
  if tg_op = 'UPDATE' and new.direction <> old.direction
     and exists (select 1 from transactions where loan_id = new.id) then
    raise exception 'Loan direction cannot change after payments are recorded' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger loans_check before insert or update on public.loans
  for each row execute function public.check_loan();

create or replace function public.check_recurring() returns trigger
language plpgsql set search_path = public as $$
declare k text;
begin
  perform assert_owner('public.accounts', new.account_id, new.user_id);
  perform assert_owner('public.contacts', new.contact_id, new.user_id);
  if new.category_id is not null then
    select kind into k from categories where id = new.category_id and user_id = new.user_id;
    if k is null then raise exception 'Category not found' using errcode = '23503'; end if;
    if k <> new.kind then raise exception 'Category type does not match schedule type' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger recurring_check before insert or update on public.recurring
  for each row execute function public.check_recurring();

create or replace function public.check_transaction() returns trigger
language plpgsql set search_path = public as $$
declare k text; d text; r record;
begin
  perform assert_owner('public.accounts', new.account_id, new.user_id);
  perform assert_owner('public.accounts', new.to_account_id, new.user_id);
  perform assert_owner('public.contacts', new.contact_id, new.user_id);

  if new.category_id is not null then
    select kind into k from categories where id = new.category_id and user_id = new.user_id;
    if k is null then raise exception 'Category not found' using errcode = '23503'; end if;
    if (new.type = 'income' and k <> 'income') or (new.type in ('expense','refund') and k <> 'expense') then
      raise exception 'Category type does not match transaction type' using errcode = '23514';
    end if;
  end if;

  if new.loan_id is not null then
    select direction into d from loans where id = new.loan_id and user_id = new.user_id;
    if d is null then raise exception 'Loan not found' using errcode = '23503'; end if;
    if (new.type in ('borrow','debt_repayment') and d <> 'borrowed')
       or (new.type in ('lend','collection') and d <> 'lent') then
      raise exception 'Transaction type does not match loan direction' using errcode = '23514';
    end if;
  end if;

  if new.recurring_id is not null then
    select kind, user_id into r from recurring where id = new.recurring_id;
    if r.user_id is distinct from new.user_id then raise exception 'Schedule not found' using errcode = '23503'; end if;
    if r.kind <> new.type then raise exception 'Transaction type does not match schedule' using errcode = '23514'; end if;
  end if;

  if new.refund_of is not null then
    select type, user_id into r from transactions where id = new.refund_of;
    if r.user_id is distinct from new.user_id then raise exception 'Original transaction not found' using errcode = '23503'; end if;
    if r.type <> 'expense' then raise exception 'Only expenses can be refunded' using errcode = '23514'; end if;
    if new.refund_of = new.id then raise exception 'A refund cannot refer to itself' using errcode = '23514'; end if;
  end if;

  if new.attachment_path is not null and split_part(new.attachment_path, '/', 1) <> new.user_id::text then
    raise exception 'Invalid attachment path' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger transactions_check before insert or update on public.transactions
  for each row execute function public.check_transaction();

create or replace function public.check_simple_refs() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'budgets' then
    if new.category_id is not null and not exists
      (select 1 from categories where id = new.category_id and user_id = new.user_id and kind = 'expense') then
      raise exception 'Budgets need an expense category' using errcode = '23514';
    end if;
  elsif tg_table_name = 'goals' then
    perform assert_owner('public.accounts', new.account_id, new.user_id);
  elsif tg_table_name = 'goal_entries' then
    perform assert_owner('public.goals', new.goal_id, new.user_id);
  elsif tg_table_name = 'holding_valuations' then
    perform assert_owner('public.holdings', new.holding_id, new.user_id);
  end if;
  return new;
end $$;
create trigger budgets_check before insert or update on public.budgets
  for each row execute function public.check_simple_refs();
create trigger goals_check before insert or update on public.goals
  for each row execute function public.check_simple_refs();
create trigger goal_entries_check before insert or update on public.goal_entries
  for each row execute function public.check_simple_refs();
create trigger holding_valuations_check before insert or update on public.holding_valuations
  for each row execute function public.check_simple_refs();

-- ---------------------------------------------------------------------------
-- Row Level Security: owner-only access on every table
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy profiles_owner on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['contacts','accounts','categories','loans','recurring','transactions',
                           'budgets','goals','goal_entries','holdings','holding_valuations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
                   t || '_owner', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
revoke all on public.profiles from anon;

-- ---------------------------------------------------------------------------
-- bootstrap: create profile + default categories for the signed-in user (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_user() returns void
language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  seed jsonb;
  p jsonb; c jsonb; pid uuid; i int := 0; j int;
begin
  if uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('bootstrap:' || uid::text));
  insert into profiles (id) values (uid) on conflict (id) do nothing;
  if exists (select 1 from categories where user_id = uid) then return; end if;

  seed := $json$[
    {"k":"expense","n":"Food & Dining","bn":"খাবার-দাবার","c":"#E07A1F","i":"utensils",
     "sub":[["Groceries","বাজার-সদাই"],["Restaurants","রেস্টুরেন্ট"],["Snacks & Tea","নাস্তা ও চা"]]},
    {"k":"expense","n":"Rent & Housing","bn":"বাসা ভাড়া ও বাসস্থান","c":"#7C5CC4","i":"home",
     "sub":[["Rent","বাসা ভাড়া"],["Service charge","সার্ভিস চার্জ"],["Repairs","মেরামত"]]},
    {"k":"expense","n":"Transport","bn":"যাতায়াত","c":"#2F80C0","i":"bus",
     "sub":[["Rickshaw & CNG","রিকশা ও সিএনজি"],["Ride sharing","রাইড শেয়ার"],["Bus & Train","বাস ও ট্রেন"],["Fuel","জ্বালানি"]]},
    {"k":"expense","n":"Shopping","bn":"কেনাকাটা","c":"#C2417A","i":"shopping-bag",
     "sub":[["Clothing","পোশাক"],["Electronics","ইলেকট্রনিক্স"],["Household","গৃহস্থালি"]]},
    {"k":"expense","n":"Healthcare","bn":"চিকিৎসা","c":"#D64545","i":"heart-pulse",
     "sub":[["Doctor","ডাক্তার"],["Medicine","ওষুধ"],["Tests","টেস্ট"]]},
    {"k":"expense","n":"Bills & Utilities","bn":"বিল ও ইউটিলিটি","c":"#1F9D8B","i":"zap",
     "sub":[["Electricity","বিদ্যুৎ"],["Gas","গ্যাস"],["Water","পানি"],["Internet","ইন্টারনেট"],["Mobile recharge","মোবাইল রিচার্জ"]]},
    {"k":"expense","n":"Subscriptions","bn":"সাবস্ক্রিপশন","c":"#5B6CD8","i":"repeat","sub":[]},
    {"k":"expense","n":"Family","bn":"পরিবার","c":"#B8862B","i":"users",
     "sub":[["Family support","পরিবারকে সহায়তা"],["Children","সন্তান"]]},
    {"k":"expense","n":"Education","bn":"শিক্ষা","c":"#3D8B3D","i":"graduation-cap","sub":[]},
    {"k":"expense","n":"Entertainment","bn":"বিনোদন","c":"#9B51E0","i":"film","sub":[]},
    {"k":"expense","n":"Personal care","bn":"ব্যক্তিগত যত্ন","c":"#E36FA3","i":"sparkles","sub":[]},
    {"k":"expense","n":"Gifts & Charity","bn":"উপহার ও দান","c":"#4C9F70","i":"gift",
     "sub":[["Gifts","উপহার"],["Zakat & Charity","যাকাত ও দান"]]},
    {"k":"expense","n":"Travel","bn":"ভ্রমণ","c":"#0E8FA8","i":"plane","sub":[]},
    {"k":"expense","n":"Other expense","bn":"অন্যান্য খরচ","c":"#7A8580","i":"circle","sub":[]},
    {"k":"expense","n":"Interest paid","bn":"পরিশোধিত সুদ","c":"#A33B3B","i":"percent","sk":"interest_paid","sub":[]},
    {"k":"expense","n":"Fees & Charges","bn":"ফি ও চার্জ","c":"#8A6A55","i":"receipt","sk":"fees","sub":[]},
    {"k":"income","n":"Salary","bn":"বেতন","c":"#0B6E4F","i":"briefcase","sub":[["Basic salary","মূল বেতন"],["Bonus","বোনাস"]]},
    {"k":"income","n":"Business","bn":"ব্যবসা","c":"#1D7F5F","i":"store","sub":[]},
    {"k":"income","n":"Freelance","bn":"ফ্রিল্যান্স","c":"#2E8C6A","i":"laptop","sub":[]},
    {"k":"income","n":"Investment returns","bn":"বিনিয়োগ আয়","c":"#3E9A74","i":"trending-up","sub":[]},
    {"k":"income","n":"Rent received","bn":"ভাড়া আয়","c":"#4FA77E","i":"key","sub":[]},
    {"k":"income","n":"Gifts received","bn":"প্রাপ্ত উপহার","c":"#5FB488","i":"gift","sub":[]},
    {"k":"income","n":"Other income","bn":"অন্যান্য আয়","c":"#6FC192","i":"circle","sub":[]},
    {"k":"income","n":"Interest received","bn":"প্রাপ্ত সুদ","c":"#127A55","i":"percent","sk":"interest_received","sub":[]}
  ]$json$::jsonb;

  for p in select value from jsonb_array_elements(seed) loop
    i := i + 1;
    insert into categories (user_id, kind, name, name_bn, color, icon, system_key, sort_order)
    values (uid, p->>'k', p->>'n', p->>'bn', p->>'c', p->>'i', p->>'sk', i)
    returning id into pid;
    j := 0;
    for c in select value from jsonb_array_elements(coalesce(p->'sub', '[]'::jsonb)) loop
      j := j + 1;
      insert into categories (user_id, kind, name, name_bn, parent_id, sort_order)
      values (uid, p->>'k', c->>0, c->>1, pid, j);
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- restore_backup: atomically replace ALL of the caller's data with a backup payload.
-- Runs in one transaction: either everything is restored or nothing changes.
-- ---------------------------------------------------------------------------
-- Forces ownership to the caller and fills timestamps a backup may omit.
create or replace function public._with_uid(arr jsonb, uid uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('created_at', now(), 'updated_at', now())
           || jsonb_strip_nulls(jsonb_build_object('created_at', e->'created_at', 'updated_at', e->'updated_at'))
           || (e - 'created_at' - 'updated_at')
           || jsonb_build_object('user_id', uid)), '[]'::jsonb)
  from jsonb_array_elements(coalesce(arr, '[]'::jsonb)) e
$$;

create or replace function public.restore_backup(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); counts jsonb;
begin
  if uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if payload->>'app' is distinct from 'personal-finance' then
    raise exception 'This file is not a backup from this app' using errcode = '22023';
  end if;

  delete from transactions where user_id = uid;
  delete from budgets where user_id = uid;
  delete from goal_entries where user_id = uid;
  delete from goals where user_id = uid;
  delete from holding_valuations where user_id = uid;
  delete from holdings where user_id = uid;
  delete from recurring where user_id = uid;
  delete from loans where user_id = uid;
  delete from categories where user_id = uid;
  delete from accounts where user_id = uid;
  delete from contacts where user_id = uid;

  if payload ? 'profile' and jsonb_typeof(payload->'profile') = 'object' then
    insert into profiles (id) values (uid) on conflict (id) do nothing;
    update profiles p set
      display_name  = r.display_name,
      locale        = coalesce(r.locale, p.locale),
      date_format   = coalesce(r.date_format, p.date_format),
      bangla_digits = coalesce(r.bangla_digits, p.bangla_digits),
      theme         = coalesce(r.theme, p.theme),
      week_start    = coalesce(r.week_start, p.week_start),
      reminders     = coalesce(r.reminders, p.reminders)
    from jsonb_populate_record(null::profiles, payload->'profile') r
    where p.id = uid;
  end if;

  insert into contacts select * from jsonb_populate_recordset(null::contacts, _with_uid(payload->'contacts', uid));
  insert into accounts select * from jsonb_populate_recordset(null::accounts, _with_uid(payload->'accounts', uid));
  insert into categories select * from jsonb_populate_recordset(null::categories, _with_uid(payload->'categories', uid))
    order by (parent_id is not null);
  insert into loans select * from jsonb_populate_recordset(null::loans, _with_uid(payload->'loans', uid));
  insert into recurring select * from jsonb_populate_recordset(null::recurring, _with_uid(payload->'recurring', uid));
  insert into transactions select * from jsonb_populate_recordset(null::transactions, _with_uid(payload->'transactions', uid))
    order by (refund_of is not null), date;
  insert into budgets select * from jsonb_populate_recordset(null::budgets, _with_uid(payload->'budgets', uid));
  insert into goals select * from jsonb_populate_recordset(null::goals, _with_uid(payload->'goals', uid));
  insert into goal_entries select * from jsonb_populate_recordset(null::goal_entries, _with_uid(payload->'goal_entries', uid));
  insert into holdings select * from jsonb_populate_recordset(null::holdings, _with_uid(payload->'holdings', uid));
  insert into holding_valuations select * from jsonb_populate_recordset(null::holding_valuations, _with_uid(payload->'holding_valuations', uid));

  select jsonb_build_object(
    'accounts', (select count(*) from accounts where user_id = uid),
    'transactions', (select count(*) from transactions where user_id = uid),
    'categories', (select count(*) from categories where user_id = uid),
    'loans', (select count(*) from loans where user_id = uid)) into counts;
  return counts;
end $$;

revoke execute on function public.bootstrap_user() from public, anon;
revoke execute on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.bootstrap_user() to authenticated;
grant execute on function public.restore_backup(jsonb) to authenticated;
