# orders-service (example target)

A deliberately tiny FastAPI microservice used as the demo target for
`qa-agent`. It touches three real boundaries: **SQL Server** (via SQLAlchemy
+ pyodbc), **Redis** (cache), and **S3** (via boto3, against LocalStack in
test).

It ships with the kind of test suite that real teams actually have: a unit
test file that mocks every boundary. The unit tests pass, coverage looks
fine, and the bugs below ship anyway. This is the unit-test theater
`qa-agent` is designed to defeat.

## Intentional integration bugs

These are real bugs. Unit tests with mocks will not catch them; integration
tests against the real services will.

### BUG-1 — cache invalidation race

`POST /orders` writes to SQL, then calls `cache.invalidate(order_id)`. The
two operations are not atomic. If the Redis `DEL` fails (network hiccup,
Redis restart, key eviction edge), the database is updated but the cache
still serves stale data for the entire TTL.

Mock-based unit tests cannot see this: a mocked Redis client always
"succeeds" or "fails" deterministically, never both partially in
realistic ways.

### BUG-2 — missing idempotency on order creation

`POST /orders` accepts an `Idempotency-Key` header but does not use it.
A client that retries on a network timeout creates a duplicate order
**and** uploads a duplicate receipt to S3.

Unit tests with mocks never see this because the mock counts calls the way
the test author expected, not the way a real retry-storm produces them.

## Run

```bash
uv sync
pytest                                                       # unit tests pass
uvicorn orders_service.main:app --reload                     # needs real SQL+Redis+S3
```
