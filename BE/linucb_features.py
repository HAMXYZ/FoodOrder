"""Fixed, versioned dish/history encoding. No DB queries, rewards or user IDs."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable

from linucb import DecisionContext, LinUCBError, canonical_json, finite_number


# Observed development category IDs. Freeze the vocabulary in each checkpoint;
# new categories use the reserved bucket until an explicit schema/model migration.
DEFAULT_CATEGORY_IDS = (1, 2, 3, 4, 5, 6)
NUMERIC_NAMES = ("price", "calories", "spiciness", "vegetarian")


@dataclass(frozen=True)
class FeatureSchema:
    category_ids: tuple[int, ...] = DEFAULT_CATEGORY_IDS
    price_cap: float = 200_000.0
    calories_cap: float = 1_000.0
    spiciness_max: float = 3.0
    version: int = 1

    def __post_init__(self):
        if type(self.version) is not int or self.version != 1:
            raise LinUCBError("Unsupported feature version")
        try:
            ids = tuple(self.category_ids)
        except TypeError as error:
            raise LinUCBError("Invalid category vocabulary") from error
        if (len(ids) > 240 or any(type(i) is not int or i <= 0 for i in ids) or len(set(ids)) != len(ids)):
            raise LinUCBError("Category IDs must be distinct positive integers")
        object.__setattr__(self, "category_ids", ids)
        for name in ("price_cap", "calories_cap", "spiciness_max"):
            cap = finite_number(getattr(self, name), name)
            if cap <= 0:
                raise LinUCBError("Feature caps must be positive")
            object.__setattr__(self, name, cap)

    @property
    def names(self) -> tuple[str, ...]:
        categories = tuple(str(i) for i in self.category_ids) + ("unknown",)
        return (("bias",) + tuple(f"category:{i}" for i in categories)
                + tuple(f"dish:{n}" for n in NUMERIC_NAMES)
                + tuple(f"missing:{n}" for n in NUMERIC_NAMES)
                + tuple(f"affinity:{i}" for i in categories)
                + tuple(f"similarity:{n}" for n in NUMERIC_NAMES) + ("history_present",))

    @property
    def dimension(self) -> int:
        return len(self.names)

    def to_dict(self) -> dict:
        return {"version": self.version, "category_ids": list(self.category_ids), "price_cap": self.price_cap,
                "calories_cap": self.calories_cap, "spiciness_max": self.spiciness_max}

    @property
    def fingerprint(self) -> str:
        return "foodorder-context-v1:" + hashlib.sha256(canonical_json(
            {"schema": self.to_dict(), "ordered_features": self.names})).hexdigest()

    @classmethod
    def from_dict(cls, data: dict) -> FeatureSchema:
        if not isinstance(data, dict) or set(data) != {"version", "category_ids", "price_cap", "calories_cap", "spiciness_max"}:
            raise LinUCBError("Invalid feature schema fields")
        return cls(**data)


@dataclass(frozen=True)
class DishFeatures:
    dish_id: str
    category_id: int | None
    base_price: float | Decimal | None
    calories: float | None
    spiciness_level: int | None
    is_vegetarian: bool | None
    is_available: bool | None = None

    def __post_init__(self):
        if not isinstance(self.dish_id, str) or not self.dish_id.strip() or len(self.dish_id) > 256:
            raise LinUCBError("Invalid dish_id")
        if self.is_available is not None and type(self.is_available) is not bool:
            raise LinUCBError("is_available must be a bool or missing")

    @classmethod
    def from_model(cls, dish) -> DishFeatures:
        """Copy scalar fields from an already-loaded models.Dish, no lazy reads."""
        return cls(str(dish.id), dish.category_id, dish.base_price, dish.calories,
                   dish.spiciness_level, dish.is_vegetarian, dish.is_available)


@dataclass(frozen=True)
class HistoryProfile:
    """Unweighted history summary, not a reward or inferred ground-truth preference."""

    schema_id: str
    category_frequencies: tuple[float, ...]
    numeric_means: tuple[float | None, ...]
    observation_count: int

    def __post_init__(self):
        # Copy caller-owned sequences so later list mutation cannot alter a profile.
        try:
            object.__setattr__(self, "category_frequencies", tuple(self.category_frequencies))
            object.__setattr__(self, "numeric_means", tuple(self.numeric_means))
        except TypeError as error:
            raise LinUCBError("Invalid history profile") from error


class FeatureEncoder:
    def __init__(self, schema: FeatureSchema | None = None):
        self._schema = schema if schema is not None else FeatureSchema()
        if not isinstance(self._schema, FeatureSchema):
            raise LinUCBError("Expected FeatureSchema")

    @property
    def schema(self) -> FeatureSchema:
        return self._schema

    def _category(self, dish: DishFeatures) -> int:
        category = dish.category_id
        if category is not None and (type(category) is not int or category <= 0):
            raise LinUCBError("Invalid category_id")
        try:
            return self.schema.category_ids.index(category)
        except ValueError:
            return len(self.schema.category_ids)

    def _numeric(self, dish: DishFeatures) -> tuple[float | None, ...]:
        values = []
        for name, cap in (("base_price", self.schema.price_cap), ("calories", self.schema.calories_cap)):
            raw = getattr(dish, name)
            if raw is None:
                values.append(None)
                continue
            # Numeric columns may return Decimal; never coerce strings/bools.
            try:
                value = finite_number(float(raw) if isinstance(raw, Decimal) else raw, name)
            except (ValueError, OverflowError) as error:
                raise LinUCBError(f"Invalid {name}") from error
            if value < 0:
                raise LinUCBError(f"{name} must be nonnegative")
            values.append(min(value / cap, 1.0))
        spicy, vegetarian = dish.spiciness_level, dish.is_vegetarian
        if spicy is not None and (type(spicy) is not int or not 0 <= spicy <= self.schema.spiciness_max):
            raise LinUCBError("Invalid spiciness_level")
        if vegetarian is not None and type(vegetarian) is not bool:
            raise LinUCBError("is_vegetarian must be a bool or missing")
        values.extend((None if spicy is None else spicy / self.schema.spiciness_max,
                       None if vegetarian is None else float(vegetarian)))
        return tuple(values)

    def _validate_profile(self, profile: HistoryProfile) -> None:
        if not isinstance(profile, HistoryProfile) or profile.schema_id != self.schema.fingerprint:
            raise LinUCBError("History feature schema mismatch")
        if type(profile.observation_count) is not int or profile.observation_count < 0:
            raise LinUCBError("Invalid history observation count")
        if len(profile.category_frequencies) != len(self.schema.category_ids) + 1 or len(profile.numeric_means) != 4:
            raise LinUCBError("Invalid history dimension")
        frequencies = tuple(finite_number(v, "history category frequency") for v in profile.category_frequencies)
        if any(not 0 <= v <= 1 for v in frequencies):
            raise LinUCBError("Invalid history frequencies")
        expected_sum = 1.0 if profile.observation_count else 0.0
        if abs(sum(frequencies) - expected_sum) > 1e-10:
            raise LinUCBError("History frequencies must sum to one, or zero for empty history")
        for value in profile.numeric_means:
            if value is not None and not 0 <= finite_number(value, "history mean") <= 1:
                raise LinUCBError("History mean must be normalized")
        if not profile.observation_count and any(v is not None for v in profile.numeric_means):
            raise LinUCBError("Empty history cannot have numeric means")

    def profile(self, observations: Iterable[DishFeatures] = ()) -> HistoryProfile:
        """Summarize caller-supplied past dish snapshots, without event weights.

        Future history readers must scope observations to the JWT owner and cutoff
        before calling this method. This module never loads interactions itself.
        """
        counts = [0] * (len(self.schema.category_ids) + 1)
        sums, numeric_counts = [0.0] * 4, [0] * 4
        total = 0
        for dish in observations:
            if not isinstance(dish, DishFeatures):
                raise LinUCBError("History observations must be DishFeatures")
            counts[self._category(dish)] += 1
            for i, value in enumerate(self._numeric(dish)):
                if value is not None:
                    sums[i] += value
                    numeric_counts[i] += 1
            total += 1
        return HistoryProfile(self.schema.fingerprint, tuple(c / total if total else 0.0 for c in counts),
                              tuple(s / n if n else None for s, n in zip(sums, numeric_counts)), total)

    def encode(self, dish: DishFeatures, profile: HistoryProfile | None = None) -> DecisionContext:
        if not isinstance(dish, DishFeatures):
            raise LinUCBError("Expected DishFeatures")
        profile = profile if profile is not None else self.profile()
        self._validate_profile(profile)
        category, numbers = self._category(dish), self._numeric(dish)
        one_hot = tuple(float(i == category) for i in range(len(self.schema.category_ids) + 1))
        values = ((1.0,) + one_hot + tuple(0.0 if n is None else n for n in numbers)
                  + tuple(float(n is None) for n in numbers)
                  + tuple(v * f for v, f in zip(one_hot, profile.category_frequencies))
                  + tuple(0.0 if n is None or mean is None else 1.0 - abs(n - mean)
                          for n, mean in zip(numbers, profile.numeric_means))
                  + (float(profile.observation_count > 0),))
        return DecisionContext(dish.dish_id, self.schema.fingerprint, values)
