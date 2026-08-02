-- Run this once in the Supabase SQL editor before the trades-sync cron can work.

create table if not exists trade_messages (
  id text primary key,
  sender_name text,
  text text,
  created_at timestamptz not null
);

create table if not exists trade_sync_state (
  id int primary key default 1,
  live_after_id text,
  backfill_before_id text,
  backfill_done boolean not null default false,
  updated_at timestamptz not null default now()
);

-- source_message_id is NOT unique: a single GroupMe message sometimes bundles
-- more than one trade in one post, so multiple `trades` rows can share it.
create table if not exists trades (
  id bigint generated always as identity primary key,
  source_message_id text not null references trade_messages(id),
  traded_at date not null,
  summary text not null,
  raw text not null,
  transfers jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists trades_source_message_id_idx on trades (source_message_id);
