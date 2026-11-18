-- Runs after register_service: review data is private and reachable only through the verified backend.
-- Review permissions belong to workspaces, not user-editable JWT metadata.
create table register.review_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100)
);
create table register.review_members (
  workspace_id uuid references register.review_workspaces(id) on delete restrict,
  user_id uuid references auth.users(id) on delete restrict,
  role text not null check (role in ('submitter','reviewer','admin')),
  primary key (workspace_id,user_id)
);
create table register.version_reviews (
  version_id uuid primary key references register.assessment_versions(id) on delete restrict,
  workspace_id uuid not null references register.review_workspaces(id) on delete restrict
);
create table register.review_events (
  id bigint generated always as identity primary key,
  version_id uuid not null,
  assessment_id uuid not null,
  version integer not null,
  actor_id uuid,
  actor_label text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  from_status text,
  to_status text not null,
  comment text not null default '' check (length(comment) <= 2000),
  rules_version text not null,
  mapping_version text not null
);
create index review_events_version_idx on register.review_events(version_id,id);
create index review_members_user_idx on register.review_members(user_id,workspace_id);
create index version_reviews_workspace_idx on register.version_reviews(workspace_id);

create function register.review_role(w uuid) returns text language sql stable security definer set search_path = '' as $$
  select role from register.review_members where workspace_id=w and user_id=register.current_user_id()
$$;
create function register.can_review_version(v uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from register.version_reviews r where r.version_id=v
    and register.review_role(r.workspace_id) in ('reviewer','admin'))
$$;
alter table register.review_workspaces enable row level security;
alter table register.review_members enable row level security;
alter table register.version_reviews enable row level security;
alter table register.review_events enable row level security;
revoke all on register.review_workspaces,register.review_members,register.version_reviews,register.review_events from public,anon,authenticated;
grant select on register.review_workspaces,register.review_members,register.version_reviews,register.review_events to register_api;
create policy members_read on register.review_workspaces for select to register_api using (register.review_role(id) is not null);
create policy members_read on register.review_members for select to register_api using (register.review_role(workspace_id) is not null);
create policy reviews_read on register.version_reviews for select to register_api using (
  register.can_review_version(version_id) or exists(select 1 from register.assessment_versions v where v.id=version_id and v.user_id=register.current_user_id())
);
create policy events_read on register.review_events for select to register_api using (
  register.can_review_version(version_id) or exists(select 1 from register.assessment_versions v where v.id=version_id and v.user_id=register.current_user_id())
);
-- Only the specifically submitted version is visible to colleagues. Private drafts stay private.
create policy reviewers_read on register.assessment_versions for select to register_api using (register.can_review_version(id));
-- Parent rows stay owner-only, which also prevents the backend save operation from being used by a reviewer.

alter table register.assessment_versions drop constraint assessment_versions_status_check;
alter table register.assessment_versions add constraint assessment_versions_status_check
  check(status in ('draft','in_review','approved','rejected','changes_requested'));
revoke update(status) on register.assessment_versions from register_api;
drop policy "Users move drafts in and out of review" on register.assessment_versions;

create function register.reject_audit_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Audit records cannot be changed' using errcode='42501'; end;
$$;
create trigger immutable_review_events before update or delete on register.review_events
  for each row execute function register.reject_audit_mutation();

-- Capture initial status for every new saved version. A separate RPC captures status transitions atomically.
create function register.record_initial_review_status() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into register.review_events(version_id,assessment_id,version,actor_id,actor_label,to_status,rules_version,mapping_version)
  values(new.id,new.assessment_id,new.version,register.current_user_id(),register.current_user_id()::text,new.status,new.rules_version,new.mapping_version);
  return new;
end;
$$;
create trigger initial_review_status after insert on register.assessment_versions for each row execute function register.record_initial_review_status();
-- Do not invent the actor or historical date for pre-existing records.
insert into register.review_events(version_id,assessment_id,version,actor_label,to_status,comment,rules_version,mapping_version)
select id,assessment_id,version,'Migration',status,'Status at workflow installation; earlier transitions were not recorded.',rules_version,mapping_version
from register.assessment_versions;

