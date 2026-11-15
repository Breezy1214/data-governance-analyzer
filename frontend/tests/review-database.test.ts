// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

// Execute the real migrations and RLS under PostgreSQL, not a mocked permission function.
let db: PGlite;
const owner = "00000000-0000-4000-8000-000000000001";
const reviewer = "00000000-0000-4000-8000-000000000002";
const outsider = "00000000-0000-4000-8000-000000000003";
const submitter = "00000000-0000-4000-8000-000000000004";
let workspace: string, version: string, assessment: string;
async function asUser(id: string, anonymous = false) {
  await db.exec("reset role; set role authenticated;");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, email: `${id.slice(-1)}@example.test`, is_anonymous: anonymous })]);
}
async function transition(status: string, expected: string, note = "Reviewed the proposed use and safeguards") {
  return db.query("select public.transition_review($1,$2,$3,$4,$5)", [version, workspace, status, note, expected]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values ('${owner}'),('${reviewer}'),('${outsider}'),('${submitter}');`);
  for (const name of ["20261112183848_create_assessments.sql", "20261112183910_tune_assessment_policies.sql", "20261114090000_review_workflow.sql"]) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await asUser(owner);
  workspace = (await db.query<{ id: string }>("select public.create_review_workspace('Privacy team') as id")).rows[0].id;
  await db.query("select public.set_review_member($1,$2,'reviewer')", [workspace, reviewer]);
  await db.query("select public.set_review_member($1,$2,'submitter')", [workspace, submitter]);
  const result = { score: 20, level: "LOW", factors: [], recommendations: [], schemaVersion: "3.0", rulesVersion: "2.0", mappingVersion: "2.0", apiVersion: "0.1.0" };
  const saved = await db.query<{ id: string; assessment_id: string }>("select * from public.save_assessment_version(null,'{}',$1)", [JSON.stringify(result)]);
  version = saved.rows[0].id; assessment = saved.rows[0].assessment_id;
}, 30000);
afterAll(async () => { await db?.close(); });

it("keeps private drafts private and denies membership escalation", async () => {
  for (const user of [reviewer, outsider, submitter]) {
    await asUser(user);
    expect((await db.query("select * from public.assessment_versions")).rows).toHaveLength(0);
    await expect(db.query("select public.set_review_member($1,$2,'admin')", [workspace, user])).rejects.toThrow();
    await expect(transition("in_review", "draft")).rejects.toThrow();
  }
  await asUser(owner, true);
  await expect(transition("in_review", "draft")).rejects.toThrow();
});

it("submits atomically and prevents direct updates, self-approval and cross-workspace access", async () => {
  await asUser(owner);
  await transition("in_review", "draft", "Ready for independent review");
  await expect(transition("approved", "in_review")).rejects.toThrow(/Self review/);
  await expect(db.query("update public.assessment_versions set status='approved' where id=$1", [version])).rejects.toThrow();
  for (const user of [outsider, submitter]) {
    await asUser(user);
    expect((await db.query("select * from public.assessment_versions")).rows).toHaveLength(0);
    await expect(transition("approved", "in_review")).rejects.toThrow();
  }
  await asUser(reviewer);
  expect((await db.query("select * from public.assessment_versions")).rows).toHaveLength(1);
  await expect(db.query("select public.save_assessment_version($1,'{}','{}')", [assessment])).rejects.toThrow();
  await expect(transition("approved", "in_review", "")).rejects.toThrow();
  await transition("changes_requested", "in_review");
  await expect(transition("approved", "in_review")).rejects.toThrow(/Status changed/);
});

it("records changes requested and approval without allowing audit mutation or deletion", async () => {
  await asUser(owner);
  await transition("in_review", "changes_requested", "Clarification provided");
  await asUser(reviewer);
  await transition("approved", "in_review");
  const events = (await db.query<{ to_status: string; actor_id: string; rules_version: string }>("select * from public.review_events order by id")).rows;
  expect(events.map((e) => e.to_status)).toEqual(["draft", "in_review", "changes_requested", "in_review", "approved"]);
  expect(events.at(-1)?.actor_id).toBe(reviewer);
  expect(events.every((e) => e.rules_version === "2.0")).toBe(true);
  for (const user of [reviewer, owner]) {
    await asUser(user);
    await expect(db.exec("update public.review_events set comment='rewritten'")).rejects.toThrow();
    await expect(db.exec("delete from public.review_events")).rejects.toThrow();
    await expect(db.exec("insert into public.review_events default values")).rejects.toThrow();
  }
  await asUser(owner);
  await db.query("delete from public.assessments where id=$1", [assessment]);
  expect((await db.query("select * from public.assessment_versions")).rows).toHaveLength(1);
  await db.query("select public.set_review_member($1,$2,null)", [workspace, reviewer]);
  await asUser(reviewer);
  expect((await db.query("select * from public.assessment_versions")).rows).toHaveLength(0);
  expect((await db.query("select * from public.review_events")).rows).toHaveLength(0);
});

it("allows an independent admin to reject and retains that record while new versions start draft", async () => {
  await asUser(submitter);
  const result = { score: 20, level: "LOW", factors: [], recommendations: [], schemaVersion: "3.0", rulesVersion: "2.0", mappingVersion: "2.0", apiVersion: "0.1.0" };
  const save = () => db.query<{ id: string; assessment_id: string; status: string }>(
    "select * from public.save_assessment_version(null,'{}',$1)", [JSON.stringify(result)]);
  const saved = (await save()).rows[0];
  await db.query("select public.transition_review($1,$2,'in_review','Ready','draft')", [saved.id, workspace]);
  await asUser(owner);
  await db.query("select public.transition_review($1,$2,'rejected','Missing controls','in_review')", [saved.id, workspace]);
  await asUser(submitter);
  await expect(db.query("delete from public.assessments where id=$1", [saved.assessment_id])).rejects.toThrow();
  const newer = await db.query<{ status: string }>("select * from public.save_assessment_version($1,'{}',$2)", [saved.assessment_id, JSON.stringify(result)]);
  expect(newer.rows[0].status).toBe("draft");
  await asUser(outsider);
  await db.query("select public.create_review_workspace('Other organization')");
  expect((await db.query("select * from public.assessment_versions")).rows).toHaveLength(0);
  await expect(db.query("select public.transition_review($1,$2,'approved','Attempt','rejected')", [saved.id, workspace])).rejects.toThrow();
});
