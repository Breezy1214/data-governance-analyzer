"""Register storage. Every query runs as the register_api role inside a transaction scoped to one verified user,
so the database's row-level security confines it to that user's rows (supabase/migrations)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, Protocol
from uuid import UUID

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool


class AssessmentNotFound(Exception):
    """The assessment doesn't exist or belongs to someone else; the two are deliberately indistinguishable."""


class AssessmentLocked(Exception):
    """A version has been submitted for review, so the assessment is retained and can't be deleted."""


Row = dict[str, Any]
REVIEW_QUEUE_LIMIT = 100


class RegisterStore(Protocol):
    def save(self, user_id: str, answers: Row, result: Row, assessment_id: UUID | None) -> tuple[UUID, int]: ...

    def entries(self, user_id: str) -> list[Row]: ...

    def versions(self, user_id: str, assessment_id: UUID) -> list[Row]: ...

    def delete(self, user_id: str, assessment_id: UUID) -> None: ...

    def review_workspaces(self, user_id: str) -> list[Row]: ...

    def review_queue(self, user_id: str) -> list[Row]: ...

    def review_context(self, user_id: str, version_id: UUID) -> Row: ...

    def create_workspace(self, user_id: str, name: str) -> None: ...

    def set_member(self, user_id: str, workspace_id: UUID, member_id: UUID, role: str | None) -> None: ...

    def transition(self, user_id: str, version_id: UUID, workspace_id: UUID | None, status: str, note: str,
                   expected_status: str) -> None: ...


class PostgresRegisterStore:
    def __init__(self, conninfo: str) -> None:
        self.pool = ConnectionPool(conninfo, min_size=1, max_size=5, open=False, kwargs={"row_factory": dict_row})

    def open(self) -> None:
        self.pool.open()

    def close(self) -> None:
        self.pool.close()

    @contextmanager
    def _as_user(self, user_id: str) -> Iterator[Connection[Row]]:
        with self.pool.connection() as conn, conn.transaction():
            conn.execute("select set_config('app.user_id', %s, true)", (user_id,))
            yield conn

    def save(self, user_id: str, answers: Row, result: Row, assessment_id: UUID | None) -> tuple[UUID, int]:
        with self._as_user(user_id) as conn:
            if assessment_id is None:
                assessment_id = conn.execute("insert into register.assessments default values returning id").fetchone()["id"]
            elif conn.execute("select 1 from register.assessments where id = %s", (assessment_id,)).fetchone() is None:
                raise AssessmentNotFound
            saved = conn.execute(
                """
                insert into register.assessment_versions (assessment_id, version, answers, result)
                select %(id)s, coalesce(max(version), 0) + 1, %(answers)s, %(result)s
                from register.assessment_versions where assessment_id = %(id)s
                returning version
                """,
                {"id": assessment_id, "answers": Jsonb(answers), "result": Jsonb(result)},
            ).fetchone()
            return assessment_id, saved["version"]

    def entries(self, user_id: str) -> list[Row]:
        with self._as_user(user_id) as conn:
            return conn.execute(
                "select assessment_id, version, version_count, status, score, risk_level, answers, saved_at"
                " from register.assessment_register order by saved_at desc"
            ).fetchall()

    def versions(self, user_id: str, assessment_id: UUID) -> list[Row]:
        with self._as_user(user_id) as conn:
            return conn.execute(
                "select id, version, status, answers, result, created_at, user_id = register.current_user_id() as owned"
                " from register.assessment_versions where assessment_id = %s order by version",
                (assessment_id,),
            ).fetchall()

    def delete(self, user_id: str, assessment_id: UUID) -> None:
        with self._as_user(user_id) as conn:
            if conn.execute("delete from register.assessments where id = %s returning id", (assessment_id,)).fetchone():
                return
            exists = conn.execute("select 1 from register.assessments where id = %s", (assessment_id,)).fetchone()
            raise AssessmentLocked if exists else AssessmentNotFound

    def review_workspaces(self, user_id: str) -> list[Row]:
        with self._as_user(user_id) as conn:
            return conn.execute(
                "select w.id, w.name, m.role from register.review_workspaces w"
                " join register.review_members m on m.workspace_id=w.id"
                " where m.user_id=register.current_user_id() order by w.name"
            ).fetchall()

    def review_queue(self, user_id: str) -> list[Row]:
        """Versions waiting on this caller's decision, oldest first. Decided versions stay on their own pages."""
        with self._as_user(user_id) as conn:
            return conn.execute("select * from register.review_queue(%s)", (REVIEW_QUEUE_LIMIT,)).fetchall()

    def review_context(self, user_id: str, version_id: UUID) -> Row:
        # RLS limits this lookup and audit rows to the owner/authorized workspace reviewer.
        with self._as_user(user_id) as conn:
            version = conn.execute(
                "select r.workspace_id, register.review_role(r.workspace_id) as role"
                " from register.assessment_versions v left join register.version_reviews r on r.version_id=v.id"
                " where v.id=%s", (version_id,)
            ).fetchone()
            if version is None:
                raise AssessmentNotFound
            events = conn.execute(
                "select e.*, coalesce(n.actor_name, e.actor_label) as actor_name from register.review_events e"
                " left join register.review_actor_names(%s) n on n.actor_id=e.actor_id"
                " where e.version_id=%s order by e.id", (version_id, version_id)
            ).fetchall()
            return {"workspaceId": version["workspace_id"], "role": version["role"], "events": events}

    def create_workspace(self, user_id: str, name: str) -> None:
        with self._as_user(user_id) as conn:
            conn.execute("select register.create_review_workspace(%s)", (name,))

    def set_member(self, user_id: str, workspace_id: UUID, member_id: UUID, role: str | None) -> None:
        with self._as_user(user_id) as conn:
            conn.execute("select register.set_review_member(%s,%s,%s)", (workspace_id, member_id, role))

    def transition(self, user_id: str, version_id: UUID, workspace_id: UUID | None, status: str, note: str,
                   expected_status: str) -> None:
        with self._as_user(user_id) as conn:
            conn.execute("select register.transition_review(%s,%s,%s,%s,%s)",
                         (version_id, workspace_id, status, note, expected_status))
