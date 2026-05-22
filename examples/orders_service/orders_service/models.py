from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, Numeric, String, func
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(String(64), nullable=False, index=True)
    sku = Column(String(64), nullable=False)
    quantity = Column(Integer, nullable=False)
    amount_cents = Column(Numeric(12, 0), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
