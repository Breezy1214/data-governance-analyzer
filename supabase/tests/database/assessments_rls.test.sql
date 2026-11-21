-- Register access tests. Runs in one transaction and rolls back, so nothing persists.
-- Run with `supabase test db`, or paste into the SQL editor.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Test-only, rolled back: lets this session act as register_api and call pgTAP while it does.
grant register_api to current_user;
grant usage on schema extensions to register_api;

select plan(29);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'owner@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'other@example.test', 'authenticated', 'authenticated');

-- A browser or Data API client carrying a signed-in user's token.
create function pg_temp.as_client(role_name text, user_id uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id, 'role', role_name, 'is_anonymous', false)::text, true);
  execute format('set local role %I', role_name);
end;
$$;

-- The scoring API acting for the user whose token it verified.
create function pg_temp.as_api(user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('app.user_id', coalesce(user_id::text, ''), true);
  set local role register_api;
end;
$$;

create function pg_temp.answers() returns jsonb language sql as $$
  select '{"schemaVersion":"3.0","dataTypes":["emails"],"purpose":"overlap","participants":"onePartner",
    "identifierProtection":"notExchanged","custodyChange":"no","environmentControl":"own","reusableKeys":"no",
    "smallResults":"no","combined":"no","retainedArtifacts":"no","secondaryUse":"no","regulations":["none"],
    "identifierConsistency":"yes"}'::jsonb
$$;

create function pg_temp.result(score integer default 28, level text default 'LOW') returns jsonb language sql as $$
  select jsonb_build_object(
    'schemaVersion', '3.0', 'rulesVersion', '2.0', 'mappingVersion', '2.0', 'apiVersion', '0.1.0',
    'mappingApprovalStatus', 'approved', 'sourcesCheckedOn', '2026-11-04', 'score', score, 'level', level,
    'guidance', 'Proceed with standard controls.', 'limitations', '[]'::jsonb,
    'factors', '[{"ruleId":"PARTICIPANTS_ONE","category":"participants","label":"One outside organization","points":28}]'::jsonb,
    'recommendations', '[{"id":"REC_A","priority":1},{"id":"REC_B","priority":2}]'::jsonb,
    'assessedAt', '2026-11-12T12:00:00Z')
$$;

create temp table saved (id uuid);
grant all on saved to register_api;

-- Clients can't store a result they made up: no table, view or function in the register is reachable.
select hasnt_function('public', 'save_assessment_version', 'the old client-callable save function is gone');
select pg_temp.as_client('authenticated', '00000000-0000-4000-8000-00000000000a');
select throws_ok(
  $$insert into register.assessment_versions (assessment_id, version, answers, result)
    values (gen_random_uuid(), 1, pg_temp.answers(), pg_temp.result(0, 'LOW'))$$,
  '42501', null, 'a signed-in client cannot insert a result');
select throws_ok($$insert into register.assessments default values$$, '42501', null,
  'a signed-in client cannot create an assessment');
select throws_ok($$select 1 from register.assessment_versions$$, '42501', null, 'a signed-in client cannot read versions');
select throws_ok($$select 1 from register.assessment_register$$, '42501', null, 'a signed-in client cannot read the register');
reset role;
select pg_temp.as_client('anon');
select throws_ok($$select 1 from register.assessments$$, '42501', null, 'logged-out visitors cannot read assessments');
select throws_ok($$truncate register.assessments$$, '42501', null, 'logged-out visitors cannot truncate the register');
reset role;

-- The API saves for user A, then re-assesses.
select pg_temp.as_api('00000000-0000-4000-8000-00000000000a');
with created as (insert into register.assessments default values returning id) insert into saved select id from created;
insert into register.assessment_versions (assessment_id, version, answers, result)
  select id, 1, pg_temp.answers(), pg_temp.result() from saved;
insert into register.assessment_versions (assessment_id, version, answers, result)
  select id, 2, pg_temp.answers(), pg_temp.result(64, 'HIGH') from saved;

select results_eq(
  $$select version, status, score::integer, risk_level, user_id from register.assessment_versions order by version$$,
  $$values (1, 'draft', 28, 'LOW', '00000000-0000-4000-8000-00000000000a'::uuid),
           (2, 'draft', 64, 'HIGH', '00000000-0000-4000-8000-00000000000a'::uuid)$$,
  'versions belong to the verified user and keep the earlier one; score and level come from each result');
