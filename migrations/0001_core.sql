-- Core database. Logical names follow docs/data-model.md.
-- The plugin database is not created here.

create extension if not exists pgcrypto;

create table accounts (
  id uuid primary key,
  email text not null,
  name text not null,
  password_hash text not null,
  is_administrator boolean not null,
  is_active boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index accounts_email_lower_uidx on accounts (lower(email));

create table projects (
  id uuid primary key,
  name text not null,
  timezone text not null default 'Europe/Moscow',
  min_call_duration_sec integer not null default 180,
  created_at timestamptz not null default now(),
  constraint projects_min_call_duration_positive check (min_call_duration_sec > 0)
);

create table project_memberships (
  id uuid primary key,
  account_id uuid not null references accounts (id),
  project_id uuid not null references projects (id),
  role text not null,
  created_at timestamptz not null default now(),
  constraint project_memberships_role_check check (role in ('lead', 'sales_manager')),
  constraint project_memberships_account_project_key unique (account_id, project_id)
);

create table scorecards (
  project_id uuid not null references projects (id),
  version integer not null,
  stages_json jsonb not null,
  primary key (project_id, version),
  constraint scorecards_version_positive check (version >= 1)
);

create table project_inputs (
  id uuid primary key,
  project_id uuid not null references projects (id),
  title text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

create table sources (
  id uuid primary key,
  project_id uuid not null references projects (id),
  kind text not null,
  provider text,
  display_name text not null,
  token_hash text,
  last_intake_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sources_kind_check check (kind in ('manual', 'plugin'))
);

create unique index sources_one_manual_uidx on sources (project_id) where kind = 'manual';

create table managers (
  id uuid primary key,
  project_id uuid not null references projects (id),
  source_id uuid not null references sources (id),
  external_id text,
  name text not null,
  email text,
  is_active boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index managers_external_uidx
  on managers (project_id, source_id, external_id)
  where external_id is not null and external_id <> '';

create table contacts (
  id uuid primary key,
  project_id uuid not null references projects (id),
  source_id uuid not null references sources (id),
  external_id text,
  name text not null,
  company_name text,
  external_url text,
  updated_at timestamptz not null default now()
);

create unique index contacts_external_uidx
  on contacts (project_id, source_id, external_id)
  where external_id is not null and external_id <> '';

create table calls (
  id uuid primary key,
  project_id uuid not null references projects (id),
  source_id uuid not null references sources (id),
  external_id text not null,
  idempotency_key text,
  manager_id uuid references managers (id),
  contact_id uuid references contacts (id),
  company_name text,
  direction text,
  phone text,
  started_at timestamptz not null,
  duration_sec integer,
  recording_source_url text,
  recording_storage_key text,
  recording_content_type text,
  deal_external_id text,
  deal_name text,
  deal_status_at_call_name text,
  current_deal_status_name text,
  deal_external_url text,
  deal_link_status text not null,
  context_json jsonb not null default '{"notes":null,"fields":[]}'::jsonb,
  processing_status text not null,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calls_direction_check check (direction is null or direction in ('in', 'out')),
  constraint calls_duration_nonnegative check (duration_sec is null or duration_sec >= 0),
  constraint calls_link_status_check check (
    deal_link_status in ('linked', 'unresolved', 'ambiguous', 'absent')
  ),
  constraint calls_status_check check (processing_status in (
    'recording_pending',
    'recording_missing',
    'audio_queued',
    'audio_fetch',
    'skipped_short',
    'skipped_no_duration',
    'transcribing',
    'analyzing',
    'completed',
    'failed'
  )),
  constraint calls_external_id_key unique (project_id, source_id, external_id)
);

create unique index calls_idempotency_uidx
  on calls (project_id, idempotency_key)
  where idempotency_key is not null;

create index calls_project_started_idx on calls (project_id, started_at desc);
create index calls_project_status_idx on calls (project_id, processing_status);
create index calls_deal_external_idx on calls (project_id, source_id, deal_external_id);

create table call_analysis (
  id uuid primary key,
  call_id uuid not null unique references calls (id),
  transcript_json jsonb,
  inputs_json jsonb,
  stages_json jsonb,
  overall_score integer,
  summary text,
  ai_model text,
  created_at timestamptz not null default now(),
  constraint call_analysis_overall_score_check check (
    overall_score is null or (overall_score >= 0 and overall_score <= 100)
  )
);
