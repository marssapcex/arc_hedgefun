"""Checks the two things the Balancer and Bunni post-mortems turn on, against a
Python mirror of HedgeFunBondingCurve's quote arithmetic:

  1. is the net principal actually charged the net that gets credited?
     (Balancer: the exit amount was upscaled with mulDown, so the charge was
      lower than the credit -- repeated 121 times, that drained the pool)
  2. does a sequence of operations move value in the caller's favour by more
     than rounding dust? (Bunni: every rounding direction was safe alone, the
     composition was not)

Run:  python3 audit/poc/curve_rounding_check.py
"""
import random

SUPPLY = 10 ** 27
VIRTUAL_STOCK = 10 ** 24


def mulDiv(a, b, c):
    return a * b // c


def ceilDiv(a, b):
    return -(-a // b)


class Curve:
    """HedgeFunBondingCurve's state and quotes, line for line."""

    def __init__(self, supply=SUPPLY, virtualStock=VIRTUAL_STOCK, saleBps=8000, taxBps=700):
        self.supply = supply
        self.x = supply                      # tokenReserve
        self.y0 = virtualStock               # virtualStock
        self.k = supply * virtualStock       # invariant
        self.minRes = supply * (10000 - saleBps) // 10000
        self.terminal = ceilDiv(self.k, self.minRes)
        self.tax = taxBps
        self.y = 0                           # realStockReserve
        self.fees = 0                        # totalFees
        self.status = 'Active'

    # --- quotes ---------------------------------------------------------
    def grossStock(self, net):
        return 0 if net == 0 else mulDiv(net - 1, 10000, 10000 - self.tax) + 1

    def quoteBuy(self, maxStockIn):
        x, y, k = self.x, self.y0 + self.y, self.k
        capCost = self.terminal - y
        capPayment = self.grossStock(capCost)
        payment = min(maxStockIn, capPayment)
        budget = payment - mulDiv(payment, self.tax, 10000)
        newReserve = self.minRes if budget == capCost else ceilDiv(k, y + budget)
        gross = x - newReserve
        stockSpent = self.grossStock(ceilDiv(k, newReserve) - y)
        taxTokens = mulDiv(gross, 0, 1)      # buyRateBps() == taxBps outside the snipe window
        return stockSpent, gross - taxTokens, budget, newReserve

    def quoteSell(self, tokenIn):
        x, y, k = self.x, self.y0 + self.y, self.k
        gross = y - ceilDiv(k, x + tokenIn)
        taxStock = mulDiv(gross, self.tax, 10000)
        return gross - taxStock, gross, taxStock

    # --- state transitions (the contract's _buy / sell) -------------------
    def buy(self, maxStockIn):
        self.spent, out, budget, newReserve = self.quoteBuy(maxStockIn)
        if self.spent == 0 or out == 0:
            raise ValueError('BadTrade')
        self.credited = self.spent - mulDiv(self.spent, self.tax, 10000)   # what the curve actually books
        self.x -= out
        self.y += self.credited
        fee = mulDiv(self.spent, self.tax, 10000)
        self.fees += fee
        if self.x == self.minRes:
            self.status = 'Ready'
        return out

    def sell(self, tokenIn):
        out, gross, fee = self.quoteSell(tokenIn)
        if tokenIn == 0 or out == 0:
            raise ValueError('BadTrade')
        if gross > self.y:
            raise ValueError('Insolvent')
        self.x += tokenIn
        self.y -= gross
        self.fees += fee
        return out

    def invariant(self):
        return self.x * (self.y0 + self.y)


def check_fee_inversion():
    """`_grossStock` is the exact inverse of the base fee: pay g, net g - floor(g*t/10000)."""
    bad = 0
    sizes = list(range(1, 300)) + [10 ** 6, 10 ** 12, 10 ** 18, 10 ** 23, 10 ** 26]
    for tax in range(0, 10000):
        c = Curve(taxBps=tax)
        for net in sizes:
            g = c.grossStock(net)
            if g - mulDiv(g, tax, 10000) != net:
                bad += 1
    return bad, 10000 * len(sizes)


def check_credit_matches_charge(rounds=20000, tax=700):
    """The stock booked on a buy is exactly the principal the token move implies.

    Both sides are taken from the state BEFORE the buy: `net` is what the buyer
    paid (after the base fee), `implied` is the principal the new token reserve
    prices. If booked < implied the pool hands out tokens a wei cheaper than it
    books them -- Balancer's shape, one wei at a time.
    """
    c, mismatch, worst = Curve(taxBps=tax), 0, 0
    rng = random.Random(3)
    for _ in range(rounds):
        pay = rng.choice([1, 2, 3, 7, 137, 10 ** 4, 10 ** 9, 10 ** 15, rng.randrange(1, 10 ** 22)])
        yBefore = c.y0 + c.y
        try:
            c.buy(pay)
        except ValueError:
            continue
        net = c.spent - mulDiv(c.spent, c.tax, 10000)
        implied = ceilDiv(c.k, ceilDiv(c.k, yBefore + net)) - yBefore
        if c.credited != implied:
            mismatch += 1
        worst = max(worst, abs(c.credited - implied))
    return mismatch, worst


def check_invariant_bound(rounds=20000):
    """|Δk| per operation stays inside the rounding dust, never a fraction of k."""
    c = Curve()
    rng = random.Random(4)
    worst_rel, worst_op = 0.0, None
    for _ in range(rounds):
        before = c.invariant()
        try:
            if rng.random() < 0.5:
                c.buy(rng.choice([1, 2, 10, 10 ** 6, rng.randrange(1, 10 ** 20)]))
                op = 'buy'
            else:
                room = c.supply - c.x
                if room < 2:
                    break
                c.sell(rng.randrange(1, min(room, 10 ** 18)))
                op = 'sell'
        except ValueError:
            continue
        rel = abs(c.invariant() - before) / before
        if rel > worst_rel:
            worst_rel, worst_op = rel, op
    return worst_rel, worst_op


def check_round_trip(tax, cycles=3000):
    """Buy then sell the same tokens back: the attacker must not come out ahead."""
    c = Curve(taxBps=tax)
    rng = random.Random(5)
    best, total = 0, 0
    for _ in range(cycles):
        pay = rng.choice([1, 2, 3, 10, 1000, 10 ** 6, rng.randrange(1, 10 ** 12)])
        held = c.y                       # attacker's stock before the cycle
        stockRow = c.y
        try:
            tokens = c.buy(pay)
        except ValueError:
            continue
        got = c.credited
        try:
            back = c.sell(tokens)
        except ValueError:
            # a sell that cannot be priced leaves the attacker holding tokens
            c.x, c.y = c.x, c.y
            continue
        profit = back - got
        best = max(best, profit)
        total += profit
    return best, total


def check_graduation_edge():
    """The capped final buy lands exactly on minTokenReserve and never overdraws."""
    c = Curve()
    rng = random.Random(6)
    buys = 0
    while c.status == 'Active' and buys < 200000:
        before_x = c.x
        try:
            out = c.buy(rng.choice([10 ** 20, 10 ** 22, 10 ** 24]))
        except ValueError:
            break
        if out > before_x or c.x < c.minRes:
            return False, f'overdrew: out {out} from x {before_x}, left {c.x}'
        buys += 1
    return c.status == 'Ready' and c.x == c.minRes, f'{buys} buys, x {c.x}, minReserve {c.minRes}'


def check_sell_never_overdraws(rounds=20000):
    """quoteSell's Insolvent() guard: gross can never exceed realStockReserve."""
    c = Curve()
    rng = random.Random(7)
    for _ in range(rounds):
        try:
            c.buy(rng.choice([10 ** 15, 10 ** 18, 10 ** 21]))
        except ValueError:
            break
        room = c.supply if c.status == 'Active' else 0
        room = c.supply - c.x
        if room <= 1:
            break
        tokenIn = rng.randrange(1, min(room, c.supply - c.x))
        try:
            out, gross, _ = c.quoteSell(tokenIn)
        except ValueError:
            continue
        if gross > c.y:
            return False
        c.sell(tokenIn)
    return True, 'no sell priced above the stock reserve'


if __name__ == '__main__':
    failed = 0

    bad, total = check_fee_inversion()
    print(f'1. fee inversion exact:            {total - bad}/{total}  (mismatches: {bad})')
    failed += bool(bad)

    mismatch, worst = check_credit_matches_charge()
    print(f'2. net charged == net credited:    20000 buys, mismatches {mismatch}, worst gap {worst} wei')
    failed += bool(mismatch)

    rel, op = check_invariant_bound()
    print(f'3. |Δk|/k per operation:           {rel:.3e}  (worst op: {op})')
    failed += rel > 1e-18

    for tax in (0, 700):
        best, total = check_round_trip(tax)
        tag = 'no fee ' if tax == 0 else 'with 7%'
        print(f'4. round-trip profit {tag}:        best {best} wei of stock, sum {total} wei')
        failed += best > 10

    ok, note = check_graduation_edge()
    print(f'5. graduation lands on minReserve: {ok}  ({note})')
    failed += not ok

    ok, note = check_sell_never_overdraws()
    print(f'6. sells stay inside the reserve:  {ok}  ({note})')
    failed += not ok

    print('\nOK: no Balancer- or Bunni-shaped rounding drain found in the curve' if not failed
          else f'\n{failed} check(s) failed')
