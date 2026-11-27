# Lofi Yeti Runner — Firestore Security Specification

## 1. Data Invariants
1. **Strict Owner Isolation (PII Boundary)**: Every `/users/{userId}` document contains private PII (`email`, `suiIdentifier`) and cloud-synced game state. Only the authenticated, email-verified user whose `request.auth.uid == userId` may `get`, `create`, `update`, or `delete` their own profile. Blanket `list` on `/users` is forbidden (`allow list: if false`).
2. **Master Gate on Subcollections & Community Runs**:
   - Every `/users/{userId}/receipts/{receiptId}` document requires the parent `/users/{userId}` document to exist (`exists(...)`), strictly belongs to `request.auth.uid == userId`, is immutable once created (`update`/`delete` denied), and enforces `resource.data.uid == request.auth.uid` on `list`.
   - Every `/dailyRuns/{runId}` community leaderboard document contains **zero PII** (no `email` or wallet address), requires an authenticated, email-verified player with an existing `/users/$(request.auth.uid)` profile (`exists(...)`), enforces `incoming().uid == request.auth.uid`, is immutable after creation (`update`/`delete` denied), and enforces a rule-side rolling time-window query bound (`existing().createdAt >= request.time - duration.value(48, 'h')`) and `request.query.limit <= 200` on `list` so historical scraping is rejected at the rule layer.
3. **Immutable Ownership & Temporal Integrity**: `uid` and `createdAt` can never change after creation; `createdAt` and `updatedAt` must strictly equal `request.time`.
4. **Bounded Payloads & Strict Allowlists**: Every string has an explicit `.size()` upper bound, every numeric stat has explicit min/max bounds, every array has a `.size() <= 10` bound with element checks, and every write enforces strict `hasAll(...)` + `hasOnly(...)` / `affectedKeys().hasOnly(...)` gates.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Profile Read**: Anonymous `get(/users/alice)` -> Denied (`request.auth != null`).
2. **Cross-User PII Leak**: Authenticated `bob` calls `get(/users/alice)` -> Denied (`isOwner(userId)`).
3. **Users Collection Scrape**: Authenticated `bob` calls `list(/users)` -> Denied (`allow list: if false`).
4. **Identity Spoofing on Create**: `bob` writes `/users/bob` or `/dailyRuns/run1` with `{ uid: "alice", ... }` -> Denied (`data.uid == request.auth.uid`).
5. **Unverified Email Bypass**: User with `email_verified: false` attempts write to `/users/bob` or `/dailyRuns/run1` -> Denied (`isVerifiedEmail()`).
6. **Shadow Field Injection / PII Leak Attempt**: `bob` adds `{ isAdmin: true }` to `/users/bob` or `{ email: "bob@example.com" }` to `/dailyRuns/run1` -> Denied (`hasOnly(...)`).
7. **ID Poisoning Attack**: `bob` creates `/users/bob/receipts/../../evil!@#` or `/dailyRuns/run!@#` with invalid characters or >128 chars -> Denied (`isValidId(...)`).
8. **Value Poisoning / Out-of-Range Score**: `bob` posts `/dailyRuns/run1` with `{ score: 999999999999 }` or `{ score: -50 }` or a 500-char `displayName` -> Denied (`isValidDailyRun(incoming())`).
9. **Array Flood / Denial of Wallet**: `bob` updates `unlockedCharacters` with 15 items -> Denied (`size() <= 10`).
10. **Immortal Field Tampering & Run Mutation**: `bob` updates `createdAt` on `/users/bob`, or tries to `update`/`delete` `/dailyRuns/run1` -> Denied (`incoming().createdAt == existing().createdAt` & immutable `/dailyRuns`).
11. **Client Timestamp Forgery**: `bob` creates `/dailyRuns/run1` with a future or backdated `createdAt` instead of `serverTimestamp()` -> Denied (`incoming().createdAt == request.time`).
12. **Unbounded Historical Scrape / Orphaned Run**: Client executes unbounded `list(/dailyRuns)` without a recent `createdAt >=` filter or `limit > 200`, or creates a run before `/users/{uid}` exists -> Denied (`request.query.limit <= 200 && existing().createdAt >= request.time - duration.value(48, 'h')` & Master Gate `exists(...)`).
