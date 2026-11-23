import math


def quadratic(a, b, c):
    """Roots of ax^2 + bx + c (e2e fixture)."""
    d = math.sqrt(b * b - 4 * a * c)
    return (-b + d) / (2 * a), (-b - d) / (2 * a)
