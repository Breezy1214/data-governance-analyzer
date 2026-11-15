-- SCRUM-30: governance register of saved assessments.
-- An assessment is a register entry; each scoring of it is a version. Re-assessing adds the next version and never
-- edits an earlier one. The free-text use-case description is never stored (docs/data-handling.md).

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Target of the versions' composite key, which pins every version to its assessment's owner.
  unique (id, user_id)
);

create index assessments_user_created_idx on public.assessments (user_id, created_at desc);

create table public.assessment_versions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null,
  user_id uuid not null default auth.uid(),
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'rejected')),
  -- The scored answers exactly as the scoring API accepted them.
  answers jsonb not null check (
    jsonb_typeof(answers) = 'object' and not answers ? 'description' and pg_column_size(answers) <= 4096
  ),
  -- The scoring API's full response, so a saved result reopens exactly as it was scored.
  result jsonb not null check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 65536),
  -- Derived from the result so they can never disagree with it; stored for listing and reporting.
  score smallint generated always as ((result ->> 'score')::smallint) stored not null check (score between 0 and 100),
  risk_level text generated always as (result ->> 'level') stored not null check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  factors jsonb generated always as (result -> 'factors') stored not null,
  recommendation_ids jsonb generated always as (jsonb_path_query_array(result, '$.recommendations[*].id')) stored not null,
  schema_version text generated always as (result ->> 'schemaVersion') stored not null,
  rules_version text generated always as (result ->> 'rulesVersion') stored not null,
  mapping_version text generated always as (result ->> 'mappingVersion') stored not null,
  api_version text generated always as (result ->> 'apiVersion') stored not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, version),
  foreign key (assessment_id, user_id) references public.assessments (id, user_id) on delete cascade
);

create index assessment_versions_user_created_idx on public.assessment_versions (user_id, created_at desc);

comment on table public.assessments is 'Governance register entries. Deleting one deletes all its versions.';
comment on table public.assessment_versions is
  'One row per scoring of an assessment. Answers and results are immutable; never holds the use-case description.';

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger assessment_versions_set_updated_at
  before update on public.assessment_versions
  for each row execute function public.set_updated_at();

-- Saves a scored version, creating the assessment when none is given. Runs as the caller, so RLS decides.
create function public.save_assessment_version(target_assessment uuid, scored_answers jsonb, scored_result jsonb)
returns public.assessment_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.assessment_versions;
begin
  if target_assessment is null then
    insert into public.assessments default values returning id into target_assessment;
  elsif not exists (select 1 from public.assessments a where a.id = target_assessment) then
    -- RLS hides other users' assessments, so theirs are reported exactly like ones that don't exist.
    raise exception 'Assessment not found' using errcode = 'no_data_found';
  end if;
  insert into public.assessment_versions (assessment_id, version, answers, result)
  values (
    target_assessment,
    coalesce((select max(v.version) from public.assessment_versions v where v.assessment_id = target_assessment), 0) + 1,
    scored_answers,
    scored_result
  )
  returning * into saved;
  return saved;
end;
$$;

revoke execute on function public.save_assessment_version(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_assessment_version(uuid, jsonb, jsonb) to authenticated;

-- Access is through the Data API as the signed-in user. Answers and results are immutable; only status changes.
revoke all on table public.assessments, public.assessment_versions from public, anon, authenticated;
grant select, insert, delete on table public.assessments to authenticated;
grant select, insert on table public.assessment_versions to authenticated;
grant update (status) on table public.assessment_versions to authenticated;

alter table public.assessments enable row level security;
alter table public.assessment_versions enable row level security;

-- Anonymous sign-ins also carry the authenticated role; they never get a register.
create policy "Registered users only"
  on public.assessments as restrictive for all to authenticated
  using ((select (auth.jwt() ->> 'is_anonymous')::boolean) is false)
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is false);

create policy "Registered users only"
  on public.assessment_versions as restrictive for all to authenticated
  using ((select (auth.jwt() ->> 'is_anonymous')::boolean) is false)
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is false);

create policy "Owners read their assessments"
  on public.assessments for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owners create assessments"
  on public.assessments for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Deleting removes every version, so it is refused while any version is in review or approved.
create policy "Owners delete undecided assessments"
  on public.assessments for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not exists (
      select 1 from public.assessment_versions v
      where v.assessment_id = assessments.id and v.status in ('in_review', 'approved')
    )
  );

create policy "Owners read their versions"
  on public.assessment_versions for select to authenticated
  using ((select auth.uid()) = user_id);

-- The composite foreign key already requires the assessment to belong to the same user.
create policy "Owners save draft versions"
  on public.assessment_versions for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'draft');

-- Owners can submit for review or withdraw. Approving and rejecting belong to reviewers (review-workflow ticket).
create policy "Owners move drafts in and out of review"
  on public.assessment_versions for update to authenticated
  using ((select auth.uid()) = user_id and status in ('draft', 'in_review'))
  with check ((select auth.uid()) = user_id and status in ('draft', 'in_review'));

-- The register lists each assessment's latest version. security_invoker keeps the caller's RLS.
create view public.assessment_register
with (security_invoker = true) as
select distinct on (v.assessment_id)
  v.assessment_id,
  v.id as version_id,
  v.version,
  count(*) over (partition by v.assessment_id) as version_count,
  v.status,
  v.score,
  v.risk_level,
  v.answers,
  a.created_at as first_saved_at,
  v.created_at as saved_at
from public.assessment_versions v
join public.assessments a on a.id = v.assessment_id
order by v.assessment_id, v.version desc;

revoke all on table public.assessment_register from public, anon, authenticated;
grant select on table public.assessment_register to authenticated;
