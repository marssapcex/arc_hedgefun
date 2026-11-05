"""Keccak-256 (Ethereum), pure stdlib.

Ethereum uses Keccak-256 with padding domain 0x01, NOT NIST SHA3-256
(domain 0x06). hashlib.sha3_256 therefore gives different selectors. This
module exists so selector derivation works on a bare CI runner with no
pycryptodome / eth-hash / web3 installed.

Verified vectors:
  keccak256(b"") = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
  keccak256(b"transfer(address,uint256)")[:4] = a9059cbb
  keccak256(b"approve(address,uint256)")[:4] = 095ea7b3
"""
MASK = (1 << 64) - 1

RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]

# r[x][y], flattened as r[x + 5*y]
ROT = [
    0, 1, 62, 28, 27,
    36, 44, 6, 55, 20,
    3, 10, 43, 25, 39,
    41, 45, 15, 21, 8,
    18, 2, 61, 56, 14,
]

RATE = 136  # 1088 bits


def _rol(v, n):
    n %= 64
    return ((v << n) | (v >> (64 - n))) & MASK if n else v


def _f(state):
    for rnd in range(24):
        # theta
        c = [state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4]
             for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                state[x][y] ^= d[x]
        # rho + pi
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(state[x][y], ROT[x + 5 * y])
        # chi
        for x in range(5):
            for y in range(5):
                state[x][y] = (b[x][y] ^ ((~b[(x + 1) % 5][y]) & MASK)
                               & b[(x + 2) % 5][y]) & MASK
        # iota
        state[0][0] ^= RC[rnd]
    return state


def keccak256(data: bytes) -> bytes:
    """Return the 32-byte Keccak-256 digest."""
    if isinstance(data, str):
        data = data.encode()
    # Keccak padding: 0x01 ... 0x80 (last byte of the final rate block)
    padded = bytearray(data)
    padded.append(0x01)
    while len(padded) % RATE != 0:
        padded.append(0x00)
    padded[-1] |= 0x80

    state = [[0] * 5 for _ in range(5)]
    for off in range(0, len(padded), RATE):
        block = padded[off:off + RATE]
        for i in range(RATE // 8):
            lane = int.from_bytes(block[8 * i:8 * i + 8], "little")
            state[i % 5][i // 5] ^= lane
        _f(state)

    out = bytearray()
    for i in range(4):  # 4 lanes = 32 bytes
        out += state[i % 5][i // 5].to_bytes(8, "little")
    return bytes(out[:32])


def selector(signature: str) -> str:
    """4-byte function selector as 0x-prefixed hex."""
    return "0x" + keccak256(signature)[:4].hex()


def code_hash(runtime_bytecode: str) -> str:
    """keccak256 of deployed runtime bytecode (EVM code hash without 0x prefix issue)."""
    raw = runtime_bytecode[2:] if runtime_bytecode.startswith("0x") else runtime_bytecode
    return "0x" + keccak256(bytes.fromhex(raw)).hex()
