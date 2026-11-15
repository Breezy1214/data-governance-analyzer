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
    """A version is in review or approved, so the assessment can't be deleted."""


Row = dict[str, Any]


class RegisterStore(Protocol):
    def save(self, user_id: str, answers: Row, result: Row, assessment_id: UUID | None) -> tuple[UUID, int]: ...

    def entries(self, user_id: str) -> list[Row]: ...

    def versions(self, user_id: str, assessment_id: UUID) -> list[Row]: ...

    def delete(self, user_id: str, assessment_id: UUID) -> None: ...


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
                "select id, version, status, answers, result, created_at from register.assessment_versions"
                " where assessment_id = %s order by version",
                (assessment_id,),
            ).fetchall()

    def delete(self, user_id: str, assessment_id: UUID) -> None:
        with self._as_user(user_id) as conn:
            if conn.execute("delete from register.assessments where id = %s returning id", (assessment_id,)).fetchone():
                return
            exists = conn.execute("select 1 from register.assessments where id = %s", (assessment_id,)).fetchone()
            raise AssessmentLocked if exists else AssessmentNotFound
