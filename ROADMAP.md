# Roadmap

The agent core ships first. The Qase-killer UI comes after — built on top of the
SQLite store the agent already produces.

## Phase 1 — agent core (CLI)

- [x] **1. Scaffold** — package, CLI skeleton, sane deps, this roadmap.
- [ ] **2. `analyze` (heuristic)** — git log + AST walk. Flag files that touch a real
      boundary (`sqlalchemy`, `redis`, `boto3`, `httpx`, `aio_pika`, `aiokafka`,
      `pyodbc`, ...) and have no integration test alongside. No LLM yet.
- [ ] **3. `analyze` (LLM-augmented)** — local model (Ollama) re-ranks gaps by risk,
      writes one-paragraph rationale per gap, considers ticket text from Jira (or a
      pasted prompt for v1).
- [ ] **4. `propose`** — given a gap, generate a pytest module that uses
      `testcontainers` (SQL Server, Redis) and LocalStack (S3, SQS) to test the real
      boundary. Output goes to `proposed/{gap_id}.py`. Never auto-committed.
- [ ] **5. `run` + structured triage** — execute the proposed test (or any test).
      On failure, the agent classifies the failure: `test-bug | code-bug | env-bug`,
      with evidence (diff context, ticket text, run trace). Pause for human review.
- [ ] **6. Memory** — SQLite + sqlite-vec. Persist per-service invariants the agent
      has learned. Retrieval during `propose` and `triage`.
- [ ] **7. Demo microservice** — a tiny FastAPI orders service with real SQL Server +
      Redis dependencies and a couple of intentional bugs, so we can run the whole
      loop end-to-end as a smoke test.

## Phase 2 — surfaces

- [ ] Jira ingest (real, not pasted).
- [ ] Playwright (web + API) runner alongside pytest.
- [ ] BrowserStack mobile run.
- [ ] React + Vite UI (Docker) on top of the existing SQLite — the Qase view.

## Phase 3 — learning loop

- [ ] Cluster failure traces. Identify recurring failure shapes per service.
- [ ] Promote learned invariants to "always test" assertions.
- [ ] Continuous mode: subscribe to git pushes, propose gaps automatically.

## Non-goals (for now)

- A general-purpose code generator. The agent is narrow: integration tests for
  Python microservices on SQL Server / Redis / AWS / async.
- Auto-fixing application code. The agent files a triage verdict; humans fix code.
- Replacing unit tests. The agent assumes unit tests exist; it finds what they miss.
