# ExampleHR Time-Off Microservice

A NestJS + SQLite microservice for managing time-off requests with HCM-as-source-of-truth integrity.

Full design rationale: [`docs/superpowers/specs/2026-04-22-examplehr-timeoff-design.md`](docs/superpowers/specs/2026-04-22-examplehr-timeoff-design.md).
Implementation plan: [`docs/superpowers/plans/2026-04-22-examplehr-timeoff.md`](docs/superpowers/plans/2026-04-22-examplehr-timeoff.md).

## Quick start

```bash
pnpm install
docker compose up --build
```

Once up:

| URL | Purpose |
|---|---|
| http://localhost:5173 | **Web UI (start here)** — switch between Employee / Manager / Admin |
| http://localhost:3000 | API |
| http://localhost:3000/docs | Swagger UI |
| http://localhost:3000/health | Liveness |
| http://localhost:3000/health/ready | Readiness (db + redis + hcm) |
| http://localhost:4000 | HCM mock |

### Using the UI

1. Open **http://localhost:5173** — defaults to the Employee page.
2. The dropdown in the top-right switches identity (Employee e1/e2, Manager m1, Admin) — auth is mock-headers, so this just changes what's sent on every request.
3. **First time:** switch to Admin, "Seed HCM mock" + "Push to API" with `e1`/`l1`/`10`. Now switch to Employee → you'll see the balance.
4. Submit a new request. Watch the saga progress (RESERVING_HCM → AWAITING_APPROVAL) auto-refresh every 2s.
5. Switch to Manager → approve/reject. Watch the request reach APPROVED/REJECTED + balance update.

Stop and clear state:

```bash
docker compose down -v
```

## Tests

```bash
# Fast loops
pnpm test:unit
pnpm test:integration
pnpm test:property      # race-condition T-1 + property-based invariant

# E2E against running stack
docker compose up -d --wait
pnpm test:smoke
docker compose down -v
```

Coverage report:

```bash
pnpm --filter timeoff-api jest --coverage
# open apps/timeoff-api/coverage/lcov-report/index.html
```

## Trying it by hand

```bash
# 1. Seed HCM mock and push initial balance to local
curl -X POST http://localhost:4000/_admin/seed \
  -H 'content-type: application/json' \
  -d '{"employeeId":"e1","locationId":"l1","totalDays":"10"}'

curl -X POST http://localhost:3000/hcm-webhook/realtime \
  -H 'x-employee-id: admin' -H 'x-role: admin' -H 'content-type: application/json' \
  -d '{"employeeId":"e1","locationId":"l1","newTotal":"10","hcmTimestamp":"2026-04-22T00:00:00Z"}'

# 2. Read balance
curl http://localhost:3000/balances/e1 \
  -H 'x-employee-id: e1' -H 'x-role: employee'

# 3. Create a time-off request
REQ=$(curl -sX POST http://localhost:3000/requests \
  -H 'x-employee-id: e1' -H 'x-role: employee' -H 'content-type: application/json' \
  -d '{"locationId":"l1","startDate":"2026-05-01","endDate":"2026-05-03","idempotencyKey":"k1"}')
echo "$REQ" | jq '.id'
REQ_ID=$(echo "$REQ" | jq -r '.id')

# 4. Wait a moment for the worker to process the saga
sleep 2

# 5. Check saga state (should be AWAITING_APPROVAL after reserve)
curl http://localhost:3000/requests/$REQ_ID \
  -H 'x-employee-id: e1' -H 'x-role: employee'

# 6. Manager approves
curl -X POST http://localhost:3000/requests/$REQ_ID/approve \
  -H 'x-employee-id: m1' -H 'x-role: manager'

# 7. Wait for confirm
sleep 2

# 8. Final state: APPROVED, balance reflects consumption
curl http://localhost:3000/balances/e1 \
  -H 'x-employee-id: e1' -H 'x-role: employee'
```

## Architecture

**Three running processes** (all in docker-compose):

```
┌─────────────────┐                          ┌──────────────┐
│   timeoff-api   │  HTTP                    │   hcm-mock   │
│    (NestJS)     │ ──reserve/confirm──────▶ │   (NestJS)   │
└────────┬────────┘                          └──────────────┘
         │ Prisma                                  ▲
         ▼                                         │
   ┌──────────┐    ┌─────────────┐                │
   │  SQLite  │    │             │                │
   │ (volume) │    │   Redis     │                │
   └──────────┘    │  (BullMQ)   │                │
         ▲          └─────▲──────┘                │
         │                │                       │
         │           ┌────┴─────┐  HTTP           │
         └──Prisma───┤  worker  │ ────────────────┘
                    │ (NestJS) │
                    └──────────┘
```

**Saga lifecycle** for a time-off request:

