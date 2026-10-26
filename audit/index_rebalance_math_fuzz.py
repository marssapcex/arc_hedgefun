#!/usr/bin/env python3
"""Deterministic property/fuzz harness for the pasted Index._ensureReserves + rebalance fee path.

This is a standalone arithmetic model, not a fork test: the audited Factory/Index sources
were pasted in chat and are not present in this checkout.  It mirrors the generic
rebalance() reserve check (including Math.mulDiv floor), weight tolerance, and minFee
integer expression.  Run: python3 audit/index_rebalance_math_fuzz.py
"""
from decimal import Decimal, getcontext
import random

getcontext().prec = 70
ETHER = 10**18
B = 10**24
SWAP_FEE = 10  # allowed minimum; fee denominator in Index is swapFee + 1000
W_IN = ETHER
W_OUT = ETHER + 10**16  # exactly the <= 0.01 ether equal-weight tolerance
W_PROTOCOL = 50 * ETHER - W_IN - W_OUT
assert W_OUT - W_IN == 10**16

# Chosen balances make the protocol-token fee's value match the input token's value:
# p_i = weight_i / balance_i, so B_protocol / B_in = W_protocol / W_in.
b_in0 = B
b_out0 = B
b_protocol0 = B * W_PROTOCOL // W_IN

# External spot prices at the initial weighted-pool marginal prices, normalized so
# one input-token unit is worth one. These are used only to express the attacker's
# extracted value in a common numeraire; the on-chain invariant check itself is exact.
p_in = Decimal(1)
p_out = Decimal(W_OUT) / Decimal(W_IN) * Decimal(b_in0) / Decimal(b_out0)
p_protocol = Decimal(W_PROTOCOL) / Decimal(W_IN) * Decimal(b_in0) / Decimal(b_protocol0)


def sol_min_fee(dx, bp, bi):
    # Exact integer expression in Index.rebalance() for tokenIn != protocol token.
    # This product ordering matches Solidity; chosen values stay below uint256 overflow.
    numerator = dx * bp * W_IN * SWAP_FEE
    denominator = bi * W_PROTOCOL * (1000 + SWAP_FEE)
    return numerator // denominator


def max_output_preserving_product(bi, bo, dx):
    # Math.mulDiv(bi+dx, bo-dy, bo) >= bi. Find maximal integer dy.
    required_remaining = (bi * bo + (bi + dx) - 1) // (bi + dx)
    return bo - required_remaining


def weighted_log_delta(bi, bo, bp, dx, dy, fee):
    # Exact real-valued weighted invariant change; scale weights out by total weight.
    return (
        Decimal(W_IN) * (Decimal(bi + dx) / Decimal(bi)).ln()
        + Decimal(W_OUT) * (Decimal(bo - dy) / Decimal(bo)).ln()
        + Decimal(W_PROTOCOL) * (Decimal(bp + fee) / Decimal(bp)).ln()
    ) / Decimal(50 * ETHER)


def one_trade(bi, bo, bp, dx):
    dy = max_output_preserving_product(bi, bo, dx)
    fee = sol_min_fee(dx, bp, bi)
    # Exact same-weight branch check: Math.mulDiv(R1_new,R2_new,R2_original) >= R1_original.
    assert ((bi + dx) * (bo - dy) // bo) >= bi
    actual_delta = weighted_log_delta(bi, bo, bp, dx, dy, fee)
    marked_profit = Decimal(dy) * p_out - Decimal(dx) * p_in - Decimal(fee) * p_protocol
    return dy, fee, actual_delta, marked_profit


# 1) Broad deterministic fuzz over amount magnitudes and rounding boundaries.
rng = random.Random(0xBADA55)
accepted_loss = []
positive_profit = []
for _ in range(250_000):
    # Broad log-uniform range plus boundary-focused offsets around 1, 10, 1000, and
    # powers-of-ten divisibility boundaries; bounded to keep products uint256-safe.
    exp = rng.randrange(0, 18)
    dx = rng.randrange(1, 10**6) * 10**exp
    if dx >= B // 4:
        dx = B // 4 - 1
    dy, fee, dlog, profit = one_trade(B, B, b_protocol0, dx)
    if dlog < 0 and fee >= 0:
        accepted_loss.append((dx, dy, fee, dlog, profit))
    if profit > 0:
        positive_profit.append((dx, dy, fee, dlog, profit))

assert accepted_loss, "expected fuzz to find accepted weighted-invariant loss"
assert positive_profit, "expected fuzz to find positive mark-to-market extraction"

# 2) Find best single-trade extraction over a dense sweep of integer-sized amounts.
best = None
for parts in range(1, 200_001):
    dx = B * parts // 10**9  # 1e-9..2e-4 of reserve
    if dx == 0:
        continue
    dy, fee, dlog, profit = one_trade(B, B, b_protocol0, dx)
    if profit > 0 and (best is None or profit > best[-1]):
        best = (dx, dy, fee, dlog, profit)
assert best is not None

# 3) Simulate a long public rebalance sequence. Each iteration takes the largest
# profitable input from a geometric candidate set against a fixed external spot,
# pays the exact on-chain minimum fee in protocol token, and satisfies the exact
# product-check rounding predicate. Stop when no tested amount is profitable.
bi, bo, bp = B, B, b_protocol0
start_log = Decimal(0)
seq = []
for n in range(300):
    candidates = {max(1, bi // (10**k)) for k in range(2, 10)}
    candidates |= {max(1, bi * q // 1_000_000) for q in (1, 2, 5, 10, 20, 50, 100)}
    choice = None
    for dx in candidates:
        if dx >= bi:
            continue
        dy, fee, dlog, profit = one_trade(bi, bo, bp, dx)
        if profit > 0 and (choice is None or profit > choice[-1]):
            choice = (dx, dy, fee, dlog, profit)
    if choice is None:
        break
    dx, dy, fee, dlog, profit = choice
    seq.append(choice)
    bi += dx
    bo -= dy
    bp += fee
    start_log += dlog

assert len(seq) == 1, "one trade should move the spot past the same-direction fee threshold"
assert start_log < 0, "weighted invariant must fall over the accepted trade"
assert sum(t[4] for t in seq) > 0, "attacker's marked net proceeds must be positive"

print("PASS: 250,000 fuzz cases; found accepted weighted-invariant loss and positive extraction")
print(f"Weights (protocol,input,output): {W_PROTOCOL/ETHER:.6f}, {W_IN/ETHER:.6f}, {W_OUT/ETHER:.6f}")
print(f"Initial balances (input,output,protocol): {B}, {B}, {b_protocol0}")
print("Best one-step fuzzed candidate:")
print(f"  dx={best[0]} dy={best[1]} fee={best[2]}")
print(f"  weighted_delta_lnK={best[3]} marked_profit={best[4]} input-token units")
print(f"Same-direction follow-up search: opportunity exhausted after {len(seq)} profitable call(s)")
print(f"  total input={sum(t[0] for t in seq)} output={sum(t[1] for t in seq)} protocol fee={sum(t[2] for t in seq)}")
print(f"  cumulative weighted_delta_lnK={start_log}")
print(f"  cumulative marked profit={sum(t[4] for t in seq)} input-token units")
print("Accepted trade (dx,dy,fee,delta_lnK,marked_profit):")
print(" ", seq[0])
