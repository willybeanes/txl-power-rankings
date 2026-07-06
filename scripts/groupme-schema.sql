-- Run this once in the Supabase SQL editor before the groupme-sync cron can work.

create table if not exists groupme_messages (
  id text primary key,
  sender_name text,
  text text,
  created_at timestamptz not null
);

create table if not exists groupme_sync_state (
  id int primary key default 1,
  last_message_id text,
  updated_at timestamptz not null default now()
);

create table if not exists league_lore (
  id int primary key default 1,
  content text not null default '',
  updated_at timestamptz not null default now()
);
