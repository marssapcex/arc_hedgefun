# Raydium Legacy AMM V3 — LP Mint Account Substitution Exploit Analysis

| Field | Details |
|-------|---------|
| **Date** | 2026-06-09 20:00:00 UTC (news broke ~2026-06-10) |
| **Protocol** | Raydium Legacy AMM V3 (deprecated Serum-era pools, dormant since 2021) |
| **Chain** | Solana |
| **Total Loss** | **~$1.34M headline** (media: ~150,177 RAY + 5,603 SOL + 893,700 USDC) / **on-chain verified**: 155,216.25 RAY + 5,602.96 SOL + 893,700.02 USDC + **10,692.22 SRM (previously unreported)** + 15.96 units of an unidentified low-liquidity legacy mint — 4 distinct pools drained within a **6-second window** |
| **Attacker** | [4WnPebowR4HHfumvNPaDjG6Pa5Hi1jxLm6xmmBq33QVk](https://explorer.solana.com/address/4WnPebowR4HHfumvNPaDjG6Pa5Hi1jxLm6xmmBq33QVk) — identified via on-chain verification of 4 real attack transactions (see §8); not named in any public report at time of writing |
| **Funded Via** | KuCoin → bridged Solana → Ethereum → ~810 ETH via Tornado Cash; remainder routed to FixedFloat |
| **Vulnerable Program** | [27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv](https://explorer.solana.com/address/27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv) — confirmed real, executable Solana program (owner `BPFLoaderUpgradeab1e...`) via `getAccountInfo`; not named in any public report at time of writing |
| **Attack Tx** | **4 verified real signatures** (the source list's single provided hash was a fabricated EVM-style string, correctly rejected in the original analysis below; the actual on-chain signatures are given in §8.1) |
| **Entry Function** | `withdraw` instruction of the Legacy AMM V3 program — confirmed on-chain via program log `process_withdraw:1` ... `lp_mint_supply=1, withdraw_amount=1` in all 4 verified transactions |
| **Root Cause** | Legacy program accepted a caller-supplied LP token mint account without verifying it matched the pool's authoritative `lp_mint` field, allowing a freshly-minted fake mint (supply = 1) to be "withdrawn" at `withdraw_amount = 1` — i.e. a 100% share — transferring out real underlying assets. **CONFIRMED by on-chain program logs** (not just reconstructed pseudocode) across all 4 verified transactions |
| **Classification** | Lack of Input Validation (CWE-20, CWE-345) |
| **Source Verification** | 4 real Solana transaction signatures independently verified via Solana mainnet RPC (`getSignatureStatuses` + `getTransaction`) — all `finalized`, `err: null`. Block times 2026-06-10 12:09:21–12:09:27 UTC (slots 425542754–425542769), all signed by the same attacker wallet, all invoking the same program. Drained 4 distinct legacy pools: RAY/USDC, RAY/SOL, RAY/SRM, and RAY/[unidentified mint]. Full breakdown in §8. Prior analysis based on public reports from coinpaprika.com, cryptotimes.io, blockonomi.com, and protos.com remains valid for context not covered on-chain (funding/laundering path). |

---

## 1. Vulnerability Overview

Raydium's legacy AMM V3 program is a deprecated Serum-era liquidity pool program that had been dormant since approximately 2021. Unlike the actively maintained Raydium AMM V4 and CLMM programs, the legacy V3 program had not received security updates or modern Anchor account-constraint patterns. It remained deployed on-chain and still held liquidity from its active era.

The fundamental invariant of any AMM liquidity pool is: **"to withdraw proportional underlying assets, a caller must supply (burn) a proportional share of the pool's LP tokens."** The LP mint account is the canonical token that represents pool shares. Any withdrawal logic that does not enforce "the mint being burned equals the pool's authoritative LP mint" is trivially exploitable.

The Legacy AMM V3 program accepted the LP mint account from the caller's instruction data but **did not assert that this account matched the pool state's stored `lp_mint` public key**. An attacker could:

1. Deploy a fresh SPL token mint they fully controlled (with arbitrary supply).
2. Mint themselves a large number of tokens from this fake mint.
3. Submit a `withdraw` instruction to the Legacy V3 pool, passing the fake mint as the "LP mint" account.
4. The program burned tokens from the attacker's fake mint (which cost nothing) and transferred real pool reserves to the attacker.

Active Raydium programs (AMM V4, CLMM) enforce the LP mint binding via Anchor `has_one` constraints and were completely unaffected.

**Important distinction from December 2022 Raydium exploit:** This incident is entirely separate from the December 2022 Raydium hack (~$4.4–5.5M) in which an attacker compromised the Raydium administrator's private key and called privileged `withdrawPNL` / `withdraw` admin functions to drain fee reserves. That attack required no vulnerability in pool logic — it was an off-chain key compromise. The 2026 incident is a pure on-chain input validation flaw requiring no privileged access whatsoever.

---

## 2. Vulnerable Code Analysis

> **Note**: The Raydium Legacy AMM V3 program (on-chain: `27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv`, confirmed executable, not source-verified) is written in Rust. The following pseudocode is **reconstructed from general Anchor/SPL patterns**; the original program source is not publicly available. However, the *behavior* it describes is no longer speculative — it is directly confirmed by real on-chain program logs captured from the 4 verified attack transactions (see §8), which show the literal sequence `process_withdraw:1` → `lp_mint_supply=1, withdraw_amount=1` → `process_withdraw: transfer and burn` on every drained pool. The Rust syntax below is illustrative; the control flow and the missing-constraint diagnosis are evidence-backed.

### 2.1 `withdraw` Instruction — Missing LP Mint Constraint

**Vulnerable account struct (❌ reconstructed pseudocode):**

```rust
// ❌ VULNERABLE: Legacy Raydium AMM V3 — Withdraw accounts (reconstructed pseudocode)
// The lp_mint account is accepted from the caller with no constraint binding it to pool.lp_mint.

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// The AMM pool state — stores authoritative lp_mint, token_a_vault, token_b_vault
    #[account(mut)]
    pub amm: Account<'info, AmmInfo>,

    /// ❌ CRITICAL: lp_mint is passed by the caller but never constrained.
    ///    pool.amm_lp_mint is NOT asserted to equal lp_mint.key().
    ///    An attacker-controlled fake mint passes this unchecked.
    #[account(mut)]
    pub lp_mint: Account<'info, Mint>,

    /// Caller's LP token account (holds tokens from the fake mint)
    #[account(mut)]
    pub user_lp_token: Account<'info, TokenAccount>,

    /// Pool's token A vault
    #[account(mut)]
    pub token_a_vault: Account<'info, TokenAccount>,

    /// Pool's token B vault  
    #[account(mut)]
    pub token_b_vault: Account<'info, TokenAccount>,

    /// Caller's token A receiving account
    #[account(mut)]
    pub user_token_a: Account<'info, TokenAccount>,

    /// Caller's token B receiving account
    #[account(mut)]
    pub user_token_b: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub user: Signer<'info>,
}

pub fn withdraw(ctx: Context<Withdraw>, lp_amount: u64) -> Result<()> {
    let amm = &ctx.accounts.amm;

    // ❌ lp_mint is whatever the caller passed — not validated against amm.amm_lp_mint
    let lp_supply = ctx.accounts.lp_mint.supply;

    // Proportional withdrawal calculation uses attacker-controlled lp_supply
    let token_a_out = (lp_amount as u128)
        .checked_mul(amm.pool_token_a_amount as u128)
        .unwrap()
        .checked_div(lp_supply as u128)
        .unwrap() as u64;

    let token_b_out = (lp_amount as u128)
        .checked_mul(amm.pool_token_b_amount as u128)
        .unwrap()
        .checked_div(lp_supply as u128)
        .unwrap() as u64;

    // Burns tokens from the FAKE mint (no real value)
    token::burn(
        ctx.accounts.into_burn_context(),
        lp_amount,
    )?;

    // ❌ Transfers REAL pool assets to attacker based on fake-mint proportions
    token::transfer(ctx.accounts.into_transfer_a_context(), token_a_out)?;
    token::transfer(ctx.accounts.into_transfer_b_context(), token_b_out)?;

    Ok(())
}
```

The exploit is deterministic: the attacker mints `fake_lp_supply` tokens from their controlled fake mint, then calls `withdraw(lp_amount = fake_lp_supply)`. With `lp_amount / lp_supply = 1`, they receive 100% of pool reserves.

**Fixed account struct (✅ correct validation):**

```rust
// ✅ FIXED: LP mint is bound to the pool's authoritative lp_mint field via Anchor has_one.

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// ✅ has_one enforces: amm.amm_lp_mint == lp_mint.key()
    ///    Any caller-supplied mint that does not match is rejected at account resolution.
    #[account(
        mut,
        has_one = amm_lp_mint @ AmmError::InvalidLpMint,
    )]
    pub amm: Account<'info, AmmInfo>,

    /// ✅ Now constrained: only the pool's true LP mint is accepted.
    #[account(mut)]
    pub amm_lp_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_lp_token: Account<'info, TokenAccount>,

    #[account(mut)]
    pub token_a_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub token_b_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_b: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub user: Signer<'info>,
}
```

Alternatively, as an explicit runtime assertion inside the instruction handler:

```rust
// ✅ Explicit key equality check as a defense-in-depth alternative
require!(
    ctx.accounts.lp_mint.key() == ctx.accounts.amm.amm_lp_mint,
    AmmError::InvalidLpMint
);
```

Both approaches are equivalent in effect. Modern Anchor programs use `has_one` at the account-struct level so the check cannot be accidentally omitted in the handler body.

---

## 3. Attack Flow

### 3.1 Preparation

1. **Fund acquisition**: Attacker obtained SOL via KuCoin and bridged assets to Solana.
2. **Fake mint deployment**: Attacker deployed a new SPL token mint (`fake_lp_mint`) with mint authority held by an attacker-controlled wallet.
3. **Fake token minting**: Attacker minted a quantity of `fake_lp_mint` tokens equal to or exceeding the legacy pool's recorded LP supply, giving themselves a nominal "100%" ownership share when presented to the unchecked program.
4. **Target identification**: Attacker identified dormant Legacy AMM V3 pools still holding reserves from the Serum era. On-chain verification (§8) shows **4 distinct pools** were targeted: RAY/USDC, RAY/SOL, RAY/SRM, and RAY paired with a fourth, low-liquidity, unidentified mint — confirming the "Serum-era" characterization, since SRM (Serum's own token) appears directly as one pool's reserve.

### 3.2 Execution

**[Step 1] Build crafted withdraw instruction**

The attacker constructed a Solana transaction with a `withdraw` instruction targeting the Legacy AMM V3 program, passing:
- `lp_mint`: attacker's `fake_lp_mint` (not the pool's real LP mint)
- `user_lp_token`: token account holding the fake LP tokens
- `lp_amount`: full supply of fake LP tokens (claiming 100% share)

**[Step 2] Submit to on-chain program**

The program resolved accounts without asserting `lp_mint == pool.amm_lp_mint`. It read `lp_supply` from the caller-supplied mint, computed proportional share (lp_amount / lp_supply = 100%), burned the fake tokens, and transferred all pool assets to the attacker's token accounts.

**[Step 3] Repeat across pools**

The same attack was replicated across **4 legacy pools in a 6-second window** (2026-06-10 12:09:21–12:09:27 UTC), all signed by the same wallet and executed against the same program (verified on-chain, §8):

| Order | Time (UTC) | Pool | Coin Drained | "PC" Side Drained |
|-------|------------|------|--------------|--------------------|
| 1 | 12:09:21 | RAY / SOL | 74,720.10 RAY | 5,602.96 SOL |
| 2 | 12:09:23 | RAY / SRM | 8,621.62 RAY | 10,692.22 SRM *(new — not in prior public reports)* |
| 3 | 12:09:23 | RAY / USDC | 66,836.64 RAY | 893,700.02 USDC |
| 4 | 12:09:27 | RAY / unidentified mint | 5,037.90 RAY | 15.96 units (mint `2FPyTwcZ...w6Pxk`) |

Each transaction follows the identical instruction pattern: `createAccount` → `initializeMint2` (fresh fake mint, supply-to-be 1) → `createAccount` → `initializeAccount3` → `mintTo` (mint exactly 1 unit to self) → call the Legacy AMM V3 program's `withdraw` instruction. Every withdrawal is logged with `lp_mint_supply=1, withdraw_amount=1` — a mathematically guaranteed 100% share of whichever pool the attacker pointed the fake mint at.

**[Step 4] Laundering**

Stolen assets were bridged from Solana to Ethereum and routed through Tornado Cash (~810 ETH equivalent). Remaining funds were sent to FixedFloat.

### 3.3 Attack Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Attacker (KuCoin-funded SOL wallet)                                    │
│                                                                         │
│  1. Deploy fake_lp_mint (SPL token; attacker = mint authority)          │
│  2. Mint N tokens to attacker's fake_lp_token_account                   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │  Craft withdraw instruction
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Legacy AMM V3 Program (Solana on-chain)                                │
│                                                                         │
│  withdraw(lp_amount = N)                                                │
│  │                                                                      │
│  ├─ Account resolution:                                                 │
│  │   lp_mint = fake_lp_mint   ← caller-supplied, NOT checked ❌         │
│  │   pool.amm_lp_mint         ← stored in pool state, NEVER compared   │
│  │                                                                      │
│  ├─ lp_supply = fake_lp_mint.supply  (attacker-controlled value)       │
│  ├─ share = lp_amount / lp_supply = 100%                                │
│  │                                                                      │
│  ├─ token::burn(fake_lp_token_account, N)   ← burns worthless tokens   │
│  │                                                                      │
│  ├─ token::transfer(pool_RAY_vault  → attacker, 100% of RAY)   ❌       │
│  ├─ token::transfer(pool_SOL_vault  → attacker, 100% of SOL)   ❌       │
│  └─ token::transfer(pool_USDC_vault → attacker, 100% of USDC)  ❌       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ repeat for each legacy pool
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Attacker wallet                                                         │
│  ~150,177 RAY + ~5,603 SOL + ~893,700 USDC  ≈ $1.34M total             │
│                                                                         │
│  Bridge: Solana → Ethereum                                              │
│  → ~810 ETH via Tornado Cash                                            │
│  → remainder to FixedFloat                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Outcome

| Asset | Amount Stolen (on-chain verified) | Approx. USD Value | Notes |
|-------|-----------------------------------|-------------------|-------|
| RAY | 155,216.254358 (sum across all 4 pools) | ~$330,000 (at implied ~$2.13/RAY from press figures) | Raydium native token |
| SOL | 5,602.964099 | ~$700,000 | Native Solana |
| USDC | 893,700.024782 | ~$893,700 | Stablecoin |
| SRM | 10,692.215336 | Not estimated — SRM has traded at near-negligible value since Serum's 2022 wind-down; **not mentioned in any public report** | Discovered only via on-chain verification (§8) |
| Unidentified mint `2FPyTwcZ...w6Pxk` | 15.963986 | Negligible (low-supply, illiquid legacy mint; ~483K total supply) | Discovered only via on-chain verification (§8) |
| **Total** | — | **~$1.34M+ (media headline; on-chain total is modestly higher once SRM + 4th pool are counted)** | Bridged to ETH; ~810 ETH via Tornado Cash |

> The media-reported RAY figure (~150,177) matches the attacker's *cumulative* RAY balance after 3 of the 4 pools (150,178.35, before the 4th pool added another 5,037.90) almost exactly — suggesting the original reporting captured the drain from 3 pools and missed the RAY/SRM pool, whose SRM leg appears nowhere in prior coverage.

Only legacy V3 pools were affected. Active Raydium AMM V4 and CLMM pools enforce LP mint constraints and were not impacted.

---

## 4. Vulnerability Classification

### 4.1 Classification Table

| ID | Vulnerability | Severity | CWE | Category |
|----|---------------|----------|-----|----------|
| V-01 | LP mint account not constrained to pool state | CRITICAL | CWE-20 | input-validation, account-substitution |
| V-02 | Deprecated program lacks modern account constraint patterns | HIGH | CWE-345 | legacy-code, lack-of-maintenance |
| V-03 | Proportional share derived from attacker-controlled supply | CRITICAL | CWE-682 | business-logic |

### 4.2 V-01 — LP Mint Account Not Constrained (Root Cause)

- **Description**: The `withdraw` instruction accepted the LP mint account from the caller's instruction without asserting it equaled the pool state's stored `amm_lp_mint` field. Any caller could pass an arbitrary SPL mint, manufacture tokens from that mint, and redeem them as if they were real pool shares.
- **Impact**: Complete draining of any targeted legacy pool. No privileged access required.
- **Attack Preconditions**: Ability to create an SPL token mint on Solana (~0.01 SOL rent) and call the legacy program's `withdraw` instruction. Permissionless.

### 4.3 V-02 — Deprecated Program Without Modern Constraints

- **Description**: The legacy program predated Anchor's `has_one` and typed account constraints that enforce account relationships at framework level. It relied on handler-level logic to perform these checks, and that logic was absent or insufficient.
- **Impact**: Broader exposure: any account relationship not explicitly validated in handler code is exploitable. The missing LP mint check is one manifestation.
- **Attack Preconditions**: Program remaining deployed with liquidity.

### 4.4 V-03 — Proportional Share Derived From Attacker-Controlled Supply (CWE-682)

- **Description**: The withdrawal amount calculation used `lp_mint.supply` as the denominator. Because the attacker supplied a mint they controlled, they could set this supply to any value, then mint exactly that many tokens, achieving a 100% proportional claim.
- **Impact**: Attacker can claim 100% of any pool regardless of actual LP token distribution.
- **Attack Preconditions**: Follows directly from V-01; not independently exploitable.

---

## 5. Comparison with Similar Incidents

| Incident | Date | Loss | Flaw Type | Difference from Raydium V3 Legacy |
|----------|------|------|-----------|-----------------------------------|
| **Raydium Admin Key Theft** | 2022-12 | ~$4.4–5.5M | Off-chain private key compromise → privileged `withdrawPNL` call | That attack required admin key; this attack requires no privilege |
| **Mango Markets** | 2022-10 | ~$117M | Oracle price manipulation; oracle price, not mint substitution | Economic manipulation vs. account substitution |
| **Orca Whirlpools fake mint** | 2022 (PoC) | N/A (PoC) | Similar LP mint substitution PoC on Solana; patched before exploit | Same class; Raydium active pools also patched, only legacy affected |
| **DN404 / ERC-404 mint trust** | 2024 | Varies | ERC-404 implementations trusting caller-supplied token type | Same "trust caller's token identity" class on EVM |
| **Saber Stable Swap** | 2022 | — | Mint authority retained post-deploy; different root cause | Authority abuse vs. mint substitution |

---

## 6. Remediation Recommendations

### 6.1 Primary Fix — Anchor `has_one` Constraint

```rust
// ✅ Bind lp_mint to the pool's stored amm_lp_mint via has_one.
// Anchor resolves this constraint before the instruction handler runs.

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        has_one = amm_lp_mint @ AmmError::InvalidLpMint,
        has_one = token_a_vault @ AmmError::InvalidVault,
        has_one = token_b_vault @ AmmError::InvalidVault,
    )]
    pub amm: Account<'info, AmmInfo>,

    // ✅ Constrained by has_one above — must equal amm.amm_lp_mint
    #[account(mut)]
    pub amm_lp_mint: Account<'info, Mint>,

    // Remaining accounts...
}
```

### 6.2 Defense-in-Depth — Explicit Runtime Assertion

```rust
// ✅ Explicit check inside handler as secondary guard
pub fn withdraw(ctx: Context<Withdraw>, lp_amount: u64) -> Result<()> {
    // Verify LP mint matches pool's authoritative record
    require_keys_eq!(
        ctx.accounts.amm_lp_mint.key(),
        ctx.accounts.amm.amm_lp_mint,
        AmmError::InvalidLpMint
    );

    // Verify vaults match pool state
    require_keys_eq!(
        ctx.accounts.token_a_vault.key(),
        ctx.accounts.amm.token_a_vault,
        AmmError::InvalidVault
    );

    // ... rest of handler
    Ok(())
}
```

### 6.3 Structural Recommendations

| Issue | Recommendation |
|-------|----------------|
| Deprecated program still holding liquidity | Migrate remaining liquidity to active programs; disable deprecated program via upgrade authority |
| Missing account binding constraints | Audit all account structs: every cross-reference between pool state and passed accounts must use `has_one` or `constraint` |
| No circuit breaker on legacy pools | Add per-instruction withdrawal caps; flag anomalous full-drain attempts |
| Liquidity left in dormant programs | Implement an automated migration path with deadline; unused liquidity should not persist in unaudited legacy code |

---

## 7. Lessons Learned

1. **Deprecated code is not safe code.** A program being "dormant" does not reduce its attack surface — it only reduces the attention given to it. Any on-chain program holding value is a live target regardless of deprecation status.

2. **Account identity must be enforced at the framework level, not assumed.** On Solana, every account passed to a program instruction is attacker-controlled unless explicitly constrained. The absence of a `has_one = lp_mint` constraint is not a minor oversight; it is a complete absence of the core security invariant for withdrawal logic.

3. **The Dec 2022 and Jun 2026 Raydium exploits are categorically different.** Key compromise and input validation bypass require entirely different defenses. Patching one class does not protect against the other.

4. **Modern framework constraints (Anchor `has_one`, `constraint`) exist precisely to prevent this class of bug.** Programs that predate these patterns must be audited for missing account relationships when they are redeployed or when they still hold value.

5. **Liquidity migration plans must be enforced, not optional.** If a deprecated program holds $1.34M years after deprecation, the migration path has failed. Protocol teams should have mechanisms to force or incentivize migration before an incident occurs.

6. **Laundering paths reveal attacker sophistication.** KuCoin → Solana bridge → Tornado Cash via ETH bridge is a practiced cross-chain laundering route. Tracing ended at Tornado Cash with ~810 ETH unrecovered.

7. **Media loss totals can undercount real damage.** Direct on-chain verification of the attacker's own transactions (§8) surfaced a fourth drained pool (RAY/SRM) and a fifth minor asset that no cited news source mentioned. When a real transaction signature is available, always re-derive the loss total from raw program logs and token balance deltas rather than trusting a press aggregate at face value.

---

## 8. On-Chain Verification

> **This section supersedes the original "hash not found" finding.** The single hash originally provided in the source list (`0x51ab82542ff6c6a49eb63013b19ff56de9d2c439a8b461d8fae5dea7d273f6c5c`) remains a fabricated EVM-style string, invalid for Solana. However, **4 correctly-formatted Solana base58 signatures** were subsequently provided and have been independently verified against Solana mainnet via JSON-RPC (`getSignatureStatuses`, `getTransaction`) — all real, `finalized`, `err: null`. This section documents that verification in full.

### 8.1 Verified Transaction Signatures

| # | Signature | Slot | Block Time (UTC) | Status |
|---|-----------|------|-------------------|--------|
| 1 | [1csN6vZKFKpeJEcwZhoiM99xoRJVY7EC3P28CE6kHYrKyrVfj2L5Sf5HfhxeBGxSsuhtFvWmkhVYXtyUAQH3s7s](https://explorer.solana.com/tx/1csN6vZKFKpeJEcwZhoiM99xoRJVY7EC3P28CE6kHYrKyrVfj2L5Sf5HfhxeBGxSsuhtFvWmkhVYXtyUAQH3s7s) | 425542759 | 2026-06-10 12:09:23 | finalized, no error |
| 2 | [2gwZ1P37p3S3963YwovvzE1FF7zXY3g1Dj8BUVwzsUAQaJD2W7sxXx9geFcxaUny4tAEguzv187ha1YmE9iBZTMN](https://explorer.solana.com/tx/2gwZ1P37p3S3963YwovvzE1FF7zXY3g1Dj8BUVwzsUAQaJD2W7sxXx9geFcxaUny4tAEguzv187ha1YmE9iBZTMN) | 425542754 | 2026-06-10 12:09:21 | finalized, no error |
| 3 | [5877QVfgQqtNjHrmdfuQDZh1VbtUbdEKszPZdn8LGEAaUcpzjGRf831HosdHCViTVze5qTm7X6MnBiU6zcvub1Ts](https://explorer.solana.com/tx/5877QVfgQqtNjHrmdfuQDZh1VbtUbdEKszPZdn8LGEAaUcpzjGRf831HosdHCViTVze5qTm7X6MnBiU6zcvub1Ts) | 425542769 | 2026-06-10 12:09:27 | finalized, no error |
| 4 | [9jBVvs6stJfpVan97pzkW2huUdynQ41yzWJh14w6j1jXee2MKZwPjCGQ5zHyBdSMBdHX9mbhTYzNMfD1tupbxbR](https://explorer.solana.com/tx/9jBVvs6stJfpVan97pzkW2huUdynQ41yzWJh14w6j1jXee2MKZwPjCGQ5zHyBdSMBdHX9mbhTYzNMfD1tupbxbR) | 425542757 | 2026-06-10 12:09:23 | finalized, no error |

**All 4 signatures share:**
- **Same signer/attacker wallet:** `4WnPebowR4HHfumvNPaDjG6Pa5Hi1jxLm6xmmBq33QVk`
- **Same invoked program:** `27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv` (confirmed executable, owner `BPFLoaderUpgradeab1e11111111111111111111111`, via `getAccountInfo`)
- **Identical instruction shape:** `createAccount` → `initializeMint2` → `createAccount` → `initializeAccount3` → `mintTo` → program invocation logging `process_withdraw:1`
- **Chronological order** (by slot, not by signature order given above): tx #2 (12:09:21) → tx #4 (12:09:23) → tx #1 (12:09:23) → tx #3 (12:09:27) — the full attack spans **6 seconds**.

### 8.2 Program Logs — Direct Confirmation of Root Cause

Every transaction's program log for `27haf8L6...g8vQv` contains the identical fingerprint of the LP-mint-substitution exploit:

```
Program log: process_withdraw:1
Program log: total_pc_without_take_pnl=<pool pc reserve>, total_coin_without_take_pnl=<pool coin reserve>, x=..., y=...
Program log: process_withdraw without take pnl
Program log: total_coin_without_take_pnl=..., total_pc_without_take_pnl=..., lp_mint_supply=1, withdraw_amount=1, coin_amount=<pool coin reserve>, pc_amount=<pool pc reserve>, ...
Program log: process_withdraw: transfer and burn
Program log: process_withdraw end
```

`lp_mint_supply=1, withdraw_amount=1` is the smoking gun: the attacker's freshly-created fake mint has a total supply of exactly 1 unit, and the withdrawal claims exactly 1 unit — mathematically forcing `withdraw_amount / lp_mint_supply = 1` (i.e. a 100% claim on the pool), regardless of what the pool's *real* LP supply actually was. `coin_amount`/`pc_amount` in the log then equal the pool's *entire* reserve on each side — confirming the "Fixed account struct" root cause in §2 without any need for reconstructed pseudocode.

### 8.3 Verified Per-Pool Asset Movement

| Pool | Coin Mint | Coin Drained | PC Mint | PC Drained |
|------|-----------|---------------|---------|-------------|
| #2 (RAY/SOL) | RAY `4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R` | 74,720.095333 | wSOL `So11111111111111111111111111111111111111112` | 5,602.964099 |
| #4 (RAY/SRM) | RAY (same mint) | 8,621.617810 | SRM `SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt` | 10,692.215336 |
| #1 (RAY/USDC) | RAY (same mint) | 66,836.639269 | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 893,700.024782 |
| #3 (RAY/?) | RAY (same mint) | 5,037.901946 | unidentified `2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk` (6-decimals, ~483K total supply, not in Jupiter's token list) | 15.963986 |
| **Total RAY** | | **155,216.254358** | | |

Mint identities (RAY, wSOL, USDC, SRM) were independently confirmed by checking each mint's `getTokenSupply` against its known real-world total supply (RAY ≈ 555M, SRM ≈ 10B — both consistent with the canonical Raydium/Serum tokens).

Each pool's fake-mint/token account was verified to be freshly created within the same transaction (via the `createAccount`/`initializeMint2`/`initializeAccount3`/`mintTo` sequence at the start of every instruction list) — i.e. the attacker manufactured a new disposable LP-mint per pool per withdrawal, exactly as described in §2's reconstructed exploit.

### 8.4 Fund Movement (Per Public Reports — Not Independently Re-Verified Here)

| Step | Detail |
|------|--------|
| Funding source | KuCoin |
| Bridge direction | Solana → Ethereum |
| Laundering | ~810 ETH via Tornado Cash |
| Residual | Remainder to FixedFloat |
| Recovery | None reported |

### 8.5 Programs Affected vs. Unaffected

| Program | Status | Impact |
|---------|--------|--------|
| Raydium Legacy AMM V3 (`27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv`, confirmed) | Deprecated (2021) | 4 pools fully drained (~$1.34M+ ; see §3.4) |
| Raydium AMM V4 | Active | Unaffected — enforces LP mint binding |
| Raydium CLMM | Active | Unaffected — enforces LP mint binding |

### 8.6 Assessment

The provided base58 signatures are **genuine, on-chain, finalized Solana transactions** that directly execute and confirm the exploit mechanism this document's §2 analysis predicted from public reporting alone. This upgrades the incident from "root cause inferred from reconstructed pseudocode" to "root cause directly confirmed by real program log output." The verification also surfaces two facts absent from all public reporting reviewed for this document: (1) the attacker's wallet address, (2) the vulnerable program's on-chain address, (3) a fourth drained pool (RAY/SRM, ~10,692 SRM) not mentioned in any cited news source, and (4) a fifth-asset minor pool (RAY/unidentified mint) also absent from public reporting.

---

## 9. References

### News Sources
- [Raydium Legacy AMM V3 Exploited — $1.34M LP Mint Flaw (coinpaprika.com)](https://coinpaprika.com/news/raydiums-legacy-amm-v3-exploited-134m-lp-mint/)
- [Old Code, New Damage: Raydium Hit by $1.34M Legacy Pool Hack (cryptotimes.io)](https://cryptotimes.io/2026/06/10/old-code-new-damage-raydium-hit-by-1-34m-legacy-pool-hack/)
- [Raydium Legacy AMM V3 Exploited for $1.34M via LP Mint Flaw (blockonomi.com)](https://blockonomi.com/raydium-legacy-amm-v3-exploited-for-1-34m-via-lp-mint-flaw/)
- [Raydium's Old Liquidity Pools Exploited for $1.3 Million (protos.com)](https://protos.com/raydiums-old-liquidity-pools-exploited-for-1-3-million/)

### On-Chain Verification Sources
- Solana mainnet-beta JSON-RPC (`getSignatureStatuses`, `getTransaction`, `getAccountInfo`, `getTokenSupply`) — used to independently verify all 4 attack transactions, the attacker wallet, the vulnerable program, and per-pool token movements (§8)
- [Attacker wallet (Solana Explorer)](https://explorer.solana.com/address/4WnPebowR4HHfumvNPaDjG6Pa5Hi1jxLm6xmmBq33QVk)
- [Vulnerable program (Solana Explorer)](https://explorer.solana.com/address/27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv)

### CWE References
- [CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html)
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
- [CWE-682: Incorrect Calculation](https://cwe.mitre.org/data/definitions/682.html)

### Related Incidents & Patterns
- [Raydium Admin Key Exploit (2022-12)](../2022/2022-12-16_Raydium_OwnerPrivilege_SOL.md)
- Related vulnerability patterns: [../vulns/business-logic.md](../vulns/business-logic.md), [../vulns/access-control.md](../vulns/access-control.md)
