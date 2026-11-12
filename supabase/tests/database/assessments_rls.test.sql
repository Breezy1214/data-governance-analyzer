-- RLS tests for the governance register (SCRUM-30). Runs in one transaction and rolls back, so nothing persists.
-- Run with `supabase test db`, or paste into the SQL editor.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'owner@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'other@example.test', 'authenticated', 'authenticated');

create function pg_temp.act_as(user_id uuid, anonymous boolean default false) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated', 'is_anonymous', anonymous)::text, true);
  set local role authenticated;
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

-- Owner A saves an assessment, then re-assesses it.
select pg_temp.act_as('00000000-0000-4000-8000-00000000000a');
create temp table saved on commit drop as
  select * from save_assessment_version(null, pg_temp.answers(), pg_temp.result());
grant select on saved to authenticated;

select is((select version from saved), 1, 'an owner saves a new assessment as version 1');
select is(
  (select version from save_assessment_version((select assessment_id from saved), pg_temp.answers(), pg_temp.result(64, 'HIGH'))),
  2, 're-assessing saves version 2 of the same assessment');
select results_eq(
  $$select version, status, score::integer, risk_level, user_id from assessment_versions order by version$$,
  $$values (1, 'draft', 28, 'LOW', '00000000-0000-4000-8000-00000000000a'::uuid),
           (2, 'draft', 64, 'HIGH', '00000000-0000-4000-8000-00000000000a'::uuid)$$,
  'the earlier version is kept; score and level come from each stored result');
select is(
  (select recommendation_ids from assessment_versions where version = 1), '["REC_A", "REC_B"]'::jsonb,
  'recommendation IDs are derived from the stored result');
select results_eq(
  $$select assessment_id, version, version_count from assessment_register$$,
  $$select assessment_id, 2, 2::bigint from saved$$,
  'the register lists the latest version and counts the earlier ones');

select throws_ok(
  $$select save_assessment_version(null, pg_temp.answers() || '{"description":"free text"}', pg_temp.result())$$,
  '23514', null, 'the use-case description cannot be stored');
select throws_ok(
  $$insert into assessment_versions (assessment_id, version, answers, result, status)
    select assessment_id, 9, pg_temp.answers(), pg_temp.result(), 'approved' from saved$$,
  '42501', null, 'an owner cannot save a version as already approved');
select throws_ok(
  $$insert into assessments (user_id) values ('00000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'an owner cannot create an assessment for someone else');
select throws_ok(
  $$update assessment_versions set result = pg_temp.result(0, 'LOW') where version = 1$$,
  '42501', null, 'only the status of a saved version can be edited');
select throws_ok(
  $$delete from assessment_versions where version = 1$$,
  '42501', null, 'a single version cannot be deleted, so history is kept');
select throws_ok(
  $$update assessment_versions set status = 'approved' where version = 1$$,
  '42501', null, 'an owner cannot approve their own assessment');
update assessment_versions set status = 'in_review' where version = 1;
select is((select status from assessment_versions where version = 1), 'in_review', 'the status change is saved');

-- User B can neither see nor change A's register.
select pg_temp.act_as('00000000-0000-4000-8000-00000000000b');

select is_empty($$select 1 from assessments$$, 'another user sees none of the owner''s assessments');
select is_empty($$select 1 from assessment_versions$$, 'another user sees none of the owner''s versions');
select is_empty($$select 1 from assessment_register$$, 'another user''s register is empty');
select is_empty(
  $$update assessment_versions set status = 'draft' returning 1$$,
  'another user cannot change the owner''s versions');
select is_empty(
  $$delete from assessments where id = (select assessment_id from saved) returning 1$$,
  'another user cannot delete the owner''s assessment');
select throws_ok(
  $$select save_assessment_version((select assessment_id from saved), pg_temp.answers(), pg_temp.result())$$,
  'P0002', null, 'another user cannot add a version to the owner''s assessment');

-- An anonymous sign-in carrying the owner's ID sees and saves nothing.
reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000000a', true);
select is_empty($$select 1 from assessment_versions$$, 'anonymous sign-ins see no assessments');
select throws_ok(
  $$select save_assessment_version(null, pg_temp.answers(), pg_temp.result())$$,
  '42501', null, 'anonymous sign-ins cannot save assessments');

-- Logged-out visitors have no access at all.
reset role;
set local role anon;
select throws_ok($$select 1 from assessment_versions$$, '42501', null, 'logged-out visitors cannot read versions');
select throws_ok($$select 1 from assessment_register$$, '42501', null, 'logged-out visitors cannot read the register');
select throws_ok(
  $$truncate assessments, assessment_versions$$, '42501', null, 'logged-out visitors cannot truncate the register');

-- Deleting is all-or-nothing and refused while any version is in review or approved.
reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000000a');
select is_empty(
  $$delete from assessments where id = (select assessment_id from saved) returning 1$$,
  'an assessment with a version in review cannot be deleted');
update assessment_versions set status = 'draft' where version = 1;
select isnt_empty(
  $$delete from assessments where id = (select assessment_id from saved) returning 1$$,
  'the owner deletes an undecided assessment');
select is_empty($$select 1 from assessment_versions$$, 'deleting an assessment deletes all its versions');

-- Deleting an account deletes its register.
select save_assessment_version(null, pg_temp.answers(), pg_temp.result());
reset role;
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is_empty(
  $$select 1 from assessments where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  'deleting an account deletes its assessments');

select * from finish();
rollback;
