-- Advisor fixes for the register: evaluate the JWT once per query, and index the owner-pinning foreign key.

alter policy "Registered users only" on public.assessments
  using (((select auth.jwt()) ->> 'is_anonymous')::boolean is false)
  with check (((select auth.jwt()) ->> 'is_anonymous')::boolean is false);

alter policy "Registered users only" on public.assessment_versions
  using (((select auth.jwt()) ->> 'is_anonymous')::boolean is false)
  with check (((select auth.jwt()) ->> 'is_anonymous')::boolean is false);

create index assessment_versions_assessment_user_idx on public.assessment_versions (assessment_id, user_id);
