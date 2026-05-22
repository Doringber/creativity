# qa-agent

An AI QA engineer for Python microservices.

## The thesis

Every existing "AI QA" tool does one of two things, and both miss the point:

1. **Test management UIs** (Qase, TestRail, Xray) — commodity chrome. Every team has one.
2. **AI test generators** (mabl, Testim, "let GPT write your tests") — produce mountains
   of happy-path unit tests against mocks. **Unit-test theater.** They almost never
   catch the bugs that actually ship: the SQL Server transaction that deadlocks under
   load, the Redis race between cache invalidate and DB commit, the async retry that
   double-charges a customer, the AWS SQS message lost because the consumer crashes
   between receive and ack.

`qa-agent` is the opposite shape. It is an agent that:

- Reads your git log and Jira tickets.
- Finds the code paths that cross **real boundaries** — DB, queue, cache, external
  API, async/await edges between services.
- Writes **real integration tests** against real services, via
  [`testcontainers`](https://testcontainers.com/) (SQL Server, Redis, Kafka, ...) and
  [LocalStack](https://localstack.cloud/) for AWS. No mocks where mocks lie.
- Runs the tests, and on failure produces a **structured triage verdict** —
  `test-bug`, `code-bug`, or `env-bug` — with evidence. Never auto-fixes; always
  pauses for human review.
- Persists what it learned about each service ("orders-service: every write to
  `orders` table must be followed by a Redis `DEL order:{id}` within 200ms") in a
  local memory store, so each run gets smarter.

## Status

Early scaffold. See `ROADMAP.md` for the slice plan.

## Quickstart

```bash
uv sync --extra llm --extra runner --extra memory
qa-agent --help
```

## Why local LLM by default

The agent reads your source code, your git log, your tickets. Running the model
locally (via Ollama) keeps all of that on your machine. The LLM client is
abstracted — swap to the Anthropic API in one line if you want more horsepower
for a specific run.

## Human in the loop

The agent never modifies your code or your tests without a human approving the
diff. Every proposed test goes into `proposed/`. Every triage verdict goes into
`verdicts/`. You decide what to merge.
