# On-chain probe — read-only RPC results

Generated `2026-11-04T10:29:21Z` · no keys, no tx, no fork. Only `eth_call`, `eth_getBalance`, `eth_getCode`, `eth_getStorageAt`.

| Chain | RPC | Block |
|---|---|---|
| aurora | `https://mainnet.aurora.dev` | 223004467 |
| avalanche | `https://avalanche-c-chain-rpc.publicnode.com` | 99394985 |
| ethereum | `https://ethereum-rpc.publicnode.com` | 26340855 |
| fantom | `https://fantom.drpc.org` | 123949535 |
| flare | `https://flare-api.flare.network/ext/C/rpc` | 73719046 |
| linea | `https://rpc.linea.build` | 32515078 |
| monad | `https://rpc.monad.xyz` | 119303041 |
| moonriver | `https://moonriver.drpc.org` | 17381654 |

## Decoded storage

| Chain | Target | code bytes | native (ETH-equivalent) | owner / admin / timelock | quorum / threshold | other |
|---|---|---|---|---|---|---|
| ethereum | Hop L1 bridge ETH | 38748 | 0.0000 | - | - | - |
| ethereum | PEAKDEFI governor | 25180 | 0.0000 | timelock()=0x5a88bcfe2ab1a5cf720438cf605314e8ed2380d3 | quorumVotes()=4000000000000000; proposalThreshold()=1000000000000000; votingDelay()=1; votingPeriod()=40320 | guardian()=0xbdbdfafb975b35a41fa228585c8700d31cce73c9 |
| ethereum | Reflexer gov (eip155 id) | 28566 | 0.0000 | admin()=0xa57a4e6170930ac547c147cdf26ae4682fa8262e; timelock()=0x2cde6a1147b0ee61726b86d83fd548401b1162c7 | quorumVotes()=20000000000000000000000; proposalThreshold()=3000000000000000000000; votingDelay()=6600; votingPeriod()=46500 | - |
| ethereum | Flux Finance governor | 2132 | 0.0000 | admin()=0x2c5898da4df1d45eab2b7b192a361c3b9eb18d9c; timelock()=0x2c5898da4df1d45eab2b7b192a361c3b9eb18d9c | quorumVotes()=1000000000000000000000000; proposalThreshold()=100000000000000000000000000; votingDelay()=1; votingPeriod()=21600 | implementation()=0x8886344a1b9b840bed590f2ef7379dd37e169c8e |
| ethereum | BIFI token | 8662 | 0.0000 | owner()=0xa76540d1180b22db0b760c34336843506f9828ab | - | symbol()=BiFi; totalSupply()=1000000000000000000000000000 |
| ethereum | Hop governor (DefiLlama compound id) | 39588 | 0.0000 | timelock()=0xeea8422a08258e73c139fc32a25e10410c14bd7a | quorumNumerator()=600; proposalThreshold()=1000000000000000000000000; votingDelay()=1; votingPeriod()=45818 | token()=0xc5102fe9359fd9a28f877a67e36b0f050d81a3cc |
| ethereum | Easedefi governor | 1576 | 0.0000 | admin()=0xea5edef1401e8c312c797c27a9842e03eb0e557a; timelock()=0xea5edef1401e8c312c797c27a9842e03eb0e557a | quorumVotes()=50000000000000000000000000; proposalThreshold()=100000000000000000000000; votingDelay()=1; votingPeriod()=17280 | implementation()=0xd135c44ca6b6722633ab97d15a5222fe38546ecc |
| ethereum | Angle governor (compound id) | 5348 | 0.0000 | timelock()=0x5183f032bf42109cd370b9559fd22207e432301e | proposalThreshold()=2500000000000000000000000; votingDelay()=545; votingPeriod()=19636 | token()=0x31429d1856ad1377a8a0079410b297e1a9e214c2; implementation(EIP1967)=0x3e399ae5b4d8bc0021e53b51c8bcdd66dd62c03b |
| ethereum | Hop L1 bridge USDC | 38600 | 0.0000 | - | - | - |
| ethereum | Hop HOP token | 38294 | 0.0000 | owner()=0xeea8422a08258e73c139fc32a25e10410c14bd7a | - | symbol()=HOP; totalSupply()=1000000000000000000000000000 |
| ethereum | Unslashed governor | 42300 | 0.0000 | timelock()=0x1417fa839f4d03e59dbda9e60165a752d41b2045 | quorumVotes()=400000000000000000000000; proposalThreshold()=100000000000000000000000; votingDelay()=1; votingPeriod()=17280 | guardian()=0x3fdba971a35e238cea1602f50824e296bad85980 |
| ethereum | RGT token | 4524 | 0.0000 | - | - | symbol()=RGT; totalSupply()=12485047994434931506885000; implementation(EIP1967)=0xb528e8bb2dcb99cfdea4c28bf44925ef58ab1520 |
| ethereum | ANGLE token | 20246 | 0.0000 | - | - | symbol()=ANGLE; totalSupply()=1000000000000000000000000000 |
| ethereum | Rari governor #1 | 2132 | 0.0000 | admin()=0x8ace03fc45139fddba944c6a4082b604041d19fc; timelock()=0x8ace03fc45139fddba944c6a4082b604041d19fc | quorumVotes()=400000000000000000000000; proposalThreshold()=65000000000000000000000; votingDelay()=13140; votingPeriod()=19710 | implementation()=0xfd6aca12f464acda7901fcd650dd1bc272da039f |
| ethereum | BiFi governor (eip155 id) | 24700 | 0.0000 | owner()=0xfbb3544329679a7cc1f7644bae1b65d36bf5ce63; timelock()=0xe75fe5f37bd2e2613b1473f27644cf983555ffdf | quorumNumerator()=60; proposalThreshold()=800000000000000000000000; votingDelay()=6545; votingPeriod()=19635 | token()=0x22f68ae048b126ad76cd5dbc2c671603a188d6dc |
| ethereum | Hop L1 bridge USDT | 38748 | 0.0000 | - | - | - |
| ethereum | PEAK token | 12070 | 0.0000 | - | - | symbol()=PEAK; totalSupply()=117989532125407387; implementation(EIP1967)=0x6b68680c8025f4d8077b4b549ba86299cbc4497b |
| ethereum | Concentrator cvxCRV vault proxy | 4184 | 0.0000 | owner()=0xa0fb1b11cca5871fb0225b64308e249b97804e99 | - | symbol()=aCRV; totalSupply()=1108588725537536644509613; implementation(EIP1967)=0x9a68dea7dcddfc5c4c6b3cb8ab278bf2cd87d3d3 |
| ethereum | FLX token | 30024 | 0.0000 | - | - | symbol()=FLX; totalSupply()=957122296129311554103553 |
| ethereum | Concentrator multisig | 344 | 0.0661 | - | - | - |
| ethereum | CTR token | 6826 | 0.0000 | admin()=0xa0fb1b11cca5871fb0225b64308e249b97804e99 | - | symbol()=CTR; totalSupply()=5000000000000000000000000 |
| ethereum | Rari governor #2 | 36240 | 0.0000 | timelock()=0x8ace03fc45139fddba944c6a4082b604041d19fc | quorumVotes()=25000000000000000000000000; proposalThreshold()=2500000000000000000000000; votingDelay()=1; votingPeriod()=13000 | token()=0xc7283b66eb1eb5fb86327f08e1b5816b0720212b |
| ethereum | Concentrator ProxyAdmin | 4344 | 0.0000 | owner()=0xa0fb1b11cca5871fb0225b64308e249b97804e99 | - | - |
| ethereum | Hop L1 bridge DAI | 38748 | 0.1000 | - | - | - |
| fantom | Tarot | 26742 | 0.0000 | owner()=0x5b0390bccca1f040d8993eb6e4ce8ded93721765 | - | token()=0xb7c2ddb1ebac1056231ef22c1b0a13988537a274; symbol()=TAROT; totalSupply()=392007888311763397303889 |
| linea | Mendi timelock proposer | 344 | 0.0100 | - | - | - |
| linea | Mendi Finance | 4284 | 0.0000 | - | - | symbol()=MENDI; totalSupply()=100000000000000000000000000 |
| ethereum | veCTR | 19528 | 0.0000 | admin()=0xa0fb1b11cca5871fb0225b64308e249b97804e99 | - | token()=0xb3ad645db386d7f6d753b2b9c3f4b853da6890b8; symbol()=veCTR; totalSupply()=1977265873586352346583630 |
| monad | Neverland | 4456 | 0.0000 | owner()=0xe72df2dde84880dd706c5976e92ed34bb586a38f | - | symbol()=DUST; totalSupply()=96356398000000000000000000; implementation(EIP1967)=0xf59df2e38e23406c80ac778ccaa4319babe0d0d3 |
| avalanche | Yield Yak | 9118 | 0.0000 | - | - | symbol()=YAK; totalSupply()=10000000000000000000000 |
| aurora | Trisolaris | 17114 | 0.0000 | - | - | symbol()=TRI; totalSupply()=589631098246133682032458625 |
| moonriver | Moonwell Apollo | 16374 | 0.0000 | - | - | symbol()=MFAM; totalSupply()=1000000000000000000000000000 |
| aurora | Aurigami | 10326 | 0.0000 | admin()=0x4444588443c3a91288c5002483449aba1054192b | - | symbol()=PLY; totalSupply()=8191936610888403263280116221 |
| flare | Kinetic Unitroller (from source) | 3018 | 1000.0000 | admin()=0x81274d9250c8a36c62d3f45f18bd34d44d433b45 | - | oracle()=0xc1d7029c970d9b683da9d37b49d84d081dbed54c |
| flare | Kinetic | 4456 | 0.0000 | - | - | symbol()=JOULE; totalSupply()=1500000000000000000000000000; implementation(EIP1967)=0xee15da0edb70fc6d98d03651f949fccc2c4e1e80 |

## Real token balances sitting in probed contracts

| Chain | Target | Token balances |
|---|---|---|
| ethereum | Hop L1 bridge ETH | USDT 266028.923335 |
| ethereum | BIFI token | USDT 20049.581238 |
| ethereum | Hop L1 bridge USDC | USDC 535309.328085 |
| ethereum | Hop HOP token | HOP 8169322.578813 |
| ethereum | RGT token | USDT 2469.844105 |
| ethereum | ANGLE token | USDT 496.91009, ANGLE 24391.2 |
| ethereum | Concentrator multisig | USDC 8621.064977, USDT 340.396908, WETH 0.005616, CRV 2168.357236, CVX 1017.041732 |
| ethereum | Hop L1 bridge DAI | DAI 293358.672823 |

## Limits

- Public RPCs are third-party and may be stale/rate-limited; re-run with `--rpc` against your own node.
- `eth_call` returns current state only. It does NOT prove a drain, a passed proposal, or that a setter is reachable by a token vote.
- A revert is recorded as *method absent*, not as a security control.
- No proxy implementation bytecode was decompiled; EIP-1967 slots are reported as-is.
