# Time-Off Microservice — Technical Requirements Document (TRD)

**Project:** ExampleHR Time-Off Microservice
**Author:** Marcos Nocetti (with agentic development)
**Date:** 2026-04-22
**Status:** Draft for review

---

## 1. Context

ExampleHR is the employee-facing module for time-off requests. The Human Capital
Management (HCM) system (Workday/SAP class) remains the **source of truth** for
employment data, including time-off balances. This service must:

- Manage the full lifecycle of a time-off request (submission, approval, rejection, cancellation).
- Maintain balance integrity between ExampleHR and HCM, even though HCM may be
  updated by other systems (work-anniversary credits, yearly resets, manual corrections).
- Be defensive against unreliable HCM error reporting (HCM may silently accept invalid
  requests; we must validate locally too).

### Personas

| Persona | Needs |
|---|---|
| Employee | Accurate balance view; instant feedback on submission |
| Manager | Approve/reject with confidence the data is valid |
| HCM (system) | Push refreshes (batch + realtime) and accept reservations/confirmations |

### Trust boundary (assumption)

Authentication/identity is delegated to an upstream gateway. This service receives
trusted headers `x-employee-id` and `x-role` (`employee | manager | admin`).
Justification: in idiomatic microservice deployments, auth lives in the gateway/sidecar,
keeping each service focused on its bounded context. Production deployment must enforce
that these headers are not forgeable from outside the gateway. JWT, refresh tokens,
SSO, and multi-tenant isolation are explicitly out of scope.

---

## 2. Functional Requirements

### FR-1 — Balance read
- **FR-1.1** Return current balance per `(employeeId, locationId)`, derived as
  `totalDays − sum(pending + confirmed movements)`.
- **FR-1.2** Allow `?strategy=fresh` to force a synchronous HCM lookup before
  returning, used by managers before approving large requests.

### FR-2 — Request lifecycle
- **FR-2.1** Employee creates a request with `{locationId, startDate, endDate, idempotencyKey}`.
- **FR-2.2** Service validates locally (date range, available balance, no overlap with
  existing approved requests) **before** asking HCM.
- **FR-2.3** If local validation passes, the request is created with
  `status=PENDING_APPROVAL, sagaState=RESERVING_HCM` and an outbox entry is enqueued
  to reserve the days in HCM.
- **FR-2.4** When HCM acknowledges the reservation, `sagaState` advances to
  `AWAITING_APPROVAL` (status remains `PENDING_APPROVAL`).
- **FR-2.5** Manager approves or rejects; approval triggers a confirmation in HCM,
  rejection triggers compensation (release of reservation).
- **FR-2.6** Employee may cancel before manager action (compensates HCM reservation).
- **FR-2.7** Idempotency: re-sending the same `idempotencyKey` returns the existing request.

### FR-3 — HCM sync
- **FR-3.1** Outbound: every state-changing action against HCM is published via a
  transactional outbox and processed by a worker with retry + dead-letter.
- **FR-3.2** Inbound (batch): `POST /hcm-webhook/batch` accepts the full corpus of
  balances and triggers reconciliation.
- **FR-3.3** Inbound (realtime): `POST /hcm-webhook/realtime` accepts a single delta
  (e.g., work-anniversary credit) and applies it.
- **FR-3.4** Reconciliation must preserve in-flight reservations (drift must not
  invalidate `PENDING_APPROVAL` requests).

### FR-4 — Observability
- **FR-4.1** Structured JSON logs with `requestId`, `sagaId`, `employeeId`,
  `correlationId` propagated end to end.
- **FR-4.2** `/health` (liveness), `/health/ready` (readiness — DB + Redis + HCM).
- **FR-4.3** Metrics surface (Prometheus-friendly) for: outbox depth, dead-letter count,
  saga duration, HCM error rate, drift events.

---

