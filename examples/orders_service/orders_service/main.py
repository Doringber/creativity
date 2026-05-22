from __future__ import annotations

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import cache, db, storage
from .models import Order

app = FastAPI(title="orders-service")


class CreateOrderRequest(BaseModel):
    customer_id: str = Field(min_length=1)
    sku: str = Field(min_length=1)
    quantity: int = Field(gt=0)
    amount_cents: int = Field(ge=0)


class OrderResponse(BaseModel):
    id: int
    customer_id: str
    sku: str
    quantity: int
    amount_cents: int
    receipt_url: str | None = None


@app.on_event("startup")
def _startup() -> None:
    db.init_schema()


@app.post("/orders", response_model=OrderResponse, status_code=201)
def create_order(
    req: CreateOrderRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> OrderResponse:
    # BUG-2: Idempotency-Key is accepted from the client but never used.
    # A client retry produces a duplicate row AND a duplicate receipt upload.

    with db.session() as s:
        order = Order(
            customer_id=req.customer_id,
            sku=req.sku,
            quantity=req.quantity,
            amount_cents=req.amount_cents,
        )
        s.add(order)
        s.commit()
        s.refresh(order)
        order_id = int(order.id)

    receipt_body = (
        f"order={order_id} customer={req.customer_id} "
        f"sku={req.sku} qty={req.quantity} amount={req.amount_cents}"
    )
    receipt_url = storage.upload_receipt(order_id, receipt_body)

    # BUG-1: DB write and cache invalidate are not atomic.
    # If invalidate() raises, the DB is updated but the cache will serve
    # stale data for ORDER_TTL_SECONDS.
    cache.invalidate(order_id)

    return OrderResponse(
        id=order_id,
        customer_id=req.customer_id,
        sku=req.sku,
        quantity=req.quantity,
        amount_cents=req.amount_cents,
        receipt_url=receipt_url,
    )


@app.get("/orders/{order_id}", response_model=OrderResponse)
def get_order(order_id: int) -> OrderResponse:
    cached = cache.get(order_id)
    if cached:
        return OrderResponse(**cached)

    with db.session() as s:
        order = s.get(Order, order_id)
        if order is None:
            raise HTTPException(status_code=404, detail="order not found")
        payload = {
            "id": int(order.id),
            "customer_id": order.customer_id,
            "sku": order.sku,
            "quantity": int(order.quantity),
            "amount_cents": int(order.amount_cents),
        }

    cache.put(order_id, payload)
    return OrderResponse(**payload)
