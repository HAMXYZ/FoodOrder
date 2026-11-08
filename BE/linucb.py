"""US9.2: shared linear UCB mathematics, with no event/reward ingestion or DB IO.

Serving models are read-only. Explicit mathematical updates are available only
on simulation models until a separately reviewed production reward policy exists.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import stat
import tempfile
from dataclasses import dataclass
from numbers import Real
from pathlib import Path
from threading import RLock
from typing import Iterable

import numpy as np


MAX_DIMENSION = 512
MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024
STATE_VERSION = 1


class LinUCBError(ValueError):
    """Invalid configuration, context, checkpoint or non-finite arithmetic."""


def finite_number(value: object, name: str) -> float:
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real):
        raise LinUCBError(f"{name} must be a finite real number")
    try:
        result = float(value)
    except (OverflowError, ValueError) as error:
        raise LinUCBError(f"{name} must be a finite real number") from error
    if not math.isfinite(result):
        raise LinUCBError(f"{name} must be a finite real number")
    return result


def _identifier(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 256:
        raise LinUCBError(f"Invalid {name}")
    return value


def _array(value: object, shape: tuple[int, ...], name: str) -> np.ndarray:
    try:
        raw = np.asarray(value, dtype=object)
        if raw.shape != shape:
            raise LinUCBError(f"{name} must have shape {shape}")
        values = [finite_number(item, name) for item in raw.flat]
        return np.array(values, dtype=np.float64).reshape(shape)
    except (TypeError, ValueError, OverflowError) as error:
        raise LinUCBError(f"Invalid {name}") from error


@dataclass(frozen=True)
class DecisionContext:
    """Immutable feature snapshot; use this exact vector for a later update."""

    arm_id: str
    schema_id: str
    values: tuple[float, ...]

    def __post_init__(self):
        _identifier(self.arm_id, "arm_id")
        _identifier(self.schema_id, "schema_id")
        try:
            values = tuple(finite_number(v, "context") for v in self.values)
        except TypeError as error:
            raise LinUCBError("Context must be a one-dimensional vector") from error
        if not 1 <= len(values) <= MAX_DIMENSION:
            raise LinUCBError("Invalid context dimension")
        object.__setattr__(self, "values", values)


@dataclass(frozen=True)
class ScoredArm:
    context: DecisionContext
    exploitation: float
    uncertainty: float
    exploration: float
    score: float
    model_revision: int

    @property
    def arm_id(self) -> str:
        return self.context.arm_id


class SharedLinUCB:
    """One A/b shared by all dish arms; float64 Cholesky solves, never inverse.

    A starts at regularization * I, b at zero. Model revision counts explicit
    updates, not events. Replaying an update WILL learn again: event deduplication
    belongs to the future reward/US9.5 controller, not this mathematical primitive.
    """

    def __init__(self, dimension: int, schema_id: str, *, alpha: float = 1.0,
                 regularization: float = 1.0, purpose: str = "serving"):
        if type(dimension) is not int or not 1 <= dimension <= MAX_DIMENSION:
            raise LinUCBError("Invalid feature dimension")
        _identifier(schema_id, "schema_id")
        alpha = finite_number(alpha, "alpha")
        regularization = finite_number(regularization, "regularization")
        if alpha < 0 or regularization <= 0:
            raise LinUCBError("alpha must be >= 0 and regularization > 0")
        if purpose not in ("serving", "simulation"):
            raise LinUCBError("Unknown model purpose")
        self._dimension, self._schema_id = dimension, schema_id
        self._alpha, self._regularization, self._purpose = alpha, regularization, purpose
        self._a = regularization * np.eye(dimension, dtype=np.float64)
        self._b = np.zeros(dimension, dtype=np.float64)
        self._revision = 0
        self._lock = RLock()
        self._factor, self._theta = self._solve_state(self._a, self._b)

    @property
    def dimension(self):
        return self._dimension

    @property
    def schema_id(self):
        return self._schema_id

    @property
    def alpha(self):
        return self._alpha

    @property
    def regularization(self):
        return self._regularization

    @property
    def purpose(self):
        return self._purpose

    @property
    def revision(self):
        with self._lock:
            return self._revision

    @property
    def a(self):
        with self._lock:
            return self._a.copy()

    @property
    def b(self):
        with self._lock:
            return self._b.copy()

    @property
    def theta(self):
        with self._lock:
            return self._theta.copy()

    @staticmethod
    def _solve_state(a: np.ndarray, b: np.ndarray):
        if not np.isfinite(a).all() or not np.isfinite(b).all():
            raise LinUCBError("Non-finite model state")
        # Cholesky reads one triangle; validate symmetry explicitly first.
        if not np.array_equal(a, a.T):
            raise LinUCBError("A must be symmetric")
        try:
            with np.errstate(over="raise", invalid="raise", divide="raise"):
                factor = np.linalg.cholesky(a)
                theta = np.linalg.solve(factor.T, np.linalg.solve(factor, b))
            if not np.isfinite(theta).all():
                raise LinUCBError("Non-finite fitted parameters")
            return factor, theta
        except (np.linalg.LinAlgError, FloatingPointError) as error:
            raise LinUCBError("A must be positive definite and numerically solvable") from error

    def _vector(self, context: DecisionContext) -> np.ndarray:
        if not isinstance(context, DecisionContext) or context.schema_id != self.schema_id:
            raise LinUCBError("Context feature schema does not match model")
        return _array(context.values, (self.dimension,), "context")

    def score(self, context: DecisionContext) -> ScoredArm:
        x = self._vector(context)
        with self._lock:
            try:
                with np.errstate(over="raise", invalid="raise", divide="raise"):
                    # ||L^-1 x||^2 = x.T A^-1 x, A = L L.T.
                    direction = np.linalg.solve(self._factor, x)
                    uncertainty = math.hypot(*direction)
                    exploitation = float(x @ self._theta)
                    exploration = self.alpha * uncertainty
                    score = exploitation + exploration
                if not all(math.isfinite(n) for n in (uncertainty, exploitation, exploration, score)):
                    raise LinUCBError("Non-finite LinUCB score")
            except (np.linalg.LinAlgError, FloatingPointError) as error:
                raise LinUCBError("Context causes unstable scoring") from error
            return ScoredArm(context, exploitation, uncertainty, exploration, score, self._revision)

    def rank(self, contexts: Iterable[DecisionContext], *, top_k: int | None = None) -> list[ScoredArm]:
        if top_k is not None and (type(top_k) is not int or top_k < 0):
            raise LinUCBError("top_k must be a nonnegative integer")
        with self._lock:
            scored = [self.score(context) for context in contexts]
            if len({s.arm_id for s in scored}) != len(scored):
                raise LinUCBError("Duplicate candidate arm_id")
            # Stable across database input order, without rounding UCB scores.
            scored.sort(key=lambda s: (-s.score, s.arm_id))
            return scored if top_k is None else scored[:top_k]

    def update(self, context: DecisionContext, reward: float) -> None:
        if self.purpose != "simulation":
            raise LinUCBError("Serving updates are disabled in US9.2")
        x, reward = self._vector(context), finite_number(reward, "reward")
        with self._lock:
            try:
                with np.errstate(over="raise", invalid="raise"):
                    a = self._a + np.outer(x, x)
                    b = self._b + reward * x
                factor, theta = self._solve_state(a, b)
            except FloatingPointError as error:
                raise LinUCBError("Update causes numeric overflow") from error
            # Validate everything before changing any state.
            self._a, self._b, self._factor, self._theta = a, b, factor, theta
            self._revision += 1

    def to_state(self) -> dict:
        with self._lock:
            return {"version": STATE_VERSION, "algorithm": "shared-linucb", "dimension": self.dimension,
                    "schema_id": self.schema_id, "alpha": self.alpha, "regularization": self.regularization,
                    "purpose": self.purpose, "revision": self._revision, "a": self._a.tolist(), "b": self._b.tolist()}

    @classmethod
    def from_state(cls, state: dict, *, expected_dimension: int, expected_schema_id: str,
                   expected_purpose: str) -> SharedLinUCB:
        keys = {"version", "algorithm", "dimension", "schema_id", "alpha", "regularization",
                "purpose", "revision", "a", "b"}
        if not isinstance(state, dict) or set(state) != keys:
            raise LinUCBError("Invalid model state fields")
        if type(state["version"]) is not int or state["version"] != STATE_VERSION or state["algorithm"] != "shared-linucb":
            raise LinUCBError("Unsupported model format")
        if (state["dimension"] != expected_dimension or state["schema_id"] != expected_schema_id
                or state["purpose"] != expected_purpose):
            raise LinUCBError("Model dimension, feature schema or purpose mismatch")
        if type(state["revision"]) is not int or state["revision"] < 0:
            raise LinUCBError("Invalid model revision")
        model = cls(state["dimension"], state["schema_id"], alpha=state["alpha"],
                    regularization=state["regularization"], purpose=state["purpose"])
        a = _array(state["a"], (model.dimension, model.dimension), "A")
        b = _array(state["b"], (model.dimension,), "b")
        factor, theta = model._solve_state(a, b)
        model._a, model._b, model._factor, model._theta = a, b, factor, theta
        model._revision = state["revision"]
        return model

    def save(self, path: str | Path, *, overwrite: bool = False):
        save_checkpoint(path, self.to_state(), overwrite=overwrite)

    @classmethod
    def load(cls, path: str | Path, *, expected_dimension: int, expected_schema_id: str,
             expected_purpose: str) -> SharedLinUCB:
        return cls.from_state(load_checkpoint(path), expected_dimension=expected_dimension,
                              expected_schema_id=expected_schema_id, expected_purpose=expected_purpose)


def canonical_json(value: object) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, OverflowError) as error:
        raise LinUCBError("Checkpoint must contain finite JSON data") from error


def save_checkpoint(path: str | Path, payload: dict, *, overwrite: bool = False) -> None:
    """Atomic JSON snapshot, mode 0600; no overwrite unless explicitly requested.

    SHA256 detects accidental corruption, not a malicious checkpoint author.
    Checkpoints are local trusted artifacts, never accepted from public requests.
    """
    path = Path(path)
    digest = hashlib.sha256(canonical_json(payload)).hexdigest()
    data = canonical_json({"format": "foodorder-linucb-json-v1", "sha256": digest, "payload": payload})
    if len(data) > MAX_CHECKPOINT_BYTES:
        raise LinUCBError("Checkpoint exceeds size limit")
    if path.is_symlink():
        raise LinUCBError("Checkpoint path must not be a symlink")
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if overwrite:
            os.replace(temporary, path)
        else:
            os.link(temporary, path)  # Atomic create-if-absent; existing state survives.
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise LinUCBError("Duplicate JSON field")
        result[key] = value
    return result


def _reject_constant(_):
    raise LinUCBError("Non-finite JSON")


def load_checkpoint(path: str | Path) -> dict:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_CHECKPOINT_BYTES:
                raise LinUCBError("Checkpoint must be a regular file within size limit")
            data = stream.read(MAX_CHECKPOINT_BYTES + 1)
        if len(data) > MAX_CHECKPOINT_BYTES:
            raise LinUCBError("Checkpoint exceeds size limit")
        envelope = json.loads(data, object_pairs_hook=_unique_json_object, parse_constant=_reject_constant)
        if (not isinstance(envelope, dict) or set(envelope) != {"format", "sha256", "payload"}
                or envelope["format"] != "foodorder-linucb-json-v1" or not isinstance(envelope["payload"], dict)
                or not isinstance(envelope["sha256"], str) or len(envelope["sha256"]) != 64
                or any(c not in "0123456789abcdef" for c in envelope["sha256"])):
            raise LinUCBError("Invalid checkpoint envelope")
        expected = hashlib.sha256(canonical_json(envelope["payload"])).hexdigest()
        if not hmac.compare_digest(envelope["sha256"], expected):
            raise LinUCBError("Checkpoint checksum mismatch")
        return envelope["payload"]
    except LinUCBError:
        raise
    except (OSError, UnicodeError, ValueError, RecursionError) as error:
        raise LinUCBError("Cannot load LinUCB checkpoint") from error
