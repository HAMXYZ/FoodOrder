"""Reproducible mathematical fixture, NOT real training or recommendation traffic.

Run: ./.venv/bin/python -B linucb_demo.py
No database, .env, event service, model file or live user is accessed.
"""

import json

from linucb import DecisionContext, SharedLinUCB


def demo() -> dict:
    model = SharedLinUCB(2, "fixture-2d-v1", alpha=0.5, regularization=1.0, purpose="simulation")
    a = DecisionContext("dish-a", model.schema_id, (1.0, 0.0))
    b = DecisionContext("dish-b", model.schema_id, (0.0, 1.0))

    def scores():
        return [{"dish": s.arm_id, "mean": s.exploitation, "bonus": s.exploration, "score": s.score}
                for s in model.rank([b, a])]

    before = scores()
    model.update(b, reward=1.0)  # Synthetic fixture reward only.
    return {"purpose": "simulation", "schema": model.schema_id, "synthetic_reward": 1.0,
            "before": before, "after": scores(), "a": model.a.tolist(), "b": model.b.tolist(),
            "theta": model.theta.tolist()}


if __name__ == "__main__":
    print(json.dumps(demo(), indent=2, allow_nan=False))
