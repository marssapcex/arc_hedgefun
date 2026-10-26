# Focused audit: pasted Factory / Index weighted pool

## Result

**Confirmed permissionless value-extraction bug** in the generic `Index.rebalance()` route. It combines (1) treating a small but nonzero weight difference as exactly equal weights, with (2) allowing `tokenIn == protocolToken`, so the protocol-token input itself satisfies the fee check without a separate fee being charged or removed from the invariant calculation. The accepted post-state can have a lower true weighted invariant while the caller receives more market value than they paid.

**Severity: Medium, conditional on pool configuration/state.** The extraction is bounded by the 0.01-weight tolerance per trade and by the available arbitrage spread, not an unrestricted drain. Larger affected pools scale the absolute amount. A malicious/compromised manager is not needed to execute it; an unlocked pool and an ordinary callback contract suffice. A target pool does need near-equal protocol/output weights and a usable external price spread.

## Root cause in the pasted code

In `_ensureReserves`, pairs whose absolute weight difference is at most `0.01 ether` use the equal-weight product invariant:

```solidity
if (abs(w1_int - w2_int) <= 0.01 ether) {
    if (Math.mulDiv(R1_new, R2_new, R2_original) < R1_original) revert;
}
```

But the weights need not be equal. Factory permits protocol weight `2.5 ether`, another token weight `2.51 ether`, and a third token weight `44.99 ether` (sum exactly `50 ether`). The two-token pool slice therefore has a genuine 0.4% relative weight mismatch while taking the equal-weight branch.

Separately, `rebalance()` computes:

```solidity
uint256 fee = getBalance(tokens[0]) - balanceProtocolToken;
uint256 minFee = deltaIn * balanceProtocolToken * weightIn * swapFee
    / (balanceInBefore * weightProtocol * (1000 + swapFee));
if (fee < minFee) revert Index__InsufficientFee();
```

When `_tokenIn == tokens[0]`, `fee == deltaIn`. Since `balanceInBefore == balanceProtocolToken` and `weightIn == weightProtocol`, the minimum reduces to approximately `deltaIn * swapFee / (1000 + swapFee)`. The test is trivially satisfied by the input itself. Crucially, generic `rebalance()` passes the **full** `balanceIn` to `_ensureReserves`; unlike `rebalanceProtocolTokenIn()`, it does not subtract the fee from the input balance first. Thus there is no separate fee cost in this path.

## Concrete permissionless attack

Valid configuration:

