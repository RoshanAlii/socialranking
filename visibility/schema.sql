-- Visibility OS: PostgreSQL production foundation
-- Public prototype uses no database. This schema belongs in the future private backend.

create extension if not exists pgcrypto;

create type evidence_class as enum ('verified', 'derived', 'public', 'estimated', 'modelled', 'experimental', 'sample');
create type integration_state as enum ('connected', 'degraded', 'expired', 'not_connected', 'not_configured');
create type opportunity_state as enum ('open', 'in_progress', 'done', 'dismissed');
create type opportunity_priority as enum ('critical', 'high', 'medium', 'low');
create type entity_kind as enum ('organisation', 'branch', 'team', 'agent', 'developer', 'project', 'community', 'listing', 'campaign', 'event', 'source_market', 'competitor');

create table organisations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  default_timezone text not null default 'Asia/Dubai',
  default_currency text not null default 'AED',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  auth_subject text unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table organisation_memberships (
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','executive','marketing','sales','manager','agent','analyst','viewer')),
  scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create table entities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  kind entity_kind not null,
  canonical_name text not null,
  external_key text,
  parent_entity_id uuid references entities(id) on delete set null,
  attributes jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, kind, canonical_name)
);
create index entities_org_kind_idx on entities (organisation_id, kind);
create index entities_parent_idx on entities (parent_entity_id);

create table entity_aliases (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  alias text not null,
  source text,
  normalised_alias text generated always as (lower(regexp_replace(alias, '[^a-zA-Z0-9]+', '', 'g'))) stored,
  created_at timestamptz not null default now(),
  unique (organisation_id, normalised_alias)
);

create table entity_relationships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  from_entity_id uuid not null references entities(id) on delete cascade,
  relationship text not null,
  to_entity_id uuid not null references entities(id) on delete cascade,
  valid_from timestamptz,
  valid_to timestamptz,
  evidence evidence_class not null default 'verified',
  created_at timestamptz not null default now(),
  unique (from_entity_id, relationship, to_entity_id, valid_from)
);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  provider text not null,
  external_account_id text,
  state integration_state not null default 'not_connected',
  granted_scopes text[] not null default '{}',
  credential_reference text,
  last_success_at timestamptz,
  last_complete_data_at timestamptz,
  token_expires_at timestamptz,
  coverage_percent numeric(5,2) not null default 0,
  error_code text,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, provider, external_account_id)
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  owner_entity_id uuid references entities(id) on delete set null,
  integration_id uuid references integrations(id) on delete set null,
  platform text not null,
  account_type text not null,
  external_id text,
  handle text,
  profile_url text,
  active boolean not null default true,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, platform, external_id)
);

create table content_assets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  author_entity_id uuid references entities(id) on delete set null,
  platform text not null,
  external_id text,
  content_type text,
  canonical_url text,
  published_at timestamptz,
  caption text,
  transcript text,
  language text,
  duration_seconds numeric,
  classification jsonb not null default '{}'::jsonb,
  public_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, platform, external_id)
);
create index content_published_idx on content_assets (organisation_id, published_at desc);