```
                     POST /requests
                          │
              ┌───────────▼──────────────────┐
              │ tx { request + movement +    │
              │      outbox(RESERVE_HCM) }   │
              └────────────┬─────────────────┘
                           │
            (outbox poller pushes to BullMQ)
                           │
                  ┌────────▼────────┐
                  │ HcmSagaProcessor │ — worker
                  └────────┬────────┘
                           │ hcm.reserve
              ┌────────────┴────────────┐
              │                         │
       ┌──────▼─────────┐    ┌──────────▼─────────┐
       │ AWAITING_APPRO │    │ FAILED (HCM 4xx,   │
       │ (manager acts) │    │ release reservation)│
       └──────┬─────────┘    └────────────────────┘
              │
   approve / reject / cancel
              │
       ┌──────▼─────────┐  outbox CONFIRM_HCM | COMPENSATE_HCM
       │ COMMITTING_HCM │            │
       │ COMPENSATING_HCM│           ▼
       └──────┬─────────┘   ┌─────────────────┐
              │             │ HcmSagaProcessor │
              │             │ hcm.confirm/release
              │             └────────┬────────┘
              ▼                      │
    APPROVED | REJECTED | CANCELLED  │
              ▲ ─────────────────────┘
              │
           TERMINAL
```

**Key design points**:

- **Transactional outbox** (`OutboxEntry` table): every state-changing call to HCM is staged with the business write in one Prisma transaction, then dispatched to BullMQ by a poller. No dual-write hazards.
- **Movement ledger** (`TimeOffMovement` table): every change to balance is recorded as a movement. `available_days = total + Σ(deltas where type ∈ {PENDING_RESERVATION, CONFIRMED})`. The TRD's defensive guard checks this invariant after each HCM ack — `HCM_PROTOCOL_VIOLATION` thrown if HCM lied.
- **Saga state machine**: pure transition rules in `domain/saga-state-machine.ts`. Workers read current state and no-op on terminal — safe replay.
- **Drift handling**: HCM batch/realtime webhooks merge by timestamp (skip stale). HCM_REFRESH movements record audit trail. In-flight reservations survive refresh because available is derived dynamically, not stored.
- **Trust boundary**: gateway is responsible for auth; service receives `x-employee-id` + `x-role` headers. Documented in TRD.

## Test strategy

| Layer | What it covers |
|---|---|
| Unit | Pure logic: balance calculator, saga transitions, validators, errors |
| Integration | Module + DB + mocked HcmPort: repos, services, controllers, workers via `proc.process(fakeJob)` |
| Property | fast-check generates random action sequences; asserts `available >= 0` invariant |
| Race | 50 concurrent `POST /requests` on balance=10; exactly 10 succeed, 40 fail INSUFFICIENT_BALANCE |
| Smoke | Full HTTP flow against `docker compose` stack: seed → request → approve → balance reflects |

**Six named proof tests** from the TRD:
- T-1 Race condition (`test/property/race-condition.spec.ts`) — 50 concurrent, no oversell
- T-2 Drift survival (`test/integration/reconciliation/drift-survival.spec.ts`) — refresh preserves in-flight
- T-3 HCM unavailable — covered in `reserve-hcm.processor.spec.ts` (rethrow for BullMQ retry)
- T-4 Idempotency (`test/integration/requests/idempotency.spec.ts`) — 5 concurrent same key → 1 request
- T-5 Saga compensation — covered in `approval-flow.spec.ts` + `force-fail` endpoint test
- T-6 Defensive HCM (`test/integration/requests/defensive-hcm.spec.ts`) — silent_accept caught as HCM_PROTOCOL_VIOLATION

The property-based test caught a real bug during development: when HCM pushes total below pending reservations, `available` would go negative. Fix: clamp at 0 for display/gating, keep raw value for the defensive check.

## Layout

```
apps/
  timeoff-api/         # main microservice (api + worker share image)
    src/
      modules/
        balances/      # read model + ledger derivation
        requests/      # CRUD + saga orchestration
        reconciliation/ # batch + realtime HCM ingestion
        outbox/        # transactional outbox + BullMQ dispatcher
        hcm-client/    # HcmPort + InMemory & Http adapters
        health/        # liveness + readiness
      shared/
        context/       # ALS-based correlation
        errors/        # DomainError hierarchy + RFC7807 filter
        logging/       # Pino setup
        auth/          # TrustedHeadersGuard + @CurrentUser
        prisma/        # @Global PrismaService
      workers/         # HcmSagaProcessor (BullMQ)
    test/
      unit/ integration/ property/ smoke/
  hcm-mock/            # standalone NestJS app simulating HCM
packages/
  contracts/           # DTOs + enums shared by both apps
docs/superpowers/
  specs/               # TRD
  plans/               # implementation plan
```

## What's intentionally out of scope

- Authentication (delegated to gateway; trusted headers only)
- Multi-tenant isolation
- UI / front-end
- Real HCM integration (only the mock is built)
- Notification channels on approval
- Production-grade secrets management