select is(
  (select recommendation_ids from register.assessment_versions where version = 1), '["REC_A", "REC_B"]'::jsonb,
  'recommendation IDs are derived from the stored result');
select results_eq(
  $$select assessment_id, version, version_count from register.assessment_register$$,
  $$select id, 2, 2::bigint from saved$$,
  'the register lists the latest version and counts the earlier ones');
select throws_ok(
  $$insert into register.assessment_versions (assessment_id, version, answers, result)
    select id, 3, pg_temp.answers() || '{"description":"free text"}', pg_temp.result() from saved$$,
  '23514', null, 'the use-case description cannot be stored');
select throws_ok(
  $$insert into register.assessment_versions (assessment_id, version, answers, result, status)
    select id, 3, pg_temp.answers(), pg_temp.result(), 'approved' from saved$$,
  '42501', null, 'a version cannot be saved as already approved');
select throws_ok(
  $$insert into register.assessments (user_id) values ('00000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'the API cannot create an assessment for a different user than the one it verified');
select throws_ok(
  $$update register.assessment_versions set result = pg_temp.result(0, 'LOW') where version = 1$$,
  '42501', null, 'only the status of a saved version can be edited');
select throws_ok(
  $$delete from register.assessment_versions where version = 1$$,
  '42501', null, 'a single version cannot be deleted, so history is kept');
select throws_ok(
  $$update register.assessment_versions set status = 'approved' where version = 1$$,
  '42501', null, 'an owner cannot approve their own assessment');
select register.transition_review(
  (select id from register.assessment_versions where version=1),
  register.create_review_workspace('Review team'), 'in_review', 'Ready', 'draft');
select is((select status from register.assessment_versions where version = 1), 'in_review',
  'an owner can submit a version for review');

-- Acting for user B, the API sees and changes nothing of A's.
reset role;
select pg_temp.as_api('00000000-0000-4000-8000-00000000000b');
select is_empty($$select 1 from register.assessments$$, 'another user sees none of the owner''s assessments');
select is_empty($$select 1 from register.assessment_register$$, 'another user''s register is empty');
select throws_ok($$update register.assessment_versions set status = 'draft' returning 1$$, '42501', null,
  'another user cannot change the owner''s versions');
select is_empty($$delete from register.assessments where id = (select id from saved) returning 1$$,
  'another user cannot delete the owner''s assessment');
select throws_ok(
  $$insert into register.assessment_versions (assessment_id, version, answers, result)
    select id, 9, pg_temp.answers(), pg_temp.result() from saved$$,
  '23503', null, 'another user cannot add a version to the owner''s assessment');

-- With no verified user, the API sees and saves nothing.
reset role;
select pg_temp.as_api(null);
select is_empty($$select 1 from register.assessment_versions$$, 'without a verified user nothing is visible');
select throws_ok($$insert into register.assessments default values$$, '42501', null,
  'without a verified user nothing can be saved');
select throws_ok($$select 1 from auth.users$$, '42501', null, 'the API role cannot read accounts');

-- Deleting is all-or-nothing and refused while any version is in review or approved.
reset role;
select pg_temp.as_api('00000000-0000-4000-8000-00000000000a');
select is_empty($$delete from register.assessments where id = (select id from saved) returning 1$$,
  'an assessment with a version in review cannot be deleted');
-- A separate private draft remains deletable; submitted records cannot be withdrawn to erase history.
with created as (insert into register.assessments default values returning id)
insert into register.assessment_versions(assessment_id,version,answers,result)
select id,1,pg_temp.answers(),pg_temp.result() from created;
select isnt_empty($$delete from register.assessments where id <> (select id from saved) returning id$$,
  'the owner deletes an undecided assessment');
select is_empty($$select 1 from register.assessment_versions where assessment_id <> (select id from saved)$$, 'deleting a private draft deletes all its versions');

-- Account deletion cannot cascade away a submitted review record or workspace membership.
insert into register.assessments default values;
reset role;
select throws_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-00000000000a'$$,
  '23503', null, 'account deletion cannot erase submitted review history');

select * from finish();
rollback;
