"""Unit tests of the kind a real team actually ships.

Everything across a real boundary is mocked. The tests pass, coverage looks
fine, and BUG-1 and BUG-2 in `orders_service/main.py` ship anyway. This is
the unit-test theater `qa-agent` is built to defeat.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from orders_service.main import CreateOrderRequest, create_order


@patch("orders_service.main.cache")
@patch("orders_service.main.storage")
@patch("orders_service.main.db")
def test_create_order_persists_and_returns(mock_db, mock_storage, mock_cache):
    fake_session = MagicMock()
    fake_session.__enter__.return_value = fake_session
    fake_order = MagicMock(id=42)
    fake_session.refresh.side_effect = lambda o: setattr(o, "id", 42)
    mock_db.session.return_value = fake_session
    mock_storage.upload_receipt.return_value = "s3://orders-receipts/receipts/42.txt"

    req = CreateOrderRequest(customer_id="c-1", sku="SKU-1", quantity=1, amount_cents=999)
    resp = create_order(req, idempotency_key="abc")

    assert resp.id == 42
    assert resp.receipt_url.endswith("/42.txt")
    mock_cache.invalidate.assert_called_once_with(42)


@patch("orders_service.main.cache")
@patch("orders_service.main.db")
def test_get_order_uses_cache_when_present(mock_db, mock_cache):
    mock_cache.get.return_value = {
        "id": 7, "customer_id": "c-1", "sku": "SKU-1",
        "quantity": 1, "amount_cents": 999,
    }
    resp = __import__(
        "orders_service.main", fromlist=["get_order"]
    ).get_order(7)
    assert resp.id == 7
    mock_db.session.assert_not_called()