## 3. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | All write paths must be safe under concurrent access (no negative balances, no double-spend) |
| NFR-2 | Worker retries with exponential backoff (1s, 5s, 25s, 2min, 10min) before DLQ |
| NFR-3 | Local read latency p95 < 50ms (SQLite + index hits) |
| NFR-4 | Reconciliation of 10k balances completes in < 60s in chunks of 500 |
| NFR-5 | Test coverage ≥ 90% statements/branches in domain layer |
| NFR-6 | Service must boot to ready < 5s for fast iteration |
| NFR-7 | Service must run end-to-end with a single `docker compose up` |

---

## 4. Architecture

### 4.1 High-level diagram

```
        ┌─────────────────┐
        │  API Gateway    │  (out of scope; provides x-employee-id, x-role)
        └────────┬────────┘
                 │
   ┌─────────────┼──────────────────────────────────────────┐
   │             ▼                                          │
   │   ┌────────────────┐    ┌────────────────┐             │
   │   │  timeoff-api   │───▶│   SQLite       │             │
   │   │   (NestJS)     │    │  (Prisma)      │             │
   │   └────┬───────────┘    └────────────────┘             │
   │        │ outbox poll                                   │
   │        ▼                                               │
   │   ┌────────────────┐    ┌────────────────┐             │
   │   │  worker        │───▶│   Redis +      │             │
   │   │  (NestJS,      │    │   BullMQ       │             │
   │   │   same image)  │    └────────────────┘             │
   │   └────────┬───────┘                                   │
   │            │ HTTP                                      │
   │            ▼                                           │
   │   ┌────────────────┐                                   │
   │   │   hcm-mock     │  (separate NestJS app, simulates │
   │   │   (NestJS)     │   HCM behavior + admin hooks for │
   │   └────────────────┘   tests)                         │
   │                                                        │
   └────────────────────── docker-compose ──────────────────┘
```

### 4.2 Module layout (hexagonal-light)

Each business module separates `application/` (use cases, orchestrators),
`domain/` (entities, invariants, value objects, errors) and `infrastructure/`
(Prisma repos, HTTP clients). Dependencies point inward; domain has zero imports
from NestJS or Prisma.

```
apps/timeoff-api/src/
├── modules/
│   ├── balances/        # read model + ledger derivation
│   ├── requests/        # CRUD + saga orchestration
│   ├── reconciliation/  # batch & realtime HCM ingestion
│   ├── outbox/          # transactional outbox pattern
│   ├── hcm-client/      # HcmPort interface + Http/InMemory adapters
│   └── health/
├── shared/
│   ├── context/         # request-scoped correlation IDs
│   ├── errors/          # DomainError hierarchy
│   └── logging/         # Pino setup
├── workers/             # BullMQ processors
└── main.ts
```

### 4.3 Domain model (Prisma)

```prisma
model Balance {
  employeeId      String
  locationId      String
  totalDays       Decimal   // mirror of HCM, source of truth
  version         Int       // optimistic lock
  hcmLastSeenAt   DateTime  // last time HCM confirmed this row
  updatedAt       DateTime  @updatedAt
  @@id([employeeId, locationId])
}

model TimeOffMovement {
  id           String   @id @default(uuid())
  employeeId   String
  locationId   String
  delta        Decimal  // negative = consumption, positive = credit/release
  type         MovementType
  requestId    String?
  hcmSyncedAt  DateTime?
  createdAt    DateTime @default(now())
  @@index([employeeId, locationId, createdAt])
}

enum MovementType {
  PENDING_RESERVATION   // local hold while saga runs
  CONFIRMED             // approved + committed in HCM
  CANCELLED             // released
  HCM_REFRESH           // delta from batch/realtime HCM event
}

model TimeOffRequest {
  id             String        @id @default(uuid())
  employeeId     String
  locationId     String
  startDate      DateTime
  endDate        DateTime
  days           Decimal
  status         RequestStatus
  sagaState      SagaState
  idempotencyKey String        @unique
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@index([employeeId, status])
}

enum RequestStatus {
  PENDING_APPROVAL
  APPROVED
  REJECTED
  CANCELLED
  FAILED
}

enum SagaState {
  RESERVING_HCM         // outbox dispatched, awaiting HCM ack of reservation
  AWAITING_APPROVAL     // HCM acknowledged; manager action pending
  COMMITTING_HCM        // approval issued, confirming with HCM
  COMPENSATING_HCM      // reject/cancel issued, releasing HCM reservation
  TERMINAL              // request reached APPROVED, REJECTED, CANCELLED or FAILED
}

model OutboxEntry {
  id            String       @id @default(uuid())
  aggregateId   String
  eventType     String       // RESERVE_HCM | CONFIRM_HCM | COMPENSATE_HCM
  payload       String       // JSON
  status        OutboxStatus
  attempts      Int          @default(0)
  nextAttemptAt DateTime     @default(now())
  lastError     String?
  createdAt     DateTime     @default(now())
  @@index([status, nextAttemptAt])
}

enum OutboxStatus {
  PENDING
  DISPATCHED
  FAILED
  DEAD
}
```

