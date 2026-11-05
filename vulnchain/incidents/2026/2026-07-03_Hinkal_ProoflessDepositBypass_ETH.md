# Hinkal Privacy Protocol — Proofless Deposit / Unbound Withdrawal Exploit Analysis

| Field | Details |
|-------|---------|
| **Date** | 2026-07-03 00:07:23 UTC (initial `prooflessDeposit`); theft window 2026-07-02 22:11:35 – 2026-07-03 00:19:23 UTC (~2h 8m, 85 txs) |
| **Protocol** | Hinkal (zk-SNARK confidential-transaction / shielded-pool layer for stablecoins; deployed on Ethereum, Solana, Tron) |
| **Chain** | Ethereum (incident isolated to a single ETH pool contract; Solana/Tron deployments unaffected) |
| **Total Loss** | **~$820K headline** (media) / **~$772K net** on-chain reconciliation (see §8.4) — 797,000 USDC + 0.08 ETH gross withdrawn, 25,000 USDC later returned by the attacker |
| **Attacker EOA** | [0xbB3f01a1...06c32fc20](https://etherscan.io/address/0xbB3f01a1b1C68F3DEB36C55342b5F5706c32fc20) |
| **Vulnerable Contract** | [0x25e5e82f...bAdFca826](https://etherscan.io/address/0x25e5e82f5702A27C3466fE68f14abDbbAdFca826) ("Hinkal" pool contract — Etherscan-verified, Exact Match) |
| **Attack Tx (deposit leg)** | [0xbf7252af...9d50008](https://etherscan.io/tx/0xbf7252af56be8867a12e27cc332f85e8f39e906756e559d6a076dc8bd9d50008) — `prooflessDeposit()`, block 25448306, 2026-07-03 00:07:23 UTC |
| **Attack Tx (withdraw leg)** | [0x93a63d64...f2486228](https://etherscan.io/tx/0x93a63d649878bb7e57741117362b7bc99b602f90335ea5fbff0365c4f2486228) — `transact()`, block 25448350, 2026-07-03 00:16:11 UTC |
| **Entry Functions** | `prooflessDeposit(address[],uint256[],uint256[],StealthAddressStructure[])` (selector `0x0ed4a94e`) → `transact(uint256[2],uint256[2][2],uint256[2],Dimensions,CircomData)` (selector `0x979a77a8`) |
| **Root Cause (preliminary, CertiK-attributed)** | The pool's no-proof "fast" deposit path (`prooflessDeposit`) registered a spendable note/commitment without the value it credited being cryptographically bound to what was actually transferred in; the attacker leveraged this gap to redeem far more value through the proof-verified `transact()` withdrawal path than had genuinely been deposited |
| **Source Verification** | Both provided tx hashes verified on Etherscan (real, non-fabricated) — see §8. Vulnerable contract source is Etherscan-verified ("Exact Match"); `prooflessDeposit`/`transact` signatures below are read directly from that verified source. Hinkal has **not** published a full technical postmortem as of this writing — the team stated it identified only a "preliminary root cause" pending external validation, so the exact internal defect (which line/check was missing) is not independently confirmed and the code in §2.2 is a behavioral reconstruction, clearly labeled as such |

---

## 1. Vulnerability Overview

Hinkal is a confidential-transaction / privacy layer for stablecoins, deployed across Ethereum, Solana, and Tron. It follows the standard shielded-pool architecture pioneered by mixers like Tornado Cash: users deposit assets into a pool contract, which records value as **UTXO-style commitments** in a Merkle tree; withdrawals ("transactions") are authorized by a zk-SNARK proof that the caller holds an unspent, valid note, and a **nullifier** is recorded to prevent double-spending. Hinkal extends this with **stealth addresses** for recipient privacy.

Alongside the proof-gated `transact()` path, the contract exposes `prooflessDeposit()` — a deposit-only entry point that, by design, does not require a ZK proof (a deposit adds funds; conventionally no proof of prior ownership is needed to *add* value to a pool, only to *remove* it). This function accepts a list of ERC-20 addresses, amounts, token IDs, and stealth-address structures, and emits `NewUtxo` events that register new spendable notes for those amounts.

On 2026-07-03, an attacker exploited a gap between what `prooflessDeposit()` **registered as a spendable note value** and what it **actually pulled in as real tokens**. Having engineered one or more proofless deposits that credited the pool's note ledger with a claimed value exceeding (or unconnected to) the genuine token transfer, the attacker then repeatedly called the proof-verified `transact()` function to redeem those notes — each call producing a valid ZK proof over commitments the contract itself had created, and each proof passing verification because the *proof* was legitimate even though the *underlying value it referenced* was not. The result: real ERC-20 tokens (chiefly USDC) flowed out of the pool to the attacker without a matching amount of real value having entered it.

This is a **CWE-345 (Insufficient Verification of Data Authenticity) / CWE-20 (Improper Input Validation)** flaw of the same general family as Aztec Connect's settlement/proof-count mismatch (see §5): a cryptographic proof system was sound in isolation, but a non-cryptographic input alongside it (here, the deposit-registered note amount) was never cross-checked against ground truth (the actual token balance delta).

The attack drained roughly **$820,000** in USDC and a small amount of ETH — nearly the protocol's entire $829K TVL across all five chains, even though only the Ethereum deployment was affected. Hinkal paused all its smart contracts as a precaution and confirmed the other chains were untouched.

---

## 2. Vulnerable Code Analysis

### 2.1 Verified Contract & Function Signatures (✅ real, Etherscan Exact-Match verified)

The pool contract at `0x25e5e82f...bAdFca826` is verified on Etherscan under the contract name **`Hinkal`**. Its ABI confirms the following real signatures:

```solidity
// Etherscan-verified — real function signatures, contract "Hinkal"

// No-proof fast-path deposit: registers new UTXOs/commitments for the
// listed tokens/amounts, tagged with stealth addresses for the recipient.
function prooflessDeposit(
    address[] erc20Addresses,
    uint256[] amounts,
    uint256[] tokenIds,
    StealthAddressStructure[] stealthAddressStructures
) external payable;   // selector 0x0ed4a94e

// Proof-gated transact/withdraw path: verifies a Groth16 proof (a, b, c)
// against a verifier selected via `dimensions`/`circomData.verifierId`,
// consumes input nullifiers, and writes new output commitments into the
// pool's Merkle root history (`roots`).
function transact(
    uint256[2] a,
    uint256[2][2] b,
    uint256[2] c,
    Dimensions dimensions,
    CircomData circomData
) external payable;   // selector 0x979a77a8
```

The contract maintains a `nullifiers` mapping (marks spent notes), a `roots` array (Merkle root history), and emits `NewUtxo` (on deposit), `Nullified`, and `NewCommitment` (on `transact`) events.

### 2.2 The Missing Binding — Behavioral Reconstruction (⚠️ not literal source; CertiK-attributed root cause)

> Hinkal has not published a full postmortem; the exact line-level defect inside `prooflessDeposit`'s note-registration logic is not independently confirmed. The reconstruction below reflects the publicly reported behavior — CertiK's "proofless deposit" characterization, and the on-chain fact pattern of one/few deposit calls followed by many 25,000-USDC `transact` withdrawals — not a verbatim code excerpt.

```solidity
// ⚠️ RECONSTRUCTED (behavioral) — illustrates the reported flaw class, not verbatim source

function prooflessDeposit(
    address[] calldata erc20Addresses,
    uint256[] calldata amounts,
    uint256[] calldata tokenIds,
    StealthAddressStructure[] calldata stealthAddressStructures
) external payable {
    for (uint256 i = 0; i < erc20Addresses.length; i++) {
        // ❌ SUSPECTED GAP: the note value credited to the ledger is taken
        //    from the caller-supplied `amounts[i]` directly. If the actual
        //    token movement for this iteration is not independently
        //    measured (e.g. via before/after balanceOf, or a strict
        //    safeTransferFrom of exactly amounts[i]) and reconciled against
        //    amounts[i] before the commitment is recorded, a caller can
        //    register a note for MORE value than was genuinely transferred.
        IERC20(erc20Addresses[i]).transferFrom(msg.sender, address(this), amounts[i]);

        // Registers a spendable UTXO/commitment for amounts[i], regardless
        // of whether the transfer above actually delivered that value
        // (e.g. fee-on-transfer tokens, reentrant/callback tricks, or a
        // token/path where the transferred amount can diverge from the
        // requested amount).
        _addUtxo(erc20Addresses[i], amounts[i], tokenIds[i], stealthAddressStructures[i]);
        emit NewUtxo(amounts[i], erc20Addresses[i], /* randomization, stealthAddress, timestamp, tokenId */ ...);
    }
}

// transact() itself was NOT broken — its Groth16 verification and nullifier
// bookkeeping are legitimate. It faithfully redeems whatever the Merkle
// tree says is a valid, unspent note. The exploit's leverage point is that
// prooflessDeposit fed the tree notes whose claimed value was not
// provably backed by real transferred tokens.
```

### 2.3 Illustrative Fix (✅)

```solidity
// ✅ Bind the credited note value to the MEASURED token delta, not the
//    caller-supplied amount.

function prooflessDeposit(
    address[] calldata erc20Addresses,
    uint256[] calldata amounts,
    uint256[] calldata tokenIds,
    StealthAddressStructure[] calldata stealthAddressStructures
) external payable {
    for (uint256 i = 0; i < erc20Addresses.length; i++) {
        uint256 balBefore = IERC20(erc20Addresses[i]).balanceOf(address(this));
        IERC20(erc20Addresses[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
        uint256 received = IERC20(erc20Addresses[i]).balanceOf(address(this)) - balBefore;

        // ✅ [PATCH] The note can only be registered for the ACTUAL amount received.
        require(received == amounts[i], "DEPOSIT_AMOUNT_MISMATCH");

        _addUtxo(erc20Addresses[i], received, tokenIds[i], stealthAddressStructures[i]);
        emit NewUtxo(received, erc20Addresses[i], ...);
    }
}
```

A defense-in-depth measure independent of the exact root cause: a **global pool solvency invariant** — `Σ(value represented by all live commitments) <= actual on-chain token balance of the pool, per asset` — checked after every deposit and withdrawal, would have reverted the very first over-crediting deposit regardless of which specific line was at fault.

---

## 3. Attack Flow

*(Timeline per on-chain forensic reconstruction; see references §9)*

### 3.1 Preparation

- **2026-07-01 09:35:59 UTC** — Attacker ran a small test transaction through Tornado Cash, establishing a laundering path before the main attack.
- **2026-07-02 19:02–19:05 UTC** — Attacker probed the target using Vizor.cash and OKX DEX, consistent with reconnaissance/testing of the exploit path.

### 3.2 Execution

**[Step 1] Proofless deposit — register unbound-value note(s)**
Attacker calls `prooflessDeposit()` on the Hinkal pool contract `0x25e5e82f...bAdFca826` (verified example: block 25448306, tx `0xbf7252af...9d50008`, 00:07:23 UTC). This registers new UTXO commitment(s) into the pool's note ledger via the no-proof fast path.

**[Step 2] Repeated proof-verified withdrawal — redeem unbacked notes**
Attacker calls `transact()` repeatedly against the freshly-registered commitments (verified example: block 25448350, tx `0x93a63d64...f2486228`, 00:16:11 UTC, redeeming 25,000 USDC). Each call supplies a legitimate Groth16 proof over notes the pool itself created — the proof verifies successfully because the cryptography is sound; only the *value the note represented* was never actually backed 1:1 by a real deposit.

**[Step 3] Repeat at scale**
Security researchers observed a series of **identical 25,000 USDC withdrawals executed within seconds of one another**, indicating a scripted/automated exploit loop rather than manual operation. Across the full **~2h 8m window (22:11:35 – 00:19:23 UTC)**, the attacker executed **85 transactions**, ultimately withdrawing **797,000 USDC + 0.08 ETH** gross from the pool (772,000 USDC net, after returning 25,000 USDC — see §8.4).

**[Step 4] Immediate, multi-path laundering**
- **00:43–00:48 UTC** — 14 Tornado Cash deposits totaling a minimum of **410 ETH** (~$700K): eleven 10 ETH deposits + three 100 ETH deposits.
- **01:18–01:28 UTC** — Tornado Cash withdrawals to fresh addresses (e.g. `0x892eb71...bb3bf317`).
- **01:23:23 UTC** — A single THORChain "Deposit With" transaction swapping **44.6747 ETH → native Bitcoin**, sent to `bc1qr2sf...zn3w`.
- Additional hops through MetaMask Swap, Uniswap, and a second Bitcoin address (`bc1qkch9...dklz85r`) associated with a Binance deposit — a deliberate multi-service strategy to break transactional links.

### 3.3 Attack Flow Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  Attacker EOA 0xbB3f01a1...06c32fc20                               │
│  (pre-tested laundering path via Tornado Cash, 07-01)              │
└───────────────────────────────┬──────────────────────────────────┘
                                │ prooflessDeposit()  [selector 0x0ed4a94e]
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  Hinkal Pool Contract 0x25e5e82f...bAdFca826                       │
│                                                                    │
│  ❌ Note/commitment registered for claimed `amounts[i]`             │
│     — NOT provably bound to real token delta received             │
│     → unbound-value UTXO added to Merkle tree                     │
└───────────────────────────────┬──────────────────────────────────┘
                                │ transact()  ×85 over ~2h08m  [selector 0x979a77a8]
                                │ (valid Groth16 proof over the pool's own,
                                │  over-credited commitments)
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  Real ERC-20 reserves (USDC, ETH) transferred OUT to attacker      │
│  797,000 USDC + 0.08 ETH gross (~$820K headline / ~$772K net)      │
└───────────────────────────────┬──────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  Laundering (within hours):                                        │
│   → 410+ ETH split across 14 Tornado Cash deposits                 │
│   → 44.67 ETH via THORChain → native BTC (bc1qr2sf...zn3w)         │
│   → MetaMask Swap / Uniswap / OKX DEX hops                         │
│   → Binance-linked BTC address (bc1qkch9...dklz85r)                │
└────────────────────────────────────────────────────────────────────┘
```

### 3.4 Outcome

| Asset | Amount | Approx. USD | Notes |
|-------|--------|-------------|-------|
| USDC | 797,000 gross (772,000 net after 25,000 USDC returned) | ~$772K–$797K | Bulk of the loss |
| ETH | 0.08 | ~$150 | Minor secondary asset |
| **Total** | — | **~$772K net / ~$820K–830K headline** | Nearly all of Hinkal's $829K cross-chain TVL |

Only the Ethereum pool contract was affected; Solana and Tron deployments were untouched.

---

## 4. Vulnerability Classification

### 4.1 Classification Table

| ID | Vulnerability | Severity | CWE | Category | Similar Incidents |
|----|---------------|----------|-----|----------|-------------------|
| V-01 | Deposit-registered note value not bound to actual token transfer delta | CRITICAL | CWE-20, CWE-345 | business-logic, accounting-sync | Aztec Connect, Hyperbridge |
| V-02 | Proof-verified withdrawal trusts pool-internal commitments without provenance check | HIGH | CWE-345 | business-logic | Aztec Connect, Verus Bridge |
| V-03 | No global solvency invariant across the note ledger vs. real balances | HIGH | CWE-682 | accounting-sync | Nomad Bridge, Gravity Bridge |
| V-04 | No automated anomaly detection on identical rapid-fire withdrawals | MEDIUM | CWE-1059 | operational | Multiple 2026 incidents |

### 4.2 V-01 — Deposit Value Not Bound to Real Transfer (Root Cause)

- **Description:** `prooflessDeposit()`, the no-proof fast deposit path, credited the pool's spendable-note ledger based on caller-supplied `amounts[]` without the pipeline independently confirming that the real token balance movement matched those amounts.
- **Impact:** Enabled the creation of notes representing more value than was genuinely deposited, which were then fully redeemable through the legitimate proof-verified withdrawal path.
- **Attack Preconditions:** Ability to call a public, unprivileged deposit function — no special role or timing required.

### 4.3 V-02 — Withdrawal Trusts Pool-Internal State Without Provenance Check

- **Description:** `transact()`'s Groth16 verification is sound over the Merkle tree the contract itself maintains, but the contract never asks "is the total value represented by this tree actually backed by tokens I hold?" A valid proof over corrupted internal state is still treated as fully authoritative.
- **Impact:** Converts a *local* accounting bug (V-01) into a *fully realized* loss of real reserves, because the withdrawal path has no independent backstop.
- **Attack Preconditions:** Same as V-01; simply requires generating a valid proof over the attacker's own (over-credited) notes, which is straightforward since the attacker controls those notes' secrets.

### 4.4 V-03 — No Global Solvency Invariant

- **Description:** There was no protocol-level check that `Σ(value of all live/unspent notes) <= actual token balance held by the pool`, per asset. Such an invariant is the standard last line of defense in any pooled-custody / shielded-pool design.
- **Impact:** Even if the specific `prooflessDeposit` binding bug is fixed, any future accounting bug in note issuance would similarly go undetected without this check.
- **Attack Preconditions:** Any bug anywhere in the note-issuance pipeline.

### 4.5 V-04 — No Anomaly Detection on Rapid Identical Withdrawals

- **Description:** 85 transactions, including a burst of identical 25,000 USDC withdrawals executed within seconds, drained nearly the entire TVL in ~2 hours with no automated circuit breaker or alert triggering a pause.
- **Impact:** Allowed the full drain to complete and the attacker to begin laundering before any human response was possible.
- **Attack Preconditions:** Absence of per-block/per-asset withdrawal caps or anomaly monitoring.

---

## 5. Comparison with Similar Incidents

| Incident | Date | Loss | Flaw Type | Difference from Hinkal |
|----------|------|------|-----------|-------------------------|
| **Aztec Connect** | 2026-06 | ~$2.19M | Settlement tx-count not bound to proof-committed count | Aztec's proof was valid but the *settlement scope* wasn't bound to it; Hinkal's proof was valid but the *deposit value feeding the tree* wasn't bound to real transfers — same "valid proof, unvalidated economic input" pattern, applied to opposite ends of the pipeline (settlement vs. deposit) |
| **Hyperbridge** | 2026-04 | ~$2.5M | Forged MMR proof accepted → fake mint | Hyperbridge forges the cryptographic proof itself; Hinkal's proofs were genuine — the exploit lived entirely in the unproven deposit-registration step that fed the prover |
| **Verus Bridge** | 2026-05 | ~$11.58M | Source-deposit total never compared to payout total | Nearly identical shape: a deposit-side total and a withdrawal-side total that "should" match were never cross-checked. Verus compares cross-chain totals; Hinkal compares a single-chain claimed-vs-transferred amount |
| **Nomad Bridge** | 2022-08 | ~$190M | `acceptableRoot[0] = true` → every message auto-valid | Nomad removed verification entirely; Hinkal's verification (`transact`'s SNARK) was intact — the gap was one step upstream, in what got fed into the provable state |

The unifying lesson across this cluster of 2026 incidents: **a cryptographically sound verification step is only as trustworthy as the data that was allowed to enter the system it verifies.** Hinkal's `transact()` correctly proved "this note is valid and unspent" — it just never had a way to know the note's claimed value wasn't real in the first place.

---

## 6. Remediation Recommendations

### 6.1 Immediate Fix — Bind Deposit Credit to Measured Transfer

```solidity
uint256 balBefore = IERC20(token).balanceOf(address(this));
IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
uint256 received = IERC20(token).balanceOf(address(this)) - balBefore;
require(received == amount, "DEPOSIT_AMOUNT_MISMATCH");   // ✅ credit only what arrived
```

### 6.2 Protocol-Level Solvency Invariant

```solidity
// ✅ Checked after every note-issuing or note-spending operation, per asset.
require(
    totalLiveNoteValue[asset] <= IERC20(asset).balanceOf(address(this)),
    "POOL_INSOLVENT"
);
```

### 6.3 Structural Improvements

| Weakness | Recommended Fix |
|----------|-----------------|
| No-proof deposit path can under-collateralize the note ledger | Require deposits to be paid via `safeTransferFrom`/`msg.value` with the credited amount strictly equal to the measured delta |
| No cross-check between deposit-side and withdrawal-side totals | Add a running per-asset solvency invariant, enforced on every state-changing call |
| No rate limiting on withdrawal path | Add per-block / per-address withdrawal caps; auto-pause on N identical withdrawals in a short window |
| Slow incident response (no on-chain circuit breaker) | Implement a guardian/watcher role empowered to pause `transact()` immediately on anomaly detection, independent of the core team's availability |
| No public post-mortem months after other 2026 incidents set the norm | Publish full technical root-cause analysis promptly to restore user trust and inform the wider ecosystem |

---

## 7. Lessons Learned

1. **"No proof required" fast paths are a privileged trust boundary, not a convenience shortcut.** In a proof-gated system, any code path that bypasses proof verification must independently and strictly enforce the invariant the proof would otherwise have guaranteed.
2. **A valid proof over corrupted state is still a valid proof.** `transact()`'s SNARK verification was never broken; it faithfully proved statements about a Merkle tree that had already been poisoned upstream. Verification correctness and input correctness are separate properties — this repo has now seen this exact class fail on a proof's *settlement count* (Aztec), a proof's *cross-chain total* (Verus), and now a proof's *underlying deposited value* (Hinkal).
3. **Global solvency invariants are the cheapest, most durable defense.** A single per-asset `require(totalLiveNoteValue <= balanceOf(this))` check would have stopped this attack regardless of which specific line in `prooflessDeposit` was at fault.
4. **Rapid, identical, repeated withdrawals are a detectable signature.** 14+ identical 25,000 USDC withdrawals in under a minute is an anomaly any basic on-chain monitor should flag; automated circuit breakers close the gap between detection and irreversible loss.
5. **Multi-chain protocols should isolate blast radius by design, and did here.** Hinkal's Solana and Tron deployments were unaffected because the vulnerable logic path was specific to the Ethereum contract — a reminder that even a shared codebase can benefit from per-chain deployment isolation.
6. **Timely, complete post-mortems matter.** As of this writing Hinkal has confirmed only a "preliminary root cause"; the ecosystem benefits when protocols move quickly from acknowledgment to full technical disclosure.

---

## 8. On-Chain Verification

### 8.1 Transaction Hashes — Verified

| Field | Value |
|-------|-------|
| **Deposit-leg tx** | [0xbf7252af56be8867a12e27cc332f85e8f39e906756e559d6a076dc8bd9d50008](https://etherscan.io/tx/0xbf7252af56be8867a12e27cc332f85e8f39e906756e559d6a076dc8bd9d50008) |
| Block / Time | 25448306 / 2026-07-03 00:07:23 UTC |
| Function | `prooflessDeposit` (selector `0x0ed4a94e`) |
| Effect | 25,000 USDC transferred attacker → pool contract |
| **Withdraw-leg tx** | [0x93a63d649878bb7e57741117362b7bc99b602f90335ea5fbff0365c4f2486228](https://etherscan.io/tx/0x93a63d649878bb7e57741117362b7bc99b602f90335ea5fbff0365c4f2486228) |
| Block / Time | 25448350 / 2026-07-03 00:16:11 UTC |
| Function | `transact` (selector `0x979a77a8`) |
| Effect | 25,000 USDC transferred pool contract → attacker |

Both hashes provided are **real, verifiable Ethereum transactions** — neither is fabricated. They represent one deposit/withdraw pair within the attacker's broader 85-transaction sequence; the full drain involved many additional `transact` calls not individually itemized here.

### 8.2 Verified Address Data

| Field | Value |
|-------|-------|
| Attacker EOA | [0xbB3f01a1b1C68F3DEB36C55342b5F5706c32fc20](https://etherscan.io/address/0xbB3f01a1b1C68F3DEB36C55342b5F5706c32fc20) |
| Hinkal pool contract | [0x25e5e82f5702A27C3466fE68f14abDbbAdFca826](https://etherscan.io/address/0x25e5e82f5702A27C3466fE68f14abDbbAdFca826) (Etherscan-verified, Exact Match; contract name "Hinkal") |
| Post-Tornado related address | 0x892eb71069fc8df4f7a6c3d4456075f2bb3bf317 |
| THORChain destination (BTC) | bc1qr2sfkehuqgr0sp87sp25uzw79242523l26zn3w |
| Binance-linked deposit (BTC) | bc1qkch9ahfyavjk48hd6tktv84w9mgzghqdklz85r |

### 8.3 Attack Timeline (Forensic Reconstruction)

| Time (UTC) | Event |
|------------|-------|
| 2026-07-01 09:35:59 | Test transaction through Tornado Cash |
| 2026-07-02 19:02–19:05 | Exploit path testing via Vizor.cash and OKX DEX |
| 2026-07-02 22:11:35 – 2026-07-03 00:19:23 | Main theft: 85 transactions over ~2h 8m |
| 2026-07-03 00:07:23 | `prooflessDeposit` (verified tx, block 25448306) |
| 2026-07-03 00:16:11 | `transact` withdrawal of 25,000 USDC (verified tx, block 25448350) |
| 2026-07-03 00:43–00:48 | 14 Tornado Cash deposits (min. 410 ETH) |
| 2026-07-03 01:18–01:28 | Tornado Cash withdrawals |
| 2026-07-03 01:23:23 | THORChain swap: 44.6747 ETH → BTC |

### 8.4 Notes on Reconciliation

- Media headline figures ($820K / $830K) and on-chain forensic figures (797,000 USDC + 0.08 ETH gross, 772,000 USDC net after a 25,000 USDC return) differ because the attacker returned 25,000 USDC to the pool partway through the sequence. This document reports both, consistent with how this database reconciles multi-source loss figures elsewhere (e.g. BlockSec vs. SlowMist on Aztec Connect).
- Hinkal's official TVL at the time of the attack was ~$829,000 across five chains; the loss represents near-total drainage of the Ethereum-side liquidity.
- Hinkal had **not** published a full technical postmortem as of the most recent reporting; the "proofless deposit" characterization is attributed to CertiK's on-chain analysis and Hinkal's own "preliminary root cause" statement, not a confirmed line-by-line disclosure. Treat §2.2's code as illustrative of the reported flaw class, not verbatim source.

---

## 9. References

- [Hinkal privacy protocol exploited for $820,000 as attacker funnels stolen funds through Tornado Cash (Cryptopolitan)](https://www.cryptopolitan.com/hinkal-privacy-protocol-exploited-for-820000-as-attacker-funnels-stolen-funds-through-tornado-cash/)
- [Hinkal Protocol Exploited: $820K Laundered via Tornado Cash & THORChain (CryptoTimes)](https://www.cryptotimes.io/2026/07/03/hinkal-protocol-exploited-820k-laundered-via-tornado-cash-thorchain/)
- [Hinkal Protocol Reveals Initial Cause Behind $820K Ethereum Exploit (CryptoTimes)](https://www.cryptotimes.io/2026/07/03/hinkal-protocol-reveals-initial-cause-behind-820k-ethereum-exploit/)
- [Hinkal Hack: How 772,000 USDC Was Stolen and Laundered — forensic breakdown (amlcrypto.io)](https://amlcrypto.io/blog/vzlom-hinkal-pro)
- [Hinkal Loses $820K in USDC After Smart Contract Flaw Hit on July 4 (The Currency Analytics)](https://thecurrencyanalytics.com/stable-coins/hinkal-loses-820k-in-usdc-after-smart-contract-flaw-hit-on-july-4-272635)
- [Hinkal Privacy Protocol Exploited for Approximately $820,000 in USDC (Cryip)](https://cryip.co/hinkal-privacy-protocol-exploited-for-approximately-820000-in-usdc/)
- [Hinkal Protocol Was Hacked For More Than $800,000 (Incrypted)](https://incrypted.com/en/hinkal-protocol-was-hacked-for-more-than-800-000/)
- [Attacker EOA (Etherscan)](https://etherscan.io/address/0xbB3f01a1b1C68F3DEB36C55342b5F5706c32fc20)
- [Hinkal pool contract (Etherscan, verified source)](https://etherscan.io/address/0x25e5e82f5702A27C3466fE68f14abDbbAdFca826)
- [CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html)
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
- [CWE-682: Incorrect Calculation](https://cwe.mitre.org/data/definitions/682.html)
- Related: [Aztec Connect (2026)](./2026-06-14_AztecConnect_ProofSettlementCountMismatch_ETH.md), [Verus Bridge (2026)](./2026-05-18_VerusBridge_SourceAmountValidationBypass_ETH.md), [Hyperbridge (2026)](./2026-04-13_Hyperbridge_TokenGateway_ForgedProof_FakeMint_ETH.md)
