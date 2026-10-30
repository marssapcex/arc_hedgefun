import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import { qualifiedName } from "../wrappers/tests-utils";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const w1 = accounts.get("wallet_1")!;
const w2 = accounts.get("wallet_2")!;
const w3 = accounts.get("wallet_3")!;
const w4 = accounts.get("wallet_4")!;
const w5 = accounts.get("wallet_5")!;
const attacker = accounts.get("wallet_8")!;

const M = 1_000_000;

const SWEEPER = `(define-public (sweep (ids (list 200 uint)))
  (ok (map sweep-one ids))
)
(define-private (sweep-one (id uint))
  (unwrap-panic (contract-call? 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.fomo retrieve-loser id))
)`;

const ststx = (o: string): bigint =>
  BigInt((simnet.callReadOnlyFn("ststx-token", "get-balance", [Cl.principal(o)], deployer).result as any).value.value);
const u = (r: any): bigint => BigInt(r.value);

function deposit(who: string, stx: number) {
  return simnet.callPublicFn(
    "stacking-dao-core-v6",
    "deposit",
    [
      Cl.principal(qualifiedName("reserve-v1")),
      Cl.principal(qualifiedName("commission-v2")),
      Cl.principal(qualifiedName("staking-v1")),
      Cl.principal(qualifiedName("direct-helpers-v4")),
      Cl.uint(stx * M),
      Cl.none(),
      Cl.none(),
    ],
    who,
  ).result;
}

const buy = (who: string) => simnet.callPublicFn("fomo", "buy-claim", [], who).result;

describe("FOMO: scale, atomicity and the phantom prize", () => {
  it("N=5, no phantom prize: one tx via a helper contract takes the whole pot", () => {
    expect(simnet.callPublicFn("fomo", "start-game", [], deployer).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn("fomo", "set-total-treasure", [Cl.uint(0)], deployer).result).toBeOk(Cl.bool(true));

    for (const w of [w1, w2, w3, w4, w5]) expect(deposit(w, 10)).toBeOk(Cl.uint(10 * M));
    let paidIn = 0n;
    for (const w of [w1, w2, w3, w4, w5]) {
      const cost = u(simnet.callReadOnlyFn("fomo", "get-claim-cost", [], deployer).result) + 100_000n;
      expect(buy(w)).toBeOk(Cl.bool(true));
      paidIn += cost;
    }

    simnet.mineEmptyBurnBlocks(200);
    expect(ststx(attacker)).toBe(0n);
    expect(ststx(qualifiedName("fomo"))).toBe(paidIn);

    simnet.deployContract("sweeper", SWEEPER, { clarityVersion: 2 }, deployer);

    // a single transaction: ids 0..4, none of them owned by the attacker
    const r = simnet.callPublicFn(
      "sweeper",
      "sweep",
      [Cl.list([0, 1, 2, 3, 4].map((i) => Cl.uint(i)))],
      attacker,
    ).result;
    console.log("sweep result    ", JSON.stringify(r));
    expect((r as any).type).toBe(7); // ResponseOk

    const got = ststx(attacker);
    const left = ststx(qualifiedName("fomo"));
    console.log("paid in         ", paidIn.toString());
    console.log("attacker got    ", got.toString(), "(one tx, no claim, no capital)");
    console.log("left in contract", left.toString());
    console.log("winner prize    ", ((paidIn * 7000n) / 10000n).toString());

    expect(got).toBe(paidIn * 5n * 2500n / 10000n / 4n); // N/(N-1) * 25%
    expect(got * 10000n).toBeGreaterThan(paidIn * 2500n); // more than the whole 25% pool
    expect(left).toBeLessThan((paidIn * 7000n) / 10000n); // winner can no longer be paid
    expect(simnet.callPublicFn("fomo", "retrieve-winner", [Cl.uint(4)], w5).result).toBeErr(Cl.uint(1));
  });

  it("with the shipped 100 stSTX phantom prize, the same sweep reverts until the pot is big", () => {
    expect(simnet.callPublicFn("fomo", "start-game", [], deployer).result).toBeOk(Cl.bool(true));
    // total-treasure keeps its shipped default of 100 stSTX, which nothing backs
    for (const w of [w1, w2, w3]) expect(deposit(w, 10)).toBeOk(Cl.uint(10 * M));
    for (const w of [w1, w2, w3]) expect(buy(w)).toBeOk(Cl.bool(true));

    simnet.mineEmptyBurnBlocks(200);

    const treasure = u(simnet.callReadOnlyFn("fomo", "get-total-treasure", [], deployer).result);
    const real = ststx(qualifiedName("fomo"));
    console.log("treasure (book)", treasure.toString(), "real balance", real.toString());

    const r = simnet.callPublicFn("fomo", "retrieve-loser", [Cl.uint(0)], attacker).result;
    console.log("retrieve-loser ", JSON.stringify(r));
    expect(r).toBeErr(Cl.uint(1)); // ft-transfer? : not enough stSTX
    expect(ststx(attacker)).toBe(0n);
  });
});