`available_days` is derived, never persisted:
```
available = Balance.totalDays
          − SUM(movements.delta where type ∈ {PENDING_RESERVATION, CONFIRMED})
```
HCM_REFRESH movements record the audit trail of HCM-driven changes but are not
subtracted because they are already absorbed into `Balance.totalDays`.

### 4.4 Saga state machine (request creation → terminal)

```
   POST /requests
        │ validate idempotencyKey, dates, local available
        ▼
   RESERVING_HCM ─── TX { request(status=PENDING_APPROVAL, sagaState=RESERVING_HCM)
                          + outbox(RESERVE_HCM)
                          + movement(PENDING_RESERVATION, delta=-days) }
        │
        ▼ outbox dispatcher → BullMQ → worker calls HCM.reserve()
        │
        ├─ HCM 2xx ────────▶ AWAITING_APPROVAL  (status still PENDING_APPROVAL)
        │                          │
        │              manager approve / reject — employee cancel
        │                          │
        │                          ├──▶ COMMITTING_HCM   ──HCM 2xx──▶ status=APPROVED, sagaState=TERMINAL
        │                          │                                 (movement: PENDING_RESERVATION → CONFIRMED)
        │                          │
        │                          └──▶ COMPENSATING_HCM ──HCM 2xx──▶ status=REJECTED|CANCELLED, sagaState=TERMINAL
        │                                                            (movement: PENDING_RESERVATION → CANCELLED, releases reservation)
        │
        ├─ HCM 4xx (insufficient/invalid) ▶ refresh balance from HCM, re-validate locally;
        │                                    if still infeasible: insert CANCELLED movement (releases reservation),
        │                                    set status=FAILED, sagaState=TERMINAL
        │
        └─ HCM 5xx / timeout ▶ remain in RESERVING_HCM, BullMQ retries with backoff
                               │
                               └─ after 5 attempts ▶ DLQ; ops can call POST /requests/:id/force-fail
                                                     which inserts CANCELLED movement and marks TERMINAL
```

Invariants enforced by the state machine:
- A request never skips a state (no direct `RESERVING_HCM → APPROVED` jump).
- Worker handlers are **idempotent**: they read current state and no-op on terminal.
- Every path that ends in `TERMINAL` with `status ∈ {REJECTED, CANCELLED, FAILED}` writes
  a `CANCELLED` movement that offsets the original `PENDING_RESERVATION`, restoring
  available balance. Only `APPROVED` paths convert the reservation into `CONFIRMED`.
- A request remains in `PENDING_APPROVAL` request-status while the saga is in either
  `RESERVING_HCM` or `AWAITING_APPROVAL`; UI should treat both as "awaiting" but `sagaState`
  is the operator-facing detail.

### 4.5 Reconciliation

