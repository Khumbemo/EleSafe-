"""PIN hashing (PBKDF2-HMAC-SHA256) and session tokens."""

from __future__ import annotations

import hashlib
import hmac
import secrets

SERVER_ITERATIONS = 200_000


def _pbkdf2(pin: bytes, salt: bytes, iterations: int) -> bytes:
    if hasattr(hashlib, "pbkdf2_hmac"):
        return hashlib.pbkdf2_hmac("sha256", pin, salt, iterations)
    # Pyodide builds hashlib without OpenSSL; this is RFC 8018 with one block.
    mac = hmac.new(pin, digestmod=hashlib.sha256)

    def prf(data: bytes) -> bytes:
        m = mac.copy()
        m.update(data)
        return m.digest()

    u = prf(salt + b"\x00\x00\x00\x01")
    out = int.from_bytes(u, "big")
    for _ in range(iterations - 1):
        u = prf(u)
        out ^= int.from_bytes(u, "big")
    return out.to_bytes(32, "big")


def hash_pin(pin: str, iterations: int = SERVER_ITERATIONS) -> str:
    salt = secrets.token_bytes(16)
    digest = _pbkdf2(pin.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        algo, iterations, salt, digest = stored.split("$")
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    actual = _pbkdf2(pin.encode(), bytes.fromhex(salt), int(iterations))
    return hmac.compare_digest(actual.hex(), digest)


def new_token() -> str:
    return secrets.token_urlsafe(24)
