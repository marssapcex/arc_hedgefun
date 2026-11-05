# DxSale — Liquidity Locker Ownership Backdoor Withdrawal Exploit Analysis

| Field | Details |
|-------|---------|
| **Date** | 2026-05-26 01:08:56 UTC (flagged in public reporting ~2026-05-28–29) |
| **Protocol** | DxSale.network — multi-chain launchpad and liquidity locker (BNB Chain deployment) |
| **Chain** | BNB Chain (BSC) |
| **Total Loss** | **~$7.3M** in BNB across 1,400+ liquidity-provider positions (including SafeMoon-era token locks) |
| **Attacker EOA** | `0xC4574DDEF299e7E563971e200433e592EeaaFA69` — BscScan-labeled **"DxSale Exploiter 1"** (Phish/Hack tag; attribution by ExVul); address **verified and labeled** on BscScan |
| **Drainer Contract** | No separate drainer contract confirmed — the verified batch-drain transaction (§8.1) was signed directly by the attacker EOA. The previously-reported partial fragment `0xC2efbd94...01e4718` remains unconfirmed and may not be part of this attack chain; see §8.1. |
| **Vulnerable Contract** | [0xEb3a9C56d963b971d320f889bE2fb8B59853e449](https://bscscan.com/address/0xEb3a9C56d963b971d320f889bE2fb8B59853e449) — BscScan-labeled **"DxSale Network: Legacy Liquidity Locker"** — verified on-chain (§8.1); contradicts earlier reporting that no locker address was public |
| **Attack Tx** | **7 verified real transactions** (§8.1) — the source list's provided hash `0x2b39f048033a9205c5a62ca43016263cfcca9bab74c48fdc06f43bd29307b26a` was not found on-chain and appears to be a one-character variant of an unrelated exploit (Flooring Protocol `0xb139f048...`) |
| **Entry Function** | `setFee()` (privileged fee mutation) + `unlock()` / batch withdraw with manipulated `unlockTime` |
| **Root Cause** | Locker contract ownership was transferred to the attacker (verified `transferOwnership()` call, §8.1) at the moment reflected in the source-list incident timestamp; the new owner then called `setFee` to reduce the unlock fee to 1 wei and backdated lock `unlockTime` values to ~68 seconds after the Unix epoch (Jan 1970) so every position appeared immediately withdrawable, enabling the batch drain of all locked LP positions **three days later** (verified batch-drain window, §8.1). Public reporting's "~269 days prior, laundered through ~80 wallet hops" framing describes an earlier stage of the ownership chain that this report cannot independently confirm on-chain. |
| **Source-List Classification** | "Missing State Update" (source-list label) — **does not match documented root cause**; see Section 4.1 for reclassification note |
| **Actual Classification** | Access Control — Privileged-Function Backdoor (CWE-284, CWE-639, CWE-841) |
| **Funded Via** | Bybit; ~$1.87M of proceeds routed to Binance |
| **Source Verification** | Attacker EOA **verified and labeled** on BscScan ("DxSale Exploiter 1", Phish/Hack tag, attribution by ExVul); locker contract **now verified** on-chain as "DxSale Network: Legacy Liquidity Locker" (§8.1); 7 real attack transactions verified on BscScan (§8.1), cross-checked against BlockSec's Security Incidents Library; the source list's originally-provided tx hash was synthetic/fabricated and has been superseded. Drainer-contract fragment `0xC2efbd94…01e4718` remains unconfirmed. Analysis based on public reports from crypto.news, cryptopotato.com, cryptotimes.io, and invezz.com |

---

## 1. Vulnerability Overview

DxSale.network is a multi-chain launchpad and liquidity locking service. Projects that launched on DxSale in 2021 used its liquidity locker contracts to credibly lock LP tokens for fixed time periods, a common trust mechanism for retail investors in that era. The locked LP positions in this incident dated primarily from 2021 (SafeMoon-era token launches) and had never been migrated or unwound.

The exploit exploited a fundamental breakdown in the security model of time-locked custody contracts: **the owner of the locker contract retains privileged capabilities that, if abused, can override any lock term.** Rather than being renounced or transferred to a timelock/multisig, the locker ownership was transferred to an attacker-controlled wallet via a verified `transferOwnership()` call (§8.1). Public reporting additionally describes an earlier-stage covert transfer approximately 269 days before the exploit, obscured through approximately 80 intermediate wallet hops — this earlier stage is press-sourced and not independently confirmed on-chain by this report.

Once in control of the contract, the attacker used privileged functions to:
1. Set the unlock fee to 1 wei via `setFee()`, removing the economic barrier to early withdrawal.
2. Manipulate lock configuration entries and unlock timestamps to mark locks as matured.
3. Batch-drain all 1,400+ LP positions in a single coordinated withdrawal operation.

**Classification note**: The source incident database labels this event as "Missing State Update." This label does not accurately describe the documented attack mechanism. The root cause is an **Access Control failure**: a privileged backdoor (retained owner authority + mutable lock terms) was abused by a malicious owner. The "Missing State Update" label appears to conflate the symptom (unlock state not correctly enforced) with the cause (privileged mutation of lock state by a backdoor owner). This report recommends reclassifying the incident to **Access Control / Privileged-Function Backdoor (CWE-284)**.

---

## 2. Vulnerable Code Analysis

> **Note**: DxSale's locker contract source was not published on Etherscan/BscScan at time of reporting. The following Solidity code is **reconstructed/estimated** from the described attack mechanism (privileged `setFee`, mutable `unlockTime`, batch withdrawal). It is clearly labeled as reconstructed and approximates the likely implementation pattern for 2021-era BSC locker contracts.

### 2.1 Vulnerable Locker Implementation (❌ Reconstructed)

```solidity
// ❌ VULNERABLE: DxSale Liquidity Locker — reconstructed/estimated Solidity
// Ownership is retained and not renounced; lock terms are mutable by owner.

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DxLock is Ownable {

    struct Lock {
        address token;       // LP token contract
        address beneficiary; // Original lock depositor
        uint256 amount;      // Locked LP token amount
        uint256 unlockTime;  // ❌ Mutable: owner can manipulate
        bool    withdrawn;
    }

    mapping(uint256 => Lock) public locks;
    uint256 public nextLockId;

    // ❌ CRITICAL: fee is owner-settable with no lower bound and no timelock
    uint256 public unlockFee = 0.01 ether;

    // ❌ No event on fee change; change is silent
    function setFee(uint256 _fee) external onlyOwner {
        unlockFee = _fee;  // ❌ Attacker sets this to 1 wei
    }

    function lockTokens(
        address token,
        uint256 amount,
        uint256 unlockTime
    ) external payable {
        require(msg.value >= unlockFee, "Insufficient fee");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        locks[nextLockId++] = Lock({
            token: token,
            beneficiary: msg.sender,
            amount: amount,
            unlockTime: unlockTime,  // ❌ Stored but mutable below
            withdrawn: false
        });
    }

    // ❌ Owner can arbitrarily reset any lock's unlock timestamp
    function setUnlockTime(uint256 lockId, uint256 newTime) external onlyOwner {
        locks[lockId].unlockTime = newTime;
    }

    function unlock(uint256 lockId) external payable {
        Lock storage lock = locks[lockId];
        require(!lock.withdrawn, "Already withdrawn");

        // ❌ unlockTime can be set to 0 by owner; always passes after manipulation
        require(block.timestamp >= lock.unlockTime, "Not yet unlocked");
        require(msg.value >= unlockFee, "Insufficient fee");  // ❌ fee = 1 wei after setFee

        lock.withdrawn = true;
        // ❌ No check that msg.sender == lock.beneficiary;
        //    owner calling this drains to owner-controlled address if token.transfer uses msg.sender
        IERC20(lock.token).transfer(lock.beneficiary, lock.amount);
    }

    // ❌ Batch withdraw: no per-caller authorization; all locks drainable in one tx
    function batchUnlock(uint256[] calldata lockIds) external payable {
        for (uint256 i = 0; i < lockIds.length; i++) {
            Lock storage lock = locks[lockIds[i]];
            if (!lock.withdrawn && block.timestamp >= lock.unlockTime) {
                lock.withdrawn = true;
                IERC20(lock.token).transfer(lock.beneficiary, lock.amount);
            }
        }
    }
}
```

The attack flow exploits the owner authority chain: `setFee(1 wei)` → `setUnlockTime(lockId, 0)` for all locks → `batchUnlock([0..1400])`. Each LP token is transferred to its original beneficiary address — but because the attacker's drainer contract was substituted as the new beneficiary or intercepted the transfer via reentrancy/redirect, all funds flowed to attacker-controlled addresses.

### 2.2 Hardened Implementation (✅ Remediated)

```solidity
// ✅ FIXED: Immutable lock terms, renounced ownership, no privileged fee mutation.

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// ✅ No Ownable — ownership concept removed entirely for the locker
contract DxLockV2 is ReentrancyGuard {

    struct Lock {
        address token;
        address beneficiary;
        uint256 amount;
        uint256 unlockTime;   // ✅ Set once at lock creation; immutable thereafter
        bool    withdrawn;
    }

    mapping(uint256 => Lock) public locks;
    uint256 public nextLockId;

    // ✅ Fee is a constant; cannot be mutated post-deploy
    uint256 public constant UNLOCK_FEE = 0.01 ether;

    event Locked(uint256 indexed lockId, address token, address beneficiary, uint256 amount, uint256 unlockTime);
    event Unlocked(uint256 indexed lockId, address token, address beneficiary, uint256 amount);

    function lockTokens(
        address token,
        uint256 amount,
        uint256 unlockTime
    ) external payable {
        require(msg.value >= UNLOCK_FEE, "Insufficient fee");
        require(unlockTime > block.timestamp, "Unlock time must be future");
        require(amount > 0, "Amount must be nonzero");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        uint256 lockId = nextLockId++;
        locks[lockId] = Lock({
            token: token,
            beneficiary: msg.sender,
            amount: amount,
            unlockTime: unlockTime,  // ✅ Immutable: no setter function exists
            withdrawn: false
        });

        emit Locked(lockId, token, msg.sender, amount, unlockTime);
    }

    function unlock(uint256 lockId) external payable nonReentrant {
        Lock storage lock = locks[lockId];
        require(!lock.withdrawn, "Already withdrawn");
        require(block.timestamp >= lock.unlockTime, "Not yet unlocked");
        require(msg.value >= UNLOCK_FEE, "Insufficient fee");
        // ✅ Only the original beneficiary can unlock their own position
        require(msg.sender == lock.beneficiary, "Not beneficiary");

        lock.withdrawn = true;
        IERC20(lock.token).transfer(lock.beneficiary, lock.amount);

        emit Unlocked(lockId, lock.token, lock.beneficiary, lock.amount);
    }

    // ✅ No setFee(), no setUnlockTime(), no owner-privileged functions
    // ✅ No transferOwnership() vector — contract has no owner
}
```

---

## 3. Attack Flow

### 3.1 Preparation

1. **Ownership transfer (verified 2026-05-26 01:08:56 UTC)**: A `transferOwnership()` call on the Legacy Liquidity Locker (`0xEb3a9C56…e449`) handed owner control to `0xC4574DDEF299e7E563971e200433e592EeaaFA69` — verified on-chain (§8.1, tx `0x23e331a8…`). Public reporting additionally describes an earlier-stage covert transfer ~269 days prior (~August 2025) laundered through ~80 wallet hops before reaching this address; this earlier stage is **not independently confirmed on-chain** by this report and should be read as press-sourced context rather than verified fact.
2. **Bybit funding**: Attack gas and operational capital sourced from Bybit.
3. **Drainer contract**: Public reporting describes a dedicated drainer contract (partial address `0xC2efbd94...01e4718`) deployed ~9h before the drain. This is **not corroborated** by the verified batch-drain transaction (§8.1), whose `from`/`to` is the attacker EOA itself — treat the separate-drainer-contract claim as unconfirmed.

### 3.2 Execution — Two Verified Phases, Three Days Apart

**[Phase 1 — 2026-05-26 01:08:56 UTC, verified] Ownership takeover**

`transferOwnership()` on the locker (tx `0x23e331a8…`, §8.1) transferred owner control to `0xC4574DDEF...FA69`. This is the incident's source-list timestamp — i.e., public reporting's "exploit date" marks the takeover, not the drain itself.

**[Phase 2 — 2026-05-29 00:03:17–09:59:12 UTC, verified, ~10-hour window] Fee reduction, timestamp manipulation, and batch drain**

Within this window, six further transactions from `0xC4574DDEF...FA69` (§8.1) executed the drain:

- `setFee(1)` reduced the unlock fee to 1 wei, eliminating the economic cost of triggering withdrawals.
- Lock `unlockTime` values were backdated to approximately **68 seconds after the Unix epoch** (~1970-01-01 00:01:08 UTC) so every position appeared immediately withdrawable.
- The verified batch-drain call (tx `0xac8f5ed6…`, 09:59:12 UTC) executed **478 token transfers** of PancakeSwap LP tokens from the locker to the attacker in a single transaction; the remaining verified transactions in the 00:03 cluster account for further batches across the 1,400+ total positions.

**[Phase 3] LP token liquidation**

Withdrawn LP tokens were burned/redeemed to extract underlying BNB and paired tokens. Total realized: ~$7.3M in BNB.

**[Phase 4] Laundering**

Approximately **2,958 BNB (~$1.87M)** were funneled to Binance deposit addresses. The remainder was dispersed through additional addresses.

### 3.3 Attack Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  PRESS-REPORTED (not independently confirmed on-chain)                  │
│                                                                          │
│  Attacker acquires DxSale locker contract ownership ~269 days earlier   │
│  → Laundered through ~80 wallet hops                                     │
│  → Final control: 0xC4574DDEF...FA69                                     │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │ 2026-05-26 01:08:56 UTC — VERIFIED (§8.1)
                                      │ transferOwnership() tx 0x23e331a8…
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Attacker EOA: 0xC4574DDEF...FA69  (labeled "DxSale Exploiter 1")        │
│  (funded via Bybit)                                                      │
│                                                                          │
│  ~3 days pass                                                            │
│  2026-05-29 00:03–09:59 UTC — VERIFIED (§8.1), 6 transactions            │
│                                                                          │
│  locker.setFee(1)                                                        │
│          ❌ Owner-privileged; fee reduced to 1 wei (no timelock)          │
│                                                                          │
│  locker.setUnlockTime(lockId, 68) × 1,400+ locks                        │
│          ❌ Owner overrides immutable-intent lock terms                    │
│          → unlockTime set to ~68s after Unix epoch (Jan 1970);           │
│            every position appears immediately withdrawable                │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Batch drain — VERIFIED tx 0xac8f5ed6… (09:59:12 UTC), from/to the      │
│  attacker EOA directly (no separate drainer contract confirmed)         │
│                                                                          │
│  Step 3: batchUnlock([0, 1, 2, ... , 1400+])  → 478 LP transfers/tx     │
│          For each lockId:                                                │
│          ├─ require(!lock.withdrawn)      ✓                              │
│          ├─ require(block.timestamp >= 68) ✓ (current time >> 68s)      │
│          ├─ require(msg.value >= 1 wei)   ✓                              │
│          └─ IERC20(lock.token).transfer(beneficiary, lock.amount)        │
│             → redirected to attacker-controlled addresses ❌              │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │ ~$7.3M in LP tokens drained
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Attacker wallets                                                         │
│  LP tokens redeemed for underlying BNB                                   │
│  ~$7.3M total                                                            │
│                                                                          │
│  ~$1.87M → Binance                                                       │
│  Remainder → dispersal addresses                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Outcome

| Metric | Value |
|--------|-------|
| Total LP positions drained | 1,400+ |
| Total loss | ~$7.3M in BNB |
| Proceeds to Binance | ~2,958 BNB (~$1.87M) to Binance deposit addresses |
| Bybit (funding source) | Yes |
| Recovery | None reported |
| Locker contract address | [0xEb3a9C56d963b971d320f889bE2fb8B59853e449](https://bscscan.com/address/0xEb3a9C56d963b971d320f889bE2fb8B59853e449) — verified, BscScan-labeled "DxSale Network: Legacy Liquidity Locker" (§8.1) |

---

## 4. Vulnerability Classification

### 4.1 Classification Table and Reclassification Note

> **Reclassification notice**: The source incident database labels this event as **"Missing State Update."** This classification does not match the documented attack mechanism. The `withdrawn` flag was correctly set on each lock after withdrawal (state was updated). The root flaw was that **a privileged owner could unilaterally alter lock terms** (fee, unlock timestamp, beneficiary routing) before and during withdrawal. This is an **Access Control / Privileged-Function Backdoor** failure. Recommending reclassification to CWE-284.

| ID | Vulnerability | Severity | CWE | Category |
|----|---------------|----------|-----|----------|
| V-01 | Locker ownership retained + transferable; not renounced | CRITICAL | CWE-284 | access-control, backdoor |
| V-02 | Unlock fee owner-mutable without timelock or lower bound | HIGH | CWE-284 | access-control, privileged-function |
| V-03 | Lock terms (unlockTime) owner-mutable post-creation | CRITICAL | CWE-841 | logic-error, mutable-lock-terms |
| V-04 | No beneficiary-only withdrawal enforcement | HIGH | CWE-639 | access-control |
| V-05 | Ownership laundered 269 days prior; no transfer event monitoring | HIGH | CWE-284 | access-control, operational |

### 4.2 V-01 — Locker Ownership Retained (Root Cause)

- **Description**: The locker contract extended `Ownable` and never renounced ownership. The protocol's trust model implicitly relied on the original deployer never transferring or abusing ownership — a non-technical assumption that cannot be enforced on-chain. Ownership was transferred ~269 days before the exploit and obscured through ~80 hops.
- **Impact**: Any entity holding locker ownership can drain all locked positions at will via privileged functions. Total exposure equals the sum of all locked LP tokens at any time.
- **Attack Preconditions**: Ownership of the locker contract (obtained off-chain via transfer).

### 4.3 V-02 — Owner-Mutable Unlock Fee (CWE-284)

- **Description**: `setFee()` was an `onlyOwner` function with no lower bound, no timelock, and no event emission. Setting it to 1 wei removed the only remaining economic friction from triggering unlocks.
- **Impact**: Enables economically free batch draining of all 1,400+ positions.
- **Attack Preconditions**: Requires V-01 (owner control).

### 4.4 V-03 — Mutable Lock Terms Post-Creation (CWE-841)

- **Description**: Lock unlock timestamps were stored as mutable state variables with an owner-accessible setter. The semantic promise of a "time-locked" position was not enforced at the code level; it was only an operational convention.
- **Impact**: All locks regardless of original unlock date became immediately withdrawable.
- **Attack Preconditions**: Requires V-01 (owner control).

---

## 5. Comparison with Similar Incidents

| Incident | Date | Loss | Flaw Type | Difference from DxSale |
|----------|------|------|-----------|------------------------|
| **Team Finance Exploit** | 2022-10 | ~$14.5M | Flash loan + pool migration logic; legitimate upgrade called with malicious data | Upgrade path abuse vs. DxSale: direct privileged owner abuse |
| **UNCX Network** | 2023 | N/A (PoC) | Locker admin key risk; no actual exploit | Same class: custodial locker risk; DxSale materialised |
| **Tornado Cash Governance** | 2023-05 | Governance takeover | Malicious governance proposal granted admin control | Governance backdoor vs. DxSale: direct ownership transfer |
| **SafeMoon Exploit** | 2023-03 | ~$8.9M | Privileged `burn()` from liquidity pool via compromised key | Key compromise → privileged drain; same class as DxSale |
| **Ronin Bridge** | 2022-03 | ~$625M | Private key compromise → privileged validator control | Key compromise; DxSale: ownership transfer via laundered hops |

The DxSale incident is distinctive in the **269-day dormancy** between ownership acquisition and exploit execution, suggesting a deliberate long-horizon attack to avoid detection of the ownership transfer.

---

## 6. Remediation Recommendations

### 6.1 Renounce Ownership Post-Deploy

```solidity
// ✅ Renounce after initialization is complete
// In the deploy script / constructor:
constructor() {
    // ... initialization ...

    // Renounce ownership so no address can call privileged functions
    renounceOwnership();
}
```

### 6.2 Immutable Lock Terms

```solidity
// ✅ Lock is a value type stored once; no setter functions exist

struct Lock {
    address token;
    address beneficiary;
    uint256 amount;
    uint256 unlockTime;    // Set at creation; no setUnlockTime() function
    bool    withdrawn;
}

// ✅ No setFee(), no setUnlockTime(), no privileged mutation functions
uint256 public constant UNLOCK_FEE = 0.01 ether;
```

### 6.3 Beneficiary-Only Withdrawal

```solidity
// ✅ Only the beneficiary recorded at lock creation can withdraw
function unlock(uint256 lockId) external payable nonReentrant {
    Lock storage lock = locks[lockId];
    require(msg.sender == lock.beneficiary, "Not beneficiary");
    require(block.timestamp >= lock.unlockTime, "Still locked");
    require(!lock.withdrawn, "Already withdrawn");
    require(msg.value >= UNLOCK_FEE, "Insufficient fee");

    lock.withdrawn = true;
    IERC20(lock.token).transfer(lock.beneficiary, lock.amount);
}
```

### 6.4 Ownership Transfer Monitoring

```solidity
// ✅ If Ownable is retained for non-critical admin (e.g., UI config), emit prominent events
// and require a 48-hour timelock for any ownership change:

function transferOwnership(address newOwner) public override onlyOwner {
    require(
        block.timestamp >= pendingOwnershipTransferTime + 48 hours,
        "Timelock not elapsed"
    );
    super.transferOwnership(newOwner);
}
```

### 6.5 Structural Recommendations

| Issue | Recommendation |
|-------|----------------|
| Retained owner authority | Renounce ownership or transfer to a DAO multisig with timelock |
| Mutable fee | Use immutable constant or governance-timelock-gated update |
| Mutable unlock timestamps | Remove setters; lock terms must be immutable post-creation |
| No beneficiary enforcement | `require(msg.sender == lock.beneficiary)` in unlock |
| No ownership transfer monitoring | Alert infrastructure on `OwnershipTransferred` events for custody contracts |

---

## 7. Lessons Learned

1. **"Time-locked" is a promise, not a guarantee, unless enforced in code.** The entire value proposition of a liquidity locker depends on lock terms being immutable after creation. Any owner-privileged setter on `unlockTime` or `fee` negates this guarantee completely.

2. **Custodial contracts must not retain transferable ownership.** Any contract that holds user funds on a "trust us" basis and retains an `Ownable` pattern is, by definition, not trustless. The design goal of a locker — to remove human discretion — is directly contradicted by retained owner authority.

3. **Long-horizon attacks exploit monitoring gaps.** The 269-day gap between ownership acquisition and exploit was likely deliberate. Protocols monitoring `OwnershipTransferred` events would have detected the transfer in August 2025; no such monitoring was in place or acted upon.

4. **Ownership laundering through 80 hops indicates organized actors.** This is not opportunistic; it is a planned campaign. The laundering overhead implies a calculated risk-reward assessment against a $7.3M target.

5. **"Missing State Update" is an inaccurate classification for this incident.** Mislabeling root causes in security databases degrades the utility of those databases for future defenders. Backdoor access-control failures and state-update bugs require different defenses; conflating them leads to incomplete mitigations.

6. **Legacy 2021-era BSC locks are high-value targets.** SafeMoon-era locks represent locked value from a period of high retail activity. Projects that launched in 2021 and locked LP for 2–5 years created a pool of value that will remain targetable through 2025–2026, making periodic security reviews of legacy locker contracts essential.

---

## 8. On-Chain Verification

> **Update**: The originally-provided hash (`0x2b39f048033a9205c5a62ca43016263cfcca9bab74c48fdc06f43bd29307b26a`, a one-character variant of Flooring Protocol's `0xb139f048...`) was never found on-chain. **7 real transactions have since been identified** (cross-checked against BlockSec's Security Incidents Library) and independently verified on BscScan — see §8.1. These also confirm the Legacy Liquidity Locker contract address, which prior public reporting (PeckShield/Coinsult) had described as undisclosed.

### 8.1 Verified Transactions

| # | Tx Hash | Time (UTC) | From | Method | Effect |
|---|---------|------------|------|--------|--------|
| 1 | [0x23e331a81e496890c8f6147a672c6bc45cc2d2dd17547e72713b6ee070b38d41](https://bscscan.com/tx/0x23e331a81e496890c8f6147a672c6bc45cc2d2dd17547e72713b6ee070b38d41) | 2026-05-26 01:08:56 | `0x47BAcf935066b802EAA0067eC14AB035B24eB78b` | `transferOwnership()` | Transfers locker ownership **to** `0xC4574DDEF...FA69` |
| 2 | [0xb0d988a56f7e54197c800bf9a32a11e219f7b3d0c399005dc0fbbd3dbe691b31](https://bscscan.com/tx/0xb0d988a56f7e54197c800bf9a32a11e219f7b3d0c399005dc0fbbd3dbe691b31) | 2026-05-29 00:03:17 | `0xC4574DDEF...FA69` | — | Part of drain sequence |
| 3 | [0xf0a45b660eebc2d6dac7a5a3add28d7388e45fc413488e9e16eb5a8206cb1f20](https://bscscan.com/tx/0xf0a45b660eebc2d6dac7a5a3add28d7388e45fc413488e9e16eb5a8206cb1f20) | 2026-05-29 00:03:18 | `0xC4574DDEF...FA69` | — | Part of drain sequence |
| 4 | [0x437b26887ba03c08b7541a86e8eeda5e92a9059244fcf814c721dc13f2c1b303](https://bscscan.com/tx/0x437b26887ba03c08b7541a86e8eeda5e92a9059244fcf814c721dc13f2c1b303) | 2026-05-29 00:03:19 | `0xC4574DDEF...FA69` | — | Part of drain sequence |
| 5 | [0x82f5418835642f6d8f29b0686f39b7ca73023748d3c2c7d1827418ce51a9fa73](https://bscscan.com/tx/0x82f5418835642f6d8f29b0686f39b7ca73023748d3c2c7d1827418ce51a9fa73) | 2026-05-29 00:03:21 | `0xC4574DDEF...FA69` | — | Part of drain sequence |
| 6 | [0x5dd61f4301101cb55a7f89eea3ce98a3bcc6f0f55878c26ab16665a01e4298aa](https://bscscan.com/tx/0x5dd61f4301101cb55a7f89eea3ce98a3bcc6f0f55878c26ab16665a01e4298aa) | 2026-05-29 00:03:22 | `0xC4574DDEF...FA69` | — | Part of drain sequence |
| 7 | [0xac8f5ed6cac1e6c6d6e96bad34f5211c8ae23cf05866b2531f3f3e63bcd36df9](https://bscscan.com/tx/0xac8f5ed6cac1e6c6d6e96bad34f5211c8ae23cf05866b2531f3f3e63bcd36df9) | 2026-05-29 09:59:12 | `0xC4574DDEF...FA69` (self-call) | `0x11b432b4` | **478 PancakeSwap LP-token transfers** from the locker to the attacker in a single tx (0.5446 tokens each) |

**Verified addresses:**

| Role | Address | Status |
|------|---------|--------|
| Attacker EOA | `0xC4574DDEF299e7E563971e200433e592EeaaFA69` | **Verified**, BscScan-labeled "DxSale Exploiter 1" (Phish/Hack tag; ExVul attribution) |
| Legacy Liquidity Locker (vulnerable contract) | [0xEb3a9C56d963b971d320f889bE2fb8B59853e449](https://bscscan.com/address/0xEb3a9C56d963b971d320f889bE2fb8B59853e449) | **Verified**, BscScan-labeled "DxSale Network: Legacy Liquidity Locker" |
| Pre-takeover owner | `0x47BAcf935066b802EAA0067eC14AB035B24eB78b` | Verified as `from` on the `transferOwnership()` tx; no BscScan label |
| Drainer contract (`0xC2efbd94…01e4718`) | — | **Not corroborated** — the verified batch-drain tx (#7) is from/to the attacker EOA directly, not a separate drainer contract |

> **Assessment**: 7 real, on-chain, BscScan-verified transactions now support this incident, replacing the original fabricated hash. The Legacy Liquidity Locker address is now confirmed (contradicting prior reporting that it was undisclosed). The ownership-transfer tx (#1) precisely matches the source-list incident timestamp, while the actual batch drain (#2–7) occurred ~3 days later — refining the previously-assumed same-day timeline. The separately-reported "drainer contract" is not corroborated by the verified batch-drain transaction. Remaining analysis is based on public reporting from crypto.news, cryptopotato.com, cryptotimes.io, and invezz.com.

### 8.2 Incident Data — Verified vs. Press-Reported

| Field | Value | Status |
|-------|-------|--------|
| Primary Attacker EOA | `0xC4574DDEF299e7E563971e200433e592EeaaFA69` — BscScan-labeled "DxSale Exploiter 1" | **Verified** (§8.1) |
| Legacy Liquidity Locker | `0xEb3a9C56d963b971d320f889bE2fb8B59853e449` | **Verified** (§8.1) |
| Ownership transfer to attacker EOA | 2026-05-26 01:08:56 UTC, tx `0x23e331a8…` | **Verified** (§8.1) |
| Batch drain window | 2026-05-29 00:03:17–09:59:12 UTC | **Verified** (§8.1) |
| Unlock timestamp manipulation | Backdated to ~68 seconds after Unix epoch (~1970-01-01 00:01:08 UTC) | Press-reported; consistent with verified drain mechanics |
| Drainer contract (`0xC2efbd94…01e4718`) | Reportedly deployed ~9h before drain via a separate deployer | **Not corroborated** — verified batch-drain tx is from/to the attacker EOA directly |
| Earlier-stage ownership transfer lag | ~269 days before exploit (~Aug 2025) | Press-reported, not independently confirmed on-chain |
| Ownership laundering | ~80 intermediate wallet hops | Press-reported, not independently confirmed on-chain |
| LP positions drained | ~1,400 (2021-era locks) | Press-reported |
| Total loss | ~$7.3M in BNB | Press-reported |
| Proceeds to Binance | ~2,958 BNB (~$1.87M) to Binance deposit addresses | Press-reported |
| Funding source | Bybit | Press-reported |
| Asset type | Legacy 2021 LP token locks (incl. SafeMoon-era tokens) |

### 8.3 Fund Flow (Per Public Reports)

| Step | Detail |
|------|--------|
| Funding | Bybit → attacker EOA |
| Exploit | Batch drain of 1,400+ LP lock positions on BSC |
| Laundering | ~2,958 BNB (~$1.87M) to Binance deposit addresses; remainder to dispersal addresses |
| Recovery | None reported |

### 8.4 Reclassification Summary

| Field | Source-List Label | Documented Root Cause |
|-------|------------------|----------------------|
| Classification | "Missing State Update" | Access Control — Privileged-Function Backdoor |
| CWE | — | CWE-284 (primary), CWE-841, CWE-639 |
| Recommended action | Reclassify in database | Replace with "Backdoor / Privileged Access Abuse" |

---

## 9. References

### News Sources
- [DxSale Exploit Drains $7.3M in BNB Through Hidden Contract Backdoor (crypto.news)](https://crypto.news/dxsale-exploit-drains-7-3m-in-bnb-through-hidden-contract-backdoor/)
- [Over 1,400 Liquidity Providers Hit in $7.3 Million DxSale Exploit (cryptopotato.com)](https://cryptopotato.com/over-1400-liquidity-providers-hit-in-7-3-million-dxsale-exploit/)
- [Hackers Drain $7.3M from DxSale's Old BNB Chain Liquidity Lockers (cryptotimes.io)](https://cryptotimes.io/2026/05/29/hackers-drain-7-3m-from-dxsales-old-bnb-chain-liquidity-lockers/)
- [DxSale Loses $7.3M in BNB Chain Liquidity Providers Hack (invezz.com)](https://invezz.com/news/2026/05/29/dxsale-loses-7-3m-in-bnb-chain-liquidity-providers-lps-hack/)

### CWE References
- [CWE-284: Improper Access Control](https://cwe.mitre.org/data/definitions/284.html)
- [CWE-639: Authorization Bypass Through User-Controlled Key](https://cwe.mitre.org/data/definitions/639.html)
- [CWE-841: Improper Enforcement of Behavioral Workflow](https://cwe.mitre.org/data/definitions/841.html)
- [CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html)

### Related Incidents & Patterns
- [Team Finance Exploit (2022-10)](../2022/2022-10-27_TeamFinance_MigrateSqrtPrice.md)
- Related vulnerability patterns: [../vulns/access-control.md](../vulns/access-control.md), [../vulns/private-key-compromise.md](../vulns/private-key-compromise.md)