**Batch path** (`POST /hcm-webhook/batch`):
```
1. Persist raw payload, return 202 Accepted.
2. Enqueue ReconcileBatchJob with chunks of 500 (employeeId, locationId, hcmTotal, hcmTimestamp).
3. For each chunk, in a single transaction per row:
     SELECT balance FOR UPDATE
     IF hcmTimestamp > balance.hcmLastSeenAt:
       INSERT movement(type=HCM_REFRESH, delta = hcmTotal − balance.totalDays)
       UPDATE balance SET totalDays = hcmTotal, version++, hcmLastSeenAt = hcmTimestamp
     ELSE: skip (we already saw a newer truth)
4. Compute diff stats; if |delta| > threshold for any balance, emit DRIFT_DETECTED log/metric.
```

In-flight reservations survive because they are derived from `movements`, not from
a stored `available` field. After reconciliation, `available = newTotal − stillPendingReservations`.

**Realtime path** (`POST /hcm-webhook/realtime`):
Same logic, single row, processed inline (low volume expected).

### 4.6 Defensive validation

Every HCM response is treated as untrusted:
- Before marking `PENDING_APPROVAL`, re-validate `available ≥ days` locally. If not,
  treat as drift signal → invalidate balance, force refresh, fail saga with
  `INSUFFICIENT_BALANCE_AFTER_DRIFT`.
- Before `APPROVED`, the same check runs. This catches the case where HCM accepted
  a confirm but our ledger says it shouldn't have (logged as `HCM_PROTOCOL_VIOLATION`).

---

## 5. API Surface

OpenAPI spec is generated by `@nestjs/swagger` and served at `/docs`.

| Method | Path | Role | Body / Query | Response |
|---|---|---|---|---|
| GET | `/balances/:employeeId` | employee, manager | `?strategy=local\|fresh` | `[{locationId, total, available, version}]` |
| POST | `/requests` | employee | `{locationId, startDate, endDate, idempotencyKey}` | `201 {id, status, sagaState}` |
| GET | `/requests/:id` | employee, manager | — | full request + saga history |
| GET | `/requests` | employee, manager | `?status=&employeeId=` | paginated list |
| POST | `/requests/:id/approve` | manager | — | `200 {id, status}` |
| POST | `/requests/:id/reject` | manager | `{reason?}` | `200` |
| POST | `/requests/:id/cancel` | employee | — | `200` |
| POST | `/requests/:id/force-fail` | admin | `{reason}` | `200` — manual recovery for DLQ'd sagas; releases reservation |
| POST | `/hcm-webhook/batch` | admin | full corpus payload | `202 {jobId}` |
| POST | `/hcm-webhook/realtime` | admin | `{employeeId, locationId, newTotal, hcmTimestamp}` | `200` |
| GET | `/health` | — | — | `{status: "ok"}` |
| GET | `/health/ready` | — | — | `{db, redis, hcm: "ok\|degraded\|down"}` |
| GET | `/docs` | — | — | Swagger UI |

Error shape (RFC 7807-inspired):
```json
{
  "type": "https://examplehr/errors/insufficient-balance",
  "title": "Insufficient balance",
  "detail": "Employee has 3 days available, requested 5",
  "code": "INSUFFICIENT_BALANCE",
  "correlationId": "..."
}
```

---

## 6. Test Strategy

The PDF emphasizes that with agentic development the **rigor of the test suite is the
deliverable**. We test at every level the system can fail.

| Layer | Tool | Goal |
|---|---|---|
| Unit | Jest | Pure logic: balance calc, saga transitions, DTO validation |
| Integration | Jest + supertest + Prisma (SQLite file per test) | Module + DB, mocking only the HcmPort |
| Smoke | Jest + docker-compose | Whole system up, golden paths only |
| Property-based | fast-check | Invariants under arbitrary input sequences |
| Concurrency | Jest + Promise.all + fast-check | No race conditions on balance writes |
| Contract | Jest + JSON Schema | HCM mock and real adapter agree on shape |
| E2E | Jest + supertest + real HCM mock | Full HTTP flow including webhooks |

### 6.1 Critical "proof" tests

**T-1 Race condition.** 50 concurrent `POST /requests` for the same employee with
balance = 10, each requesting 1 day. Expected: exactly 10 succeed, 40 fail with
`INSUFFICIENT_BALANCE`, final balance = 0, no negative movements.