create function register.create_review_workspace(workspace_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
  if register.current_user_id() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  insert into register.review_workspaces(name) values(trim(workspace_name)) returning id into w;
  insert into register.review_members values(w,register.current_user_id(),'admin');
  return w;
end;
$$;
create function register.set_review_member(w uuid,member_id uuid,member_role text) returns void language plpgsql security definer set search_path='' as $$
begin
  if register.review_role(w) is distinct from 'admin' or member_id=register.current_user_id() then raise exception 'Not permitted' using errcode='42501'; end if;
  if member_role is null then delete from register.review_members where workspace_id=w and user_id=member_id;
  else insert into register.review_members values(w,member_id,member_role) on conflict(workspace_id,user_id) do update set role=excluded.role; end if;
end;
$$;

create function register.transition_review(v_id uuid,w_id uuid,next_status text,note text,expected_status text)
returns void language plpgsql security definer set search_path='' as $$
declare v register.assessment_versions; w uuid; r text;
begin
  if register.current_user_id() is null then raise exception 'Not permitted' using errcode='42501'; end if;
  select * into v from register.assessment_versions where id=v_id for update;
  select workspace_id into w from register.version_reviews where version_id=v_id;
  -- Hide records from callers with no access, before disclosing their current status.
  if v.id is null or (v.user_id<>register.current_user_id() and not register.can_review_version(v_id)) then raise exception 'Not permitted' using errcode='42501'; end if;
  if v.status is distinct from expected_status then raise exception 'Status changed; reload' using errcode='40001'; end if;
  if note is null or length(trim(note))>2000 then raise exception 'Invalid comment' using errcode='22023'; end if;
  if next_status='in_review' and (v.status in ('draft','changes_requested') or (v.status='in_review' and w is null)) and v.user_id=register.current_user_id() then
    if w is null then w:=w_id; end if;
    select role into r from register.review_members where workspace_id=w and user_id=register.current_user_id() for share;
    if w is distinct from w_id or r is null then raise exception 'Not permitted' using errcode='42501'; end if;
    insert into register.version_reviews values(v_id,w) on conflict(version_id) do nothing;
  elsif next_status in ('approved','rejected','changes_requested') and v.status='in_review' then
    -- Every role, including workspace admins, is prohibited from deciding its own submission.
    if v.user_id=register.current_user_id() then raise exception 'Self review is not permitted' using errcode='42501'; end if;
    select role into r from register.review_members where workspace_id=w and user_id=register.current_user_id() for share;
    if r is null or r not in ('reviewer','admin') then raise exception 'Not permitted' using errcode='42501'; end if;
    if length(trim(note))=0 then raise exception 'A decision comment is required' using errcode='22023'; end if;
  else raise exception 'Invalid transition' using errcode='22023'; end if;
  update register.assessment_versions set status=next_status where id=v_id;
  insert into register.review_events(version_id,assessment_id,version,actor_id,actor_label,from_status,to_status,comment,rules_version,mapping_version)
  values(v.id,v.assessment_id,v.version,register.current_user_id(),register.current_user_id()::text,v.status,next_status,trim(note),v.rules_version,v.mapping_version);
end;
$$;

-- Every submitted record is retained, including rejected/changes-requested versions, through the restrictive FK.
-- Existing private draft deletion is still allowed; its audit metadata is retained without storing answers.
revoke all on function register.review_role(uuid),register.can_review_version(uuid),register.reject_audit_mutation(),register.record_initial_review_status(),
  register.create_review_workspace(text),register.set_review_member(uuid,uuid,text),register.transition_review(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function register.review_role(uuid),register.can_review_version(uuid),register.create_review_workspace(text),
  register.set_review_member(uuid,uuid,text),register.transition_review(uuid,uuid,text,text,text) to register_api;