create table content_entity_links (
  content_asset_id uuid not null references content_assets(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  relation text not null,
  confidence numeric(5,4),
  evidence evidence_class not null,
  extraction_method text,
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  primary key (content_asset_id, entity_id, relation)
);

create table metric_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text not null,
  unit text not null,
  aggregation text not null,
  formula text,
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table metric_observations (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references organisations(id) on delete cascade,
  metric_definition_id uuid not null references metric_definitions(id),
  subject_entity_id uuid references entities(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  content_asset_id uuid references content_assets(id) on delete cascade,
  integration_id uuid references integrations(id) on delete set null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  value_numeric numeric,
  value_text text,
  evidence evidence_class not null,
  source_record_id text,
  source_updated_at timestamptz,
  ingested_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check ((value_numeric is not null) <> (value_text is not null))
);
create index metric_subject_period_idx on metric_observations (organisation_id, subject_entity_id, period_end desc);
create index metric_content_period_idx on metric_observations (organisation_id, content_asset_id, period_end desc);

create table score_definitions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade,
  key text not null,
  label text not null,
  version integer not null,
  formula jsonb not null,
  minimum_coverage numeric(5,2) not null default 0,
  missing_data_policy text not null default 'unknown',
  active boolean not null default true,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  unique (organisation_id, key, version)
);

create table score_observations (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references organisations(id) on delete cascade,
  score_definition_id uuid not null references score_definitions(id),
  subject_entity_id uuid references entities(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  score numeric(6,2),
  components jsonb not null,
  evidence evidence_class not null,
  coverage_percent numeric(5,2) not null,
  calculated_at timestamptz not null default now()
);

create table tracking_identities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  code text not null,
  agent_entity_id uuid references entities(id) on delete set null,
  project_entity_id uuid references entities(id) on delete set null,
  campaign_entity_id uuid references entities(id) on delete set null,
  destination_url text not null,
  channel text,
  medium text,
  content_variant text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);

create table touchpoints (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  anonymous_visitor_id text,
  person_reference text,
  tracking_identity_id uuid references tracking_identities(id) on delete set null,
  content_asset_id uuid references content_assets(id) on delete set null,
  occurred_at timestamptz not null,
  event_type text not null,
  channel text,
  landing_url text,
  referrer_url text,
  utm jsonb not null default '{}'::jsonb,
  consent_state jsonb not null default '{}'::jsonb,
  evidence evidence_class not null default 'verified',
  metadata jsonb not null default '{}'::jsonb
);
create index touchpoints_person_time_idx on touchpoints (organisation_id, person_reference, occurred_at);

create table crm_leads (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  crm_provider text not null,
  crm_lead_id text not null,
  responsible_agent_entity_id uuid references entities(id) on delete set null,
  project_entity_id uuid references entities(id) on delete set null,
  campaign_entity_id uuid references entities(id) on delete set null,
  person_reference text,
  created_at_source timestamptz not null,
  stage text,
  qualified boolean,
  qualification jsonb not null default '{}'::jsonb,
  first_touchpoint_id uuid references touchpoints(id) on delete set null,
  lead_creating_touchpoint_id uuid references touchpoints(id) on delete set null,
  self_reported_source text,
  source_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (organisation_id, crm_provider, crm_lead_id)
);

create table crm_deals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  crm_provider text not null,
  crm_deal_id text not null,
  lead_id uuid references crm_leads(id) on delete set null,
  responsible_agent_entity_id uuid references entities(id) on delete set null,
  project_entity_id uuid references entities(id) on delete set null,
  stage text,
  status text,
  value numeric(18,2),
  currency text,
  commission_value numeric(18,2),
  opened_at timestamptz,
  closed_at timestamptz,
  loss_reason text,
  source_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (organisation_id, crm_provider, crm_deal_id)
);

create table attribution_results (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  lead_id uuid references crm_leads(id) on delete cascade,
  deal_id uuid references crm_deals(id) on delete cascade,
  model text not null check (model in ('first_touch','lead_creating_touch','last_non_direct','assisted','self_reported','modelled')),
  touchpoint_id uuid references touchpoints(id) on delete set null,
  content_asset_id uuid references content_assets(id) on delete set null,
  tracking_identity_id uuid references tracking_identities(id) on delete set null,
  weight numeric(7,6) not null check (weight >= 0 and weight <= 1),
  evidence evidence_class not null,
  method_version text not null,
  calculated_at timestamptz not null default now()
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  type text not null,
  priority opportunity_priority not null,
  state opportunity_state not null default 'open',
  title text not null,
  observation text not null,
  evidence_summary text not null,
  evidence evidence_class not null,
  recommended_action text not null,
  expected_impact jsonb not null default '{}'::jsonb,
  owner_user_id uuid references users(id) on delete set null,
  owner_entity_id uuid references entities(id) on delete set null,
  due_at timestamptz,
  detected_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome jsonb not null default '{}'::jsonb,
  rule_key text,
  rule_version text,
  source_references jsonb not null default '[]'::jsonb
);
create index opportunities_queue_idx on opportunities (organisation_id, state, priority, detected_at desc);

create table ai_prompt_tests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  prompt_cluster text not null,
  prompt_text text not null,
  model_provider text not null,
  model_name text not null,
  market text,
  language text,
  executed_at timestamptz not null,
  brand_mentioned boolean,
  brand_recommended boolean,
  brand_cited boolean,
  position_in_answer integer,
  competitor_entities uuid[] not null default '{}',
  citations jsonb not null default '[]'::jsonb,
  response_reference text,
  evidence evidence_class not null default 'experimental',
  metadata jsonb not null default '{}'::jsonb
);

create table audit_log (
  id bigint generated always as identity primary key,
  organisation_id uuid references organisations(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  object_type text not null,
  object_id text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz not null default now(),
  request_id text,
  ip_hash text
);

-- Enforce tenant-scoped access in the application and add PostgreSQL RLS policies
-- before production. Credentials must be stored in a dedicated secrets manager;
-- credential_reference stores only an opaque locator, never an access token.
