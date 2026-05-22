from __future__ import annotations

import io
import os

import boto3


_s3 = boto3.client(
    "s3",
    endpoint_url=os.environ.get("ORDERS_S3_ENDPOINT", "http://localhost:4566"),
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)

RECEIPTS_BUCKET = os.environ.get("ORDERS_RECEIPTS_BUCKET", "orders-receipts")


def upload_receipt(order_id: int, body: str) -> str:
    key = f"receipts/{order_id}.txt"
    _s3.upload_fileobj(io.BytesIO(body.encode("utf-8")), RECEIPTS_BUCKET, key)
    return f"s3://{RECEIPTS_BUCKET}/{key}"
