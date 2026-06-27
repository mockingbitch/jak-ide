"""A tiny Python module. Try: `python3 python/app.py` in the terminal panel."""


def is_prime(n: int) -> bool:
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True


def primes_up_to(limit: int) -> list[int]:
    return [n for n in range(limit) if is_prime(n)]


if __name__ == "__main__":
    print(primes_up_to(30))