**T-2 Drift survival.** Employee balance = 10. Create request for 5 (→ `PENDING_APPROVAL`).
HCM batch arrives with new total = 15 (work anniversary). Expected: request still valid,
`available = 15 − 5 = 10`, ledger has both `PENDING_RESERVATION(-5)` and `HCM_REFRESH(+5)`.

**T-3 HCM unavailable.** HCM mock injected to return 503. Create 10 requests. Expected:
all enter `RESERVING_HCM`, none progress further. `/health/ready` reports `hcm: down`.
After mock recovers, all transition to `PENDING_APPROVAL` within next retry window.

**T-4 Idempotency.** Same `idempotencyKey` posted 5 times concurrently. Exactly one
request created. All 5 responses return the same request id and status.

**T-5 Saga compensation.** Approve a request → HCM confirm fails 5x → job lands in DLQ.
Operator calls `POST /requests/:id/force-fail` → ledger inserts `CANCELLED` movement
that offsets the original `PENDING_RESERVATION`, request → `FAILED`, available balance
restored.

**T-6 Defensive HCM.** HCM accepts a request that should have been refused (insufficient
balance). Local re-validation catches it, logs `HCM_PROTOCOL_VIOLATION`, fails the saga.

### 6.2 Coverage proof
- `jest --coverage` artifact uploaded by CI.
- Per-module thresholds enforced in `jest.config.ts`: domain ≥ 95%, application ≥ 90%,
  infrastructure ≥ 80%.

---

## 7. Performance considerations

| Operation | Complexity | Notes |
|---|---|---|
| Balance read | O(1) for `Balance` row + O(n) over open movements; n bounded by approvals/year per employee | Index on `(employeeId, locationId, createdAt)`; periodically compact `CONFIRMED` movements into a snapshot if n grows |
| Request create | O(1) DB writes (3 inserts in 1 TX) | Outbox poll is O(batch_size) per tick |
| Batch reconciliation | O(N) where N = balances in batch | Chunked (500/tx), parallelisable across workers; per-row `SELECT FOR UPDATE` avoids cross-row contention |
| Outbox dispatch | O(k) where k = pending entries (bounded by `LIMIT`) | Indexed by `(status, nextAttemptAt)` |
| Saga progression | O(1) per worker job | BullMQ concurrency configurable; default 10 |

Concurrency control:
- SQLite does not support row-level `SELECT FOR UPDATE`; instead, all balance-affecting
  writes wrap their work in a transaction opened with **`BEGIN IMMEDIATE`**, which
  acquires the database-wide reserved-write lock up front and serializes writers
  cleanly. Reads remain non-blocking (WAL mode).
- On top of the lock, every `Balance` update includes an **optimistic `version` check**
  (`UPDATE ... WHERE version = ?`); a mismatch aborts the transaction and the caller
  retries by re-reading the row. This protects against logic-level lost updates even
  if the locking strategy is later relaxed.
- The outbox poller selects pending entries in small batches and atomically claims
  each by updating `status = DISPATCHED` within the same `BEGIN IMMEDIATE` transaction;
  this gives effective `SKIP LOCKED` semantics on SQLite without holding long locks.
- Production deployment on Postgres (a likely future migration) would gain real
  `SELECT FOR UPDATE SKIP LOCKED` and finer-grained row locks; the design intentionally
  does not depend on SQLite specifics beyond `BEGIN IMMEDIATE` semantics.

---

## 8. Alternatives considered

### 8.1 Sync write-through to HCM (rejected)
Call HCM synchronously from the request handler; persist locally only on success.

- Pro: simpler, strong consistency.
- Con: latency tied to HCM, cannot serve any traffic if HCM is down, no audit trail
  of intent vs commit, no clear retry semantics.

Rejected because it fails NFR-7 (system unusable without HCM up) and the PDF
explicitly says HCM may behave unreliably.

### 8.2 Pure async optimistic local writes (rejected)
Save locally, push to HCM later, accept HCM as the eventual reconciler.

