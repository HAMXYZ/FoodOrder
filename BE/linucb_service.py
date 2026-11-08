"""Internal interface for future US9.1/US9.5, not a public reward/training API."""

from pathlib import Path
from typing import Iterable

from linucb import LinUCBError, ScoredArm, SharedLinUCB, load_checkpoint, save_checkpoint
from linucb_features import DishFeatures, FeatureEncoder, FeatureSchema, HistoryProfile


class LinUCBRanker:
    def __init__(self, schema: FeatureSchema | None = None, *, alpha: float = 1.0,
                 regularization: float = 1.0, purpose: str = "serving"):
        self._encoder = FeatureEncoder(schema)
        self._model = SharedLinUCB(self.schema.dimension, self.schema.fingerprint, alpha=alpha,
                                  regularization=regularization, purpose=purpose)

    @property
    def schema(self) -> FeatureSchema:
        return self._encoder.schema

    @property
    def encoder(self) -> FeatureEncoder:
        return self._encoder

    @property
    def model(self) -> SharedLinUCB:
        return self._model

    def rank(self, candidates: Iterable[DishFeatures], *, profile: HistoryProfile | None = None,
             top_k: int | None = None) -> list[ScoredArm]:
        contexts, seen = [], set()
        for dish in candidates:
            if not isinstance(dish, DishFeatures):
                raise LinUCBError("Candidates must be DishFeatures")
            if dish.dish_id in seen:
                raise LinUCBError("Duplicate candidate dish")
            seen.add(dish.dish_id)
            # Minimal safety guard only. US9.4 still owns full candidate policy.
            if dish.is_available is not True:
                continue
            contexts.append(self.encoder.encode(dish, profile))
        return self.model.rank(contexts, top_k=top_k)

    def update_simulation(self, decision: ScoredArm, *, reward: float) -> None:
        if not isinstance(decision, ScoredArm):
            raise LinUCBError("Use a scored decision with its original context snapshot")
        self.model.update(decision.context, reward)

    def save(self, path: str | Path, *, overwrite: bool = False) -> None:
        save_checkpoint(path, {"bundle_version": 1, "features": self.schema.to_dict(),
                               "model": self.model.to_state()}, overwrite=overwrite)

    @classmethod
    def load(cls, path: str | Path, *, expected_schema: FeatureSchema,
             expected_purpose: str) -> "LinUCBRanker":
        state = load_checkpoint(path)
        if (set(state) != {"bundle_version", "features", "model"} or type(state["bundle_version"]) is not int
                or state["bundle_version"] != 1):
            raise LinUCBError("Unsupported ranker bundle")
        schema = FeatureSchema.from_dict(state["features"])
        if schema.fingerprint != expected_schema.fingerprint:
            raise LinUCBError("Checkpoint encoder differs from expected feature schema")
        model = SharedLinUCB.from_state(state["model"], expected_dimension=schema.dimension,
                                       expected_schema_id=schema.fingerprint, expected_purpose=expected_purpose)
        ranker = cls(schema, alpha=model.alpha, regularization=model.regularization, purpose=model.purpose)
        ranker._model = model
        return ranker
