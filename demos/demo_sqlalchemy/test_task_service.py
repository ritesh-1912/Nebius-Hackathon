"""Test suite for TaskService written against SQLAlchemy 1.4 patterns.

On SQLAlchemy 1.4, all tests pass.
On SQLAlchemy 2.0 without migration:
- test_05 and test_06 FAIL with: AttributeError: 'Engine' object has no attribute 'execute'
"""

import pytest
from task_service import TaskService


@pytest.fixture
def service():
    # Fresh in-memory database for each test
    return TaskService("sqlite:///:memory:")


def test_01_create_user_and_get_by_id(service):
    user = service.create_user("Bob Builder", "bob@example.com")
    assert user.id is not None
    fetched = service.get_user_by_id(user.id)
    assert fetched is not None
    assert fetched.name == "Bob Builder"
    assert fetched.email == "bob@example.com"


def test_02_get_nonexistent_user_returns_none(service):
    fetched = service.get_user_by_id(9999)
    assert fetched is None


def test_03_create_and_list_active_tasks(service):
    user = service.create_user("Dev Lead", "lead@example.com")
    t1 = service.create_task(user.id, "Setup CI", priority=2)
    t2 = service.create_task(user.id, "Write unit tests", priority=5)

    active = service.list_active_tasks_for_user(user.id)
    assert len(active) == 2
    # Ordered by priority desc
    assert active[0].id == t2.id
    assert active[1].id == t1.id


def test_04_complete_task_status_update(service):
    user = service.create_user("Engineer", "eng@example.com")
    task = service.create_task(user.id, "Refactor models")
    assert task.is_completed is False

    success = service.complete_task(task.id)
    assert success is True

    active = service.list_active_tasks_for_user(user.id)
    assert len(active) == 0


def test_05_engine_execute_raw_select(service):
    """Fails on SQLAlchemy 2.0 because engine.execute() is removed."""
    service.create_user("Charlie", "charlie@example.com")
    rows = service.execute_raw_sql("SELECT name, email FROM users")
    assert len(rows) == 1
    assert rows[0][0] == "Charlie"


def test_06_engine_execute_count_scalar(service):
    """Fails on SQLAlchemy 2.0 because engine.execute() is removed."""
    assert service.count_users_raw() == 0
    service.create_user("User 1", "u1@example.com")
    service.create_user("User 2", "u2@example.com")
    assert service.count_users_raw() == 2


def test_07_user_cascade_relationship(service):
    user = service.create_user("Dan", "dan@example.com")
    service.create_task(user.id, "Task 1")
    service.create_task(user.id, "Task 2")

    session = service.get_session()
    u = service.get_user_by_id(user.id)
    session.add(u)
    assert len(u.tasks) == 2
    session.close()


def test_08_multiple_users_isolated_tasks(service):
    u1 = service.create_user("User A", "a@example.com")
    u2 = service.create_user("User B", "b@example.com")

    service.create_task(u1.id, "Task A1")
    service.create_task(u2.id, "Task B1")
    service.create_task(u2.id, "Task B2")

    assert len(service.list_active_tasks_for_user(u1.id)) == 1
    assert len(service.list_active_tasks_for_user(u2.id)) == 2