- Pro: fastest UX, simplest worker.
- Con: no defined behavior on HCM rejection, can over-promise to employees, manager
  approves on stale data.

Rejected because it does not honor HCM as source of truth and offers no defensive
posture against HCM disagreeing later.

### 8.3 Event sourcing (rejected)
Model every change as an event, derive everything from the log.

- Pro: perfect audit, full replayability, naturally absorbs HCM_REFRESH events.
- Con: significantly more complexity (snapshots, projections, schema evolution),
  overkill for a take-home and for the actual problem size.

Rejected as YAGNI. Our movement ledger gives us 80% of the audit benefit at 20% of
the cost.

### 8.4 GraphQL (rejected)
Single endpoint with flexible queries.

- Pro: client-driven shape.
- Con: this is a system-to-system service with stable, narrow contracts; REST + OpenAPI
  is more honest about the surface and easier to test/document.

### 8.5 Pessimistic locking only (rejected)
Use `SELECT FOR UPDATE` exclusively, no version field.

- Pro: simpler reasoning.
- Con: under SQLite's writer-lock semantics, holding locks across HCM I/O would
  serialize all requests for an employee on the network call. Optimistic version
  + short locks let us release before talking to HCM and recover via retry.

---

## 9. Observability

- **Logs**: Pino JSON, fields `requestId`, `sagaId`, `employeeId`, `locationId`,
  `correlationId`, `hcmLatencyMs`, `event`. Correlated end-to-end via async-local-storage.
- **Metrics** (Prometheus-compatible at `/metrics`):
  - `outbox_pending_total{status}`, `outbox_dead_total`
  - `saga_duration_seconds_bucket{transition}`
  - `hcm_request_total{op,status}`, `hcm_request_duration_seconds_bucket`
  - `drift_events_total`, `drift_magnitude_days`
- **Health**: `/health` (process up); `/health/ready` (DB ping, Redis ping, HCM circuit state).

---

## 10. Failure modes & mitigations

| Failure | Detection | Mitigation |
|---|---|---|
| HCM down | Worker timeouts, readiness flips to `degraded` | Saga stays in transient state; worker retries; reads still served from local |
| Outbox grows unbounded | `outbox_pending_total` metric + alert | Worker autoscaling target on metric; investigate consistent failures |
| Drift detected (HCM diverges) | `drift_events_total > 0` | Log + alert; reconciliation absorbs deltas via `HCM_REFRESH` movements |
| Negative balance (invariant violation) | DB check constraint + property test in CI | Hard fail at write time; saga fails request; alert |
| Duplicate request submission | Unique index on `idempotencyKey` | Returns existing request transparently |
| Worker crash mid-saga | Job remains in queue; on restart, idempotent handler reads current state | No data loss — outbox + queue are durable |
| HCM accepts invalid (silent) | Defensive local re-validation | Marks `HCM_PROTOCOL_VIOLATION`, fails saga, alerts |

---

## 11. Deployment

`docker compose up` brings up:

| Service | Image | Notes |
|---|---|---|
| `api` | local build of `apps/timeoff-api` | Port 3000, mounts `./data:/data` for SQLite |
| `worker` | same image, command override | BullMQ processors |
| `redis` | `redis:7-alpine` | No persistence (cache for queue) |
| `hcm-mock` | local build of `apps/hcm-mock` | Port 4000, exposes admin hooks for tests |

`package.json` scripts provide cross-platform commands: `up`, `down`, `logs`,
`test:unit`, `test:integration`, `test:smoke`, `test:property`, `test:e2e`, `seed`.
(No Makefile, since the project must run on Windows by default.)

---

## 12. Out of scope

- Authentication/authorization (delegated to gateway; trusted headers only).
- JWT, refresh tokens, SSO, password management.
- Multi-tenant isolation.
- UI / front-end.
- Real HCM integration (only the mock is built).
- Notification channels (email, push) on approval.
- I18n, accessibility.
- Production-grade secrets management (env vars only).
