"""Offline unit tests for both tools. Run: python3 -m unittest discover -s tests -v"""
import json
import os
import tempfile
import unittest

from bugchain import indexer, scanner
from bugchain.cli import _make_fixture
from bugchain.keccak import code_hash, keccak256, selector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "bugchain/data/incident_db.json")
SIG = os.path.join(ROOT, "bugchain/data/incident_signatures.json")


class TestKeccak(unittest.TestCase):
    def test_empty_vector(self):
        self.assertEqual(
            keccak256(b"").hex(),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")

    def test_erc20_selectors(self):
        self.assertEqual(selector("transfer(address,uint256)"), "0xa9059cbb")
        self.assertEqual(selector("approve(address,uint256)"), "0x095ea7b3")
        self.assertEqual(selector("balanceOf(address)"), "0x70a08231")
        self.assertEqual(selector("transferFrom(address,address,uint256)"), "0x23b872dd")

    def test_not_sha3(self):
        import hashlib
        self.assertNotEqual(keccak256(b"abc"), hashlib.sha3_256(b"abc").digest())

    def test_code_hash_stable(self):
        self.assertEqual(code_hash("0x6000"), code_hash("6000"))


class TestSelectorExtraction(unittest.TestCase):
    def test_push4(self):
        code = "0x63a9059cbb8063095ea7b380600052"
        self.assertEqual(indexer.extract_selectors(code),
                         ["0x095ea7b3", "0xa9059cbb"])

    def test_zero_and_ff_filtered(self):
        code = "0x63000000008063ffffffff80"
        self.assertEqual(indexer.extract_selectors(code), [])

    def test_window_limit(self):
        code = "0x" + "00" * 3000 + "63a9059cbb80"
        self.assertEqual(indexer.extract_selectors(code), [])


class TestIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (os.path.exists(DB) and os.path.exists(SIG)):
            raise unittest.SkipTest("run build-db first")
        cls.db = scanner.load(DB)
        cls.sig = scanner.load(SIG)

    def test_database_shape(self):
        self.assertEqual(self.db["meta"]["incidentCount"], 821)
        self.assertGreater(self.db["meta"]["withMetadataTable"], 700)
        self.assertGreater(len(self.sig["selectors"]), 1000)
        self.assertGreater(len(self.sig["knownAddresses"]), 300)

    def test_end_to_end_offline(self):
        with tempfile.TemporaryDirectory() as td:
            fx = os.path.join(td, "fx.json")
            co = os.path.join(td, "co.json")
            json.dump(_make_fixture(self.db, self.sig), open(fx, "w"))
            doc = indexer.run(fixture=fx, out=co)
            self.assertEqual(doc["meta"]["contractCount"], 3)
            self.assertGreaterEqual(len(doc["clusters"]), 1)
            res = scanner.scan(self.sig, self.db, doc)
            self.assertEqual(res["summary"]["newContractsScanned"], 3)
            self.assertGreater(res["summary"]["genericSelectorsDropped"], 0)
            self.assertIn("KNOWN_ACTOR", res["summary"]["verdictCounts"])
            self.assertTrue(all(f["verdict"] in ("INFO", "REVIEW", "KNOWN_ACTOR")
                                for f in res["findings"]))

    def test_generic_filter_removes_erc20_noise(self):
        """A plain ERC20 must not be flagged just for having transfer/approve."""
        plain = {
            "meta": {"mode": "fixture", "fromBlock": 1, "toBlock": 1},
            "clusters": [], "errors": [],
            "contracts": [{
                "block": 1, "txHash": None, "creator": "0x" + "44" * 20,
                "address": "0x" + "55" * 20, "codeBytes": 20,
                "codeHash": "0xabc", "codeSource": "test",
                "candidateSelectors": ["0xa9059cbb", "0x095ea7b3", "0x70a08231"],
            }],
        }
        res = scanner.scan(self.sig, self.db, plain)
        f = res["findings"][0]
        # transfer/approve/balanceOf are generic, so no selector-driven REVIEW
        self.assertEqual(f["selectorHits"], [])
        self.assertEqual(f["verdict"], "INFO")


if __name__ == "__main__":
    unittest.main()
