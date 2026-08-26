"""Money helpers. Store everything in integer cents to avoid float precision bugs."""
from decimal import Decimal, ROUND_HALF_UP


def reais_to_cents(value: float | int | str | Decimal) -> int:
    """Convert a value in reais (e.g. 12.50) to integer cents (1250)."""
    d = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(d * 100)


def cents_to_reais(cents: int) -> float:
    """Convert integer cents to reais as float (rounded to 2 decimals)."""
    return float(Decimal(cents) / Decimal(100))
