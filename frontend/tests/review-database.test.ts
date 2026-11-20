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
const RESULT = { score: 20, level: "LOW", factors: [], recommendations: [], schemaVersion: "3.0", rulesVersion: "2.0", mappingVersion: "2.0", apiVersion: "0.1.0" };
const email = (id: string) => `user-${id.slice(-1)}@example.com`;
async function asUser(id: string, anonymous = false) {
  await db.exec("reset role; set role register_api;");
  await db.query("select set_config('app.user_id',$1,false)", [anonymous ? "" : id]);
}
async function transition(status: string, expected: string, note = "Reviewed the proposed use and safeguards") {
  return db.query("select register.transition_review($1,$2,$3,$4,$5)", [version, workspace, status, note, expected]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users select id, 'user-' || right(id::text, 1) || '@example.com' from unnest(array['${owner}','${reviewer}','${outsider}','${submitter}']::uuid[]) id;`);
  for (const name of ["20261112183848_create_assessments.sql", "20261112183910_tune_assessment_policies.sql", "20261115120000_register_service.sql", "20261118090000_review_workflow.sql"]) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await asUser(owner);
  workspace = (await db.query<{ id: string }>("select register.create_review_workspace('Privacy team') as id")).rows[0].id;
  await db.query("select register.set_review_member($1,$2,'reviewer')", [workspace, reviewer]);
  await db.query("select register.set_review_member($1,$2,'submitter')", [workspace, submitter]);
  const saved = await saveVersion(RESULT);
  version = saved.rows[0].id; assessment = saved.rows[0].assessment_id;
}, 30000);
afterAll(async () => { await db?.close(); });

it("keeps private drafts private and denies membership escalation", async () => {
  for (const user of [reviewer, outsider, submitter]) {
    await asUser(user);
    expect((await db.query("select * from register.assessment_versions")).rows).toHaveLength(0);
    await expect(db.query("select register.set_review_member($1,$2,'admin')", [workspace, user])).rejects.toThrow();
    await expect(transition("in_review", "draft")).rejects.toThrow();
  }
  await asUser(owner, true);
  await expect(transition("in_review", "draft")).rejects.toThrow();
});

it("submits atomically and prevents direct updates, self-approval and cross-workspace access", async () => {
  await asUser(owner);
  await transition("in_review", "draft", "Ready for independent review");
  await expect(transition("approved", "in_review")).rejects.toThrow(/Self review/);
  await expect(db.query("update register.assessment_versions set status='approved' where id=$1", [version])).rejects.toThrow();
  for (const user of [outsider, submitter]) {
    await asUser(user);
    expect((await db.query("select * from register.assessment_versions")).rows).toHaveLength(0);
    await expect(transition("approved", "in_review")).rejects.toThrow();
  }
  await asUser(reviewer);
  expect((await db.query("select * from register.assessment_versions")).rows).toHaveLength(1);
  await expect(saveVersion(RESULT, assessment)).rejects.toThrow();
  await expect(transition("approved", "in_review", "")).rejects.toThrow();
  await transition("changes_requested", "in_review");
  await expect(transition("approved", "in_review")).rejects.toThrow(/Status changed/);
});

it("records changes requested and approval without allowing audit mutation or deletion", async () => {
  await asUser(owner);
  await transition("in_review", "changes_requested", "Clarification provided");
  await asUser(reviewer);
  await transition("approved", "in_review");
  const events = (await db.query<{ to_status: string; actor_id: string; rules_version: string }>("select * from register.review_events order by id")).rows;
  expect(events.map((e) => e.to_status)).toEqual(["draft", "in_review", "changes_requested", "in_review", "approved"]);
  expect(events.at(-1)?.actor_id).toBe(reviewer);
  expect(events.every((e) => e.rules_version === "2.0")).toBe(true);
  expect(events.some((e) => JSON.stringify(e).includes("@"))).toBe(false);
  const names = (await db.query<{ actor_id: string; actor_name: string }>("select * from register.review_actor_names($1) order by actor_name", [version])).rows;
  expect(names).toEqual([{ actor_id: owner, actor_name: email(owner) }, { actor_id: reviewer, actor_name: email(reviewer) }]);
  await asUser(outsider);
  expect((await db.query("select * from register.review_actor_names($1)", [version])).rows).toHaveLength(0);
  for (const user of [reviewer, owner]) {
    await asUser(user);
    await expect(db.exec("update register.review_events set comment='rewritten'")).rejects.toThrow();
    await expect(db.exec("delete from register.review_events")).rejects.toThrow();
    await expect(db.exec("insert into register.review_events default values")).rejects.toThrow();
  }
  await asUser(owner);
  await db.query("delete from register.assessments where id=$1", [assessment]);
  expect((await db.query("select * from register.assessment_versions")).rows).toHaveLength(1);
  await db.query("select register.set_review_member($1,$2,null)", [workspace, reviewer]);
  await asUser(reviewer);
  expect((await db.query("select * from register.assessment_versions")).rows).toHaveLength(0);
  expect((await db.query("select * from register.review_events")).rows).toHaveLength(0);
});

it("allows an independent admin to reject and retains that record while new versions start draft", async () => {
  await asUser(submitter);
  const saved = (await saveVersion(RESULT)).rows[0];
  await db.query("select register.transition_review($1,$2,'in_review','Ready','draft')", [saved.id, workspace]);
  await asUser(owner);
  await db.query("select register.transition_review($1,$2,'rejected','Missing controls','in_review')", [saved.id, workspace]);
  await asUser(submitter);
  // Refused by policy, so the API reports that the record is retained rather than a constraint failure.
  expect((await db.query("delete from register.assessments where id=$1 returning id", [saved.assessment_id])).rows).toHaveLength(0);
  const newer = await saveVersion(RESULT, saved.assessment_id);
  expect(newer.rows[0].status).toBe("draft");
  await asUser(outsider);
  await db.query("select register.create_review_workspace('Other organization')");
  expect((await db.query("select * from register.assessment_versions")).rows).toHaveLength(0);
  await expect(db.query("select register.transition_review($1,$2,'approved','Attempt','rejected')", [saved.id, workspace])).rejects.toThrow();
});

it("refuses to save a version without a verified user, with a permission error", async () => {
  await asUser(owner);
  const id = (await db.query<{ id: string }>("insert into register.assessments default values returning id")).rows[0].id;
  // A privileged job bypasses RLS, so this reaches the audit trigger rather than the insert policy.
  await db.exec("reset role; select set_config('app.user_id','',false)");
  await expect(db.query("insert into register.assessment_versions(assessment_id,version,user_id,answers,result) values($1,1,$2,'{}',$3)",
    [id, owner, JSON.stringify(RESULT)])).rejects.toMatchObject({ code: "42501", message: "Sign in required" });
});

async function saveVersion(result: object, assessmentId?: string) {
  const id = assessmentId ?? (await db.query<{id:string}>("insert into register.assessments default values returning id")).rows[0].id;
  return db.query<{id:string;assessment_id:string;status:string}>(
    "insert into register.assessment_versions(assessment_id,version,answers,result) select $1,coalesce(max(version),0)+1,'{}',$2 from register.assessment_versions where assessment_id=$1 returning *",
    [id, JSON.stringify(result)]);
}

it("keeps all register and workflow access unavailable to browser roles", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role};`);
    for (const sql of ["select * from register.assessment_versions", "select * from register.review_events",
      "select register.create_review_workspace('Forgery')", "select public.save_assessment_version(null,'{}','{}')"]) {
      await expect(db.query(sql)).rejects.toThrow();
    }
  }
});
