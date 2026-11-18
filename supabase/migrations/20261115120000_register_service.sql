-- The register is written only by the scoring API, so a client can never store a result it made up.
-- Tables move to a schema the Data API does not expose, every client grant is removed, and the API connects
-- as register_api: a login role with no other rights that cannot bypass row-level security. The API sets the
-- verified user ID for each transaction, and the policies below confine every query to that user's rows.
-- register_api's password is set outside migrations (see backend/.env.example).

create schema register;
revoke all on schema register from public, anon, authenticated;

alter table public.assessments set schema register;
alter table public.assessment_versions set schema register;
alter view public.assessment_register set schema register;
alter function public.set_updated_at() set schema register;

-- Clients could call this with any result; saving now happens inside the API after scoring.
drop function public.save_assessment_version(uuid, jsonb, jsonb);

revoke all on table register.assessments, register.assessment_versions, register.assessment_register
  from public, anon, authenticated;

create function register.current_user_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

alter table register.assessments alter column user_id set default register.current_user_id();
alter table register.assessment_versions alter column user_id set default register.current_user_id();

drop policy "Registered users only" on register.assessments;
drop policy "Owners read their assessments" on register.assessments;
drop policy "Owners create assessments" on register.assessments;
drop policy "Owners delete undecided assessments" on register.assessments;
drop policy "Registered users only" on register.assessment_versions;
drop policy "Owners read their versions" on register.assessment_versions;
drop policy "Owners save draft versions" on register.assessment_versions;
drop policy "Owners move drafts in and out of review" on register.assessment_versions;

do $$
begin
  if not exists (select from pg_roles where rolname = 'register_api') then
    create role register_api login noinherit nobypassrls;
  end if;
end;
$$;

grant usage on schema register to register_api;
grant execute on function register.current_user_id() to register_api;
revoke execute on function register.current_user_id() from public;
revoke execute on function register.set_updated_at() from public;
grant select, insert, delete on table register.assessments to register_api;
grant select, insert on table register.assessment_versions to register_api;
grant update (status) on table register.assessment_versions to register_api;
grant select on table register.assessment_register to register_api;

create policy "Users read their assessments"
  on register.assessments for select to register_api
  using ((select register.current_user_id()) = user_id);

create policy "Users create their assessments"
  on register.assessments for insert to register_api
  with check ((select register.current_user_id()) = user_id);

-- Deleting removes every version, so it is refused while any version is in review or approved.
create policy "Users delete undecided assessments"
  on register.assessments for delete to register_api
  using (
    (select register.current_user_id()) = user_id
    and not exists (
      select 1 from register.assessment_versions v
      where v.assessment_id = assessments.id and v.status in ('in_review', 'approved')
    )
  );

create policy "Users read their versions"
  on register.assessment_versions for select to register_api
  using ((select register.current_user_id()) = user_id);

create policy "Users save draft versions"
  on register.assessment_versions for insert to register_api
  with check ((select register.current_user_id()) = user_id and status = 'draft');

-- Owners can submit for review or withdraw. Approving and rejecting belong to reviewers (review-workflow ticket).
create policy "Users move drafts in and out of review"
  on register.assessment_versions for update to register_api
  using ((select register.current_user_id()) = user_id and status in ('draft', 'in_review'))
  with check ((select register.current_user_id()) = user_id and status in ('draft', 'in_review'));