- Weights: protocol `2.50`, output token `2.51`, third token `44.99` (total `50.00`).
- `swapFee = 10` (the allowed minimum; wait for the constructor's one-week fee transition to finish).
- Protocol and output balances each `B = 10^24` raw units; reserve is zero. The third token has any positive balance.
- The protocol token is token 0, and the index is unlocked (the default).

An attacker calls public `rebalance(output, dy, protocolToken, attackerCallback, data)`. The callback takes `dy` output tokens using the one-use approval and returns `dx` protocol tokens. It does **not** send a second fee payment.

For `dx = 2 * 10^21`, choose the largest integer output preserving the equal-product check:

```text
dy = B - ceil(B² / (B + dx))
   = 1,996,007,984,031,936,127,744
```

Then the exact Solidity-style floor check passes:

```text
floor((B + dx) * (B - dy) / B) = B
```

The min-fee check also passes:

```text
fee measured by Index = delta protocol balance = dx
minFee = floor(dx * 10 / 1010)
       = 19,801,980,198,019,801,980
```

No additional fee tokens were transferred: the same `dx` is both the swap input and the entire amount the generic branch labels `fee`.

At the legitimate weighted-pool starting marginal prices, `pOutput / pProtocol = 2.51 / 2.50 = 251 / 250`. The caller's mark-to-market proceeds are positive:

```text
profit = dy * 251/250 - dx
       = 3,992,015,968,063,872,254.976 raw input-token units
```

For 18-decimal tokens, this is about **3.992 tokens** from a `10^6`-token protocol reserve in the concrete model. This is close to the route's maximum for the allowed weight gap. Let `a` be the protocol weight, `b=a+δ` the output weight, `P` the protocol reserve, and `x/P=z`. At the starting weighted marginal price and on the constant-product curve, the attacker's mark-to-market gain is:

```text
profit/P = z * (δ/a - z) / (1 + z)
```

It is maximized at `z = sqrt(1 + δ/a) - 1`, with maximum fraction `(sqrt(1 + δ/a) - 1)^2`. The most permissive valid case is `a=2.50`, `δ=0.01`, hence `δ/a=0.004` and a maximum around **3.992 × 10⁻⁶ of protocol reserve value**. For a `10^6`-token reserve, that is about 3.992 tokens before integer-rounding effects. On the constant-product boundary, the true weighted log invariant changes by `(a-b) * ln(1+z) < 0`; integer rounding is checked in the PoCs.

The high-precision weighted invariant calculation for the concrete trade gives:

```text
Δ ln(K) = -3.9960053253461120… × 10^-7
```

So this is not merely a fee-accounting oddity: the accepted trade decreases the true weighted invariant and extracts positive value. The relative amount scales with pool size, and repeated access to separate affected pools scales the aggregate.

## Zero-fee flashloan composition

I added an atomic EVM regression using a lender that charges zero flashloan fee, plus a separate constant-product liquidation venue charging 10 bps (so this does not assume that the swap itself is free). The attacker borrows `2,000` protocol tokens, executes the same public Index rebalance, sells the received output, repays the lender in the same callback, and ends with **1.988019960107720677 protocol tokens**. The lender's pre-loan balance is unchanged, proving repayment. This confirms a flashloan removes the attacker's capital requirement and makes the value extraction atomic; it does not increase the per-pool price discrepancy or remove the need for a liquid exit market. With higher liquidation fees or slippage, net profit can disappear.

The flashloan regression models the user's stated 0% loan-fee premise. It does not call Balancer Vault itself or assert that all Balancer deployments/configurations currently charge zero; the actual source/chain configuration should be checked before a live exploitability claim. The liquidation venue is separate from the lender because a lending protocol may prevent same-vault reentrant swaps.

## Validation performed

The minimized EVM harness in `audit/test/IndexNearEqualWeightExploit.t.sol` reproduces the relevant public callback flow, exact weight tolerance, product-floor check, min-fee expression, token balance movements, and atomic borrowing/liquidation. It was compiled with Solidity 0.8.20 and run on Ganache:

- 2 concrete EVM regression attacks passed.
- 1 atomic zero-fee flashloan regression passed, including exact repayment and positive residual profit.
- **1,100 seeded EVM fuzz executions passed**: 300 seeds each for the protocol-input exploit and a second near-equal-weight route, plus 500 EVM scenarios varying valid weights, weight gap, independent reserves, fee rates, and near-optimal trade size.
- `audit/protocol_input_fuzz.py`: 250,000 fixed-point cases and an additional 250,000 randomized configurations. The latter spans protocol weight `2.50..24.49`, gap `0.0001..0.01`, both reserves independently from `10^24..~10^27`, fee rates `10..20,000`, and checks the exact product floor, fee inequality, positive marked proceeds, and negative weighted `ln(K)` change.
- `audit/index_rebalance_math_fuzz.py`: 250,000 randomized cases plus a 200,000-point amount sweep for the related case where protocol token is a third-token fee asset; it also finds positive extraction, but the protocol-input route above is the stronger finding.

Reproduce with:

```sh
cd audit && npm install && npm run poc
cd .. && python3 audit/protocol_input_fuzz.py
python3 audit/index_rebalance_math_fuzz.py
```

## Scope / caveat

The pasted contracts are not present in this Git checkout, so the EVM test is a reduced reproduction of the exact affected math and callback/balance flow, rather than a full deployment of the complete pasted `Index` bytecode. The user-provided `Factory` constraints and `Index` statements were checked against the harness assumptions. The finding does not rely on ABDK approximation: this concrete exploit deliberately enters the equal-weight branch, so the vulnerable check is the integer `mulDiv` product path.
