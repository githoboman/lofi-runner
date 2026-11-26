# Lofi Yeti Runner — Firestore Security Specification

## 1. Data Invariants
1. **Strict Owner Isolation**: Every `/users/{userId}` document contains PII (`email`, `suiIdentifier`) and game state. Only the authenticated, email-verified user whose `request.auth.uid == userId` may `get`, `create`, `update`, or `delete` their own profile. Blanket `list` on `/users` is forbidden.
2. **Master Gate on Subcollections**: Every `/users/{userId}/receipts/{receiptId}` document requires the parent `/users/{userId}` document to exist (`exists(...)`), strictly belongs to `request.auth.uid == userId`, is immutable once created (`update`/`delete` denied), and enforces `resource.data.uid == request.auth.uid` on `list`.
3. **Immutable Ownership & Timestamps**: `uid` and `createdAt` can never change after creation; `createdAt` and `updatedAt` must equal `request.time`.
4. **Bounded Payloads & Strict Allowlists**: Every string has an explicit `.size()` upper bound, every array has a `.size() <= 10` bound with element checks, and every write enforces strict `hasOnly(...)` / `affectedKeys().hasOnly(...)` gates.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Profile Read**: Anonymous `get(/users/alice)` -> Denied (`request.auth != null`).
2. **Cross-User PII Leak**: Authenticated `bob` calls `get(/users/alice)` -> Denied (`isOwner(userId)`).
3. **Users Collection Scrape**: Authenticated `bob` calls `list(/users)` -> Denied (`allow list: if false`).
4. **Identity Spoofing on Create**: `bob` writes `/users/bob` with `{ uid: "alice", ... }` -> Denied (`data.uid == request.auth.uid`).
5. **Unverified Email Bypass**: User with `email_verified: false` attempts write to `/users/bob` -> Denied (`isVerifiedEmail()`).
6. **Shadow Field Injection**: `bob` adds `{ isAdmin: true }` or `{ role: "superadmin" }` on create/update -> Denied (`hasOnly(...)`).
7. **ID Poisoning Attack**: `bob` creates `/users/bob/receipts/../../evil!@#` or 200-char ID -> Denied (`isValidId(receiptId)`).
8. **Value Poisoning / Oversized String**: `bob` updates `suiIdentifier` with a 500-char string or boolean -> Denied (`isValidUserProfile(incoming())`).
9. **Array Flood / Denial of Wallet**: `bob` updates `unlockedCharacters` with 15 items -> Denied (`size() <= 10`).
10. **Immortal Field Tampering**: `bob` updates `createdAt` or `uid` on `/users/bob` -> Denied (`incoming().uid == existing().uid && incoming().createdAt == existing().createdAt`).
11. **Client Timestamp Forgery**: `bob` sets `updatedAt` to a backdated timestamp instead of `serverTimestamp()` -> Denied (`incoming().updatedAt == request.time`).
12. **Orphaned / Mutated Receipt**: `bob` creates a receipt before `/users/bob` exists or attempts to `update`/`delete` an existing receipt -> Denied (Master Gate `exists(...)` & immutable receipt rule).
