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

create table if not exists trades (
  source_message_id text primary key references trade_messages(id),
  traded_at date not null,
  summary text not null,
  raw text not null,
  transfers jsonb not null,
  created_at timestamptz not null default now()
);
