#!/usr/bin/env python3
"""Fuzz model for generic rebalance(tokenIn = protocolToken).

The arithmetic mirrors the pasted Index.rebalance() fee calculation and its
near-equal-weight product check. It deliberately asserts that the measured fee
is the protocol-token input itself, not an additional transfer.
"""
from decimal import Decimal, getcontext
import random
getcontext().prec = 70

E = 10**18
B = 10**24
W_PROTOCOL = 2_500_000_000_000_000_000
W_OUT = 2_510_000_000_000_000_000
FEE_RATE = 10
assert W_OUT - W_PROTOCOL == 10**16


def trial(dx):
    # The exact max integer dy satisfying Math.mulDiv(B+dx, B-dy, B) >= B.
    dy = B - ((B * B + B + dx - 1) // (B + dx))
    assert ((B + dx) * (B - dy) // B) >= B

    # Index.rebalance fee: protocol balance delta equals tokenIn delta because
    # tokenIn == tokens[0]. The min fee simplifies to dx*10/1010 and is met by
    # fee=dx without any distinct fee-token deposit.
    measured_fee = dx
    min_fee = dx * B * W_PROTOCOL * FEE_RATE // (B * W_PROTOCOL * (1000 + FEE_RATE))
    assert measured_fee >= min_fee

    # Fair starting marginal prices pOut/pProtocol = 2.51/2.5 = 251/250.
    profit = Decimal(dy) * Decimal(251) / Decimal(250) - Decimal(dx)
    dlog = (
        Decimal(W_PROTOCOL) * (Decimal(B + dx) / Decimal(B)).ln()
        + Decimal(W_OUT) * (Decimal(B - dy) / Decimal(B)).ln()
    ) / Decimal(50 * E)
    return dy, measured_fee, profit, dlog


rng = random.Random(0xC0FFEE)
for _ in range(250_000):
    # 1e15..3.9e21 raw units; all stay inside the positive arbitrage interval.
    dx = 10**15 + rng.randrange(0, 3_900_000) * 10**15
    dy, fee, profit, dlog = trial(dx)
    assert profit > 0
    assert dlog < 0

# Concrete regression transaction used by the EVM harness.
dx = 2 * 10**21
dy, fee, profit, dlog = trial(dx)
print("PASS: 250,000 fuzzed protocol-input swaps; every accepted trade has positive marked proceeds and decreases weighted ln(K)")
print(f"weights: protocol={W_PROTOCOL/E:.2f}, output={W_OUT/E:.2f}, third token=44.99; TOTAL_WEIGHT=50")
print(f"balances: protocol={B}, output={B}; starting marginal price ratio output/protocol=251/250")
print(f"concrete: dx={dx}, dy={dy}, measured fee={fee} (exactly dx; no separate fee transfer)")
print(f"marked profit={profit} input-token units; weighted delta_lnK={dlog}")

# Parametric sweep: vary hundreds of valid configurations rather than only the
# concrete regression point. Each case varies protocol/output weights, epsilon
# gap, fee rate, independent balances, and an approximately optimal trade size.
configs = random.Random(0x51A7E)
min_profit = None
max_loss = Decimal(0)
for _ in range(250_000):
    wp = 2_500_000_000_000_000_000 + configs.randrange(0, 219_900) * 10**14
    gap = 10**14 + configs.randrange(0, 9_900_000_000_000_000)
    wo = wp + gap
    assert 50 * E - wp - wo >= E  # third token remains >= Factory MIN_WEIGHT
    bp = 10**24 + configs.randrange(0, 10_000) * 10**23
    bo = 10**24 + configs.randrange(0, 10_000) * 10**23
    fee_rate = 10 + configs.randrange(0, 19_991)  # constructor transition spans to 20,000
    dx = bp * gap // (2 * wp)
    dy = bo - ((bp * bo + bp + dx - 1) // (bp + dx))
    assert dy > 0
    assert ((bp + dx) * (bo - dy) // bo) >= bp

    observed_fee = dx  # tokenIn is protocolToken: balance delta itself is called "fee"
    required_fee = dx * bp * wp * fee_rate // (bp * wp * (1000 + fee_rate))
    assert observed_fee >= required_fee

    proceeds = Decimal(dy) * Decimal(wo) * Decimal(bp) / (Decimal(wp) * Decimal(bo)) - Decimal(dx)
    invariant_delta = (
        Decimal(wp) * (Decimal(bp + dx) / Decimal(bp)).ln()
        + Decimal(wo) * (Decimal(bo - dy) / Decimal(bo)).ln()
    ) / Decimal(50 * E)
    assert proceeds > 0
    assert invariant_delta < 0
    min_profit = proceeds if min_profit is None else min(min_profit, proceeds)
    max_loss = min(max_loss, invariant_delta)

print("PASS: 250,000 additional configurations spanning weights, epsilon gaps, independent balances, fee rates and near-optimal sizes")
print(f"  third-token weight always valid; protocol weight=2.50..24.49; gap=0.0001..0.01; fee=10..20000")
print(f"  minimum sampled marked proceeds={min_profit} raw input units; most negative sampled delta_lnK={max_loss}")
q = Decimal(10**16) / Decimal(2_500_000_000_000_000_000)  # max gap / min protocol weight = 0.004
z_opt = (Decimal(1) + q).sqrt() - Decimal(1)
print(f"  analytic max at q=0.004: x/P={z_opt}; max proceeds/P={z_opt*z_opt}")
