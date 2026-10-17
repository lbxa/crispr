# Python Immutability Patterns

Use these examples when writing or reviewing Python code that should avoid shared mutable state.

## Contents

- Prefer Frozen Domain Values
- Avoid Mutable Defaults and Aliases
- Copy Dictionaries Instead of Patching Them
- Publish Read-Only Snapshots
- Allow Local Builders
- Python Notes

## Prefer Frozen Domain Values

Bad: mutate a value that callers may still hold.

```python
from dataclasses import dataclass

@dataclass
class Cart:
    items: list[str]

def add_item(cart: Cart, item: str) -> Cart:
    cart.items.append(item)
    return cart
```

Good: store immutable collections and return a new value.

```python
from dataclasses import dataclass, replace

@dataclass(frozen=True, slots=True)
class Cart:
    items: tuple[str, ...] = ()

def add_item(cart: Cart, item: str) -> Cart:
    return replace(cart, items=cart.items + (item,))
```

## Avoid Mutable Defaults and Aliases

Bad: reuse one list across calls.

```python
def add_tag(tag: str, tags: list[str] = []) -> list[str]:
    tags.append(tag)
    return tags
```

Good: take an immutable default and return a new tuple.

```python
from collections.abc import Iterable

def add_tag(tag: str, tags: Iterable[str] = ()) -> tuple[str, ...]:
    return (*tags, tag)
```

## Copy Dictionaries Instead of Patching Them

Bad: callers observe the input changing.

```python
def apply_discount(order: dict[str, object], percent: float) -> dict[str, object]:
    order["total"] = float(order["total"]) * (1 - percent)
    order["discount_applied"] = True
    return order
```

Good: copy the changed path and leave the original alone.

```python
from typing import Any

def apply_discount(order: dict[str, Any], percent: float) -> dict[str, Any]:
    return {
        **order,
        "total": float(order["total"]) * (1 - percent),
        "discount_applied": True,
    }
```

## Publish Read-Only Snapshots

Bad: mutate a shared config dictionary in place.

```python
CONFIG: dict[str, str] = {"region": "us-east-1", "mode": "live"}

def set_mode(mode: str) -> None:
    CONFIG["mode"] = mode
```

Good: publish a complete read-only snapshot.

```python
from threading import Lock
from types import MappingProxyType
from typing import Mapping

_lock = Lock()
_config: Mapping[str, str] = MappingProxyType({"region": "us-east-1", "mode": "live"})

def get_config() -> Mapping[str, str]:
    return _config

def set_mode(mode: str) -> None:
    global _config
    with _lock:
        _config = MappingProxyType({**_config, "mode": mode})
```

## Allow Local Builders

This is fine because the list is not shared until converted to a tuple.

```python
def normalized_names(raw_names: list[str]) -> tuple[str, ...]:
    normalized: list[str] = []
    for name in raw_names:
        stripped = name.strip()
        if stripped:
            normalized.append(stripped.casefold())
    return tuple(normalized)
```

## Python Notes

- Prefer `tuple`, `frozenset`, frozen dataclasses, `NamedTuple`, and `Mapping` views for public values.
- Use `field(default_factory=...)` only when a mutable collection is intentionally private and not exposed.
- Remember that `@dataclass(frozen=True)` is shallow: a frozen dataclass can still contain a mutable list unless the field type prevents it.
- Copy mutable constructor inputs before storing them, especially lists, dicts, and sets.
