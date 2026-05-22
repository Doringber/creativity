from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .models import Base


def _dsn() -> str:
    return os.environ.get(
        "ORDERS_DB_DSN",
        "mssql+pyodbc://sa:Strong!Passw0rd@localhost:1433/orders"
        "?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes",
    )


_engine = create_engine(_dsn(), pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)


def init_schema() -> None:
    Base.metadata.create_all(_engine)


def session() -> Session:
    return SessionLocal()
