"""Task & Project Tracking Service written against SQLAlchemy 1.4 legacy patterns.

Demonstrates classic SQLAlchemy 1.4 patterns:
- declarative_base() factory
- engine.execute("SELECT ...") [Removed in 2.0]
- session.query(Model).get(id) [Deprecated/Legacy in 2.0; session.get(Model, id) preferred]
- session.query(Model).filter(...).all() [Legacy; 2.0 uses session.scalars(select(...))]
- session.query(Model).filter(...).update({...}) [Legacy query update]
"""

from typing import List, Optional
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False)
    email = Column(String(100), unique=True, nullable=False)

    tasks = relationship("Task", back_populates="assignee", cascade="all, delete-orphan")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    priority = Column(Integer, default=1)
    is_completed = Column(Boolean, default=False)

    assignee = relationship("User", back_populates="tasks")


class TaskService:
    """Service encapsulating database operations for users and tasks."""

    def __init__(self, database_url: str = "sqlite:///:memory:"):
        self.engine = create_engine(database_url)
        self.SessionLocal = sessionmaker(bind=self.engine)
        Base.metadata.create_all(self.engine)

    def get_session(self):
        return self.SessionLocal()

    def create_user(self, name: str, email: str) -> User:
        session = self.get_session()
        try:
            user = User(name=name, email=email)
            session.add(user)
            session.commit()
            session.refresh(user)
            return user
        finally:
            session.close()

    def get_user_by_id(self, user_id: int) -> Optional[User]:
        """Legacy 1.4 query.get lookup."""
        session = self.get_session()
        try:
            return session.query(User).get(user_id)
        finally:
            session.close()

    def create_task(self, user_id: int, title: str, priority: int = 1) -> Task:
        session = self.get_session()
        try:
            task = Task(user_id=user_id, title=title, priority=priority, is_completed=False)
            session.add(task)
            session.commit()
            session.refresh(task)
            return task
        finally:
            session.close()

    def list_active_tasks_for_user(self, user_id: int) -> List[Task]:
        """Legacy 1.4 query filtering."""
        session = self.get_session()
        try:
            return (
                session.query(Task)
                .filter(Task.user_id == user_id, Task.is_completed == False)
                .order_by(Task.priority.desc())
                .all()
            )
        finally:
            session.close()

    def complete_task(self, task_id: int) -> bool:
        """Legacy 1.4 query-level bulk update."""
        session = self.get_session()
        try:
            updated = (
                session.query(Task)
                .filter(Task.id == task_id)
                .update({"is_completed": True})
            )
            session.commit()
            return updated > 0
        finally:
            session.close()

    def execute_raw_sql(self, query: str) -> list:
        """Direct string execution on Engine. REMOVED completely in SQLAlchemy 2.0!"""
        result = self.engine.execute(query)
        return result.fetchall()

    def count_users_raw(self) -> int:
        """Raw scalar query on Engine. REMOVED completely in SQLAlchemy 2.0!"""
        val = self.engine.execute("SELECT count(*) FROM users").scalar()
        return int(val or 0)
