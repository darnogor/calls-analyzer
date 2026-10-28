-- Stage card stays in scorecards. The admin prompt, product facts, and deal
-- stages are separate. Analysis extras hold coverage, flags, and payment.

alter table scorecards add column card_key text;

alter table call_analysis add column extras_json jsonb;

create table scoring_prompts (
  project_id uuid not null references projects (id),
  version integer not null,
  body text not null,
  primary key (project_id, version),
  constraint scoring_prompts_version_positive check (version >= 1)
);

create table product_facts (
  project_id uuid not null references projects (id),
  version integer not null,
  body text not null,
  primary key (project_id, version),
  constraint product_facts_version_positive check (version >= 1)
);

create table deal_stages (
  id uuid primary key,
  project_id uuid not null references projects (id),
  position integer not null,
  name text not null,
  constraint deal_stages_position_positive check (position >= 1),
  constraint deal_stages_project_name_key unique (project_id, name)
);
