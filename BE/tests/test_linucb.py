"""US9.2 numerical/encoding/persistence regression tests; no DB or real reward."""

import copy
import json
import math
import stat
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import FrozenInstanceError, replace
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import numpy as np

from linucb import (
    MAX_CHECKPOINT_BYTES, DecisionContext, LinUCBError, SharedLinUCB,
    load_checkpoint, save_checkpoint,
)
from linucb_demo import demo
from linucb_features import DishFeatures, FeatureEncoder, FeatureSchema, HistoryProfile
from linucb_service import LinUCBRanker


def fixture(dish_id="dish-a", **changes):
    data = dict(dish_id=dish_id, category_id=1, base_price=50_000, calories=500,
                spiciness_level=1, is_vegetarian=False, is_available=True)
    return DishFeatures(**(data | changes))


class Mathematics(unittest.TestCase):
    def setUp(self):
        self.model = SharedLinUCB(2, "math-v1", alpha=0.5, purpose="simulation")
        self.a = DecisionContext("a", "math-v1", (1, 0))
        self.b = DecisionContext("b", "math-v1", (0, 1))

    def test_initial_regularized_state_and_separate_score_components(self):
        np.testing.assert_array_equal(self.model.a, np.eye(2))
        np.testing.assert_array_equal(self.model.b, [0, 0])
        score = self.model.score(DecisionContext("x", "math-v1", (3, 4)))
        self.assertEqual(score.exploitation, 0)
        self.assertEqual(score.uncertainty, 5)
        self.assertEqual(score.exploration, 2.5)
        self.assertEqual(score.score, 2.5)
        self.assertEqual(score.model_revision, 0)

    def test_single_update_exact_a_b_theta_and_known_score(self):
        self.model.update(self.b, reward=1.0)
        np.testing.assert_array_equal(self.model.a, [[1, 0], [0, 2]])
        np.testing.assert_array_equal(self.model.b, [0, 1])
        np.testing.assert_allclose(self.model.theta, [0, 0.5], atol=1e-15)
        score = self.model.score(self.b)
        self.assertAlmostEqual(score.exploitation, 0.5)
        self.assertAlmostEqual(score.uncertainty, 1 / math.sqrt(2))
        self.assertAlmostEqual(score.score, 0.8535533905932737)
        self.assertEqual(score.model_revision, 1)

    def test_non_diagonal_system_known_answer_without_inverse(self):
        self.model.update(DecisionContext("x", "math-v1", (1, 1)), 1)
        self.model.update(self.b, 1)
        np.testing.assert_array_equal(self.model.a, [[2, 1], [1, 3]])
        np.testing.assert_array_equal(self.model.b, [1, 2])
        np.testing.assert_allclose(self.model.theta, [0.2, 0.6], atol=1e-15)
        # Patching inverse makes an accidental inverse-based implementation fail.
        with patch("numpy.linalg.inv", side_effect=AssertionError("No explicit inverse")):
            score = self.model.score(DecisionContext("x", "math-v1", (1, 2)))
        self.assertAlmostEqual(score.exploitation, 1.4)
        self.assertAlmostEqual(score.uncertainty ** 2, 1.4)
        self.assertAlmostEqual(score.score, 1.9916079783099616)

    def test_alpha_changes_only_exploration(self):
        scores = []
        for alpha in (0, 0.5, 2):
            model = SharedLinUCB(2, "math-v1", alpha=alpha, purpose="simulation")
            model.update(self.b, 1)
            score = model.score(self.b)
            scores.append(score)
            self.assertAlmostEqual(score.exploitation, 0.5)
            self.assertAlmostEqual(score.exploration, alpha / math.sqrt(2))
        self.assertEqual(scores[0].score, scores[0].exploitation)
        self.assertLess(scores[1].score, scores[2].score)

    def test_regularization_scales_initial_confidence(self):
        model = SharedLinUCB(2, "math-v1", regularization=4, alpha=1)
        np.testing.assert_array_equal(model.a, [[4, 0], [0, 4]])
        self.assertEqual(model.score(self.a).score, 0.5)

    def test_multiple_updates_learn_reward_and_reduce_uncertainty(self):
        previous_uncertainty = self.model.score(self.b).uncertainty
        for i in range(1, 21):
            self.model.update(self.b, 1)
            score = self.model.score(self.b)
            self.assertAlmostEqual(score.exploitation, i / (i + 1))
            self.assertLess(score.uncertainty, previous_uncertainty)
            previous_uncertainty = score.uncertainty
        self.assertEqual(self.model.revision, 20)

    def test_zero_and_negative_explicit_rewards_are_math_not_event_policy(self):
        self.model.update(self.a, 0)
        self.model.update(self.b, -2)
        np.testing.assert_array_equal(self.model.a, [[2, 0], [0, 2]])
        np.testing.assert_array_equal(self.model.b, [0, -2])
        np.testing.assert_allclose(self.model.theta, [0, -1])

    def test_rank_uses_ucb_not_input_order_and_deterministic_ties(self):
        self.assertEqual([s.arm_id for s in self.model.rank([self.b, self.a])], ["a", "b"])
        self.model.update(self.b, 1)
        for contexts in ([self.a, self.b], [self.b, self.a]):
            self.assertEqual([s.arm_id for s in self.model.rank(contexts)], ["b", "a"])
        self.assertEqual(len(self.model.rank([self.a, self.b], top_k=1)), 1)
        self.assertEqual(len(self.model.rank([self.a, self.b], top_k=9)), 2)

    def test_empty_top_zero_duplicate_and_invalid_top_k(self):
        self.assertEqual(self.model.rank([]), [])
        self.assertEqual(self.model.rank([self.a], top_k=0), [])
        with self.assertRaises(LinUCBError):
            self.model.rank([self.a, self.a])
        for k in (-1, 1.5, True, "1"):
            with self.subTest(k=k), self.assertRaises(LinUCBError):
                self.model.rank([self.a], top_k=k)

    def test_invalid_hyperparameters_and_dimensions(self):
        for dimension in (0, -1, True, 1.0, 513):
            with self.subTest(dimension=dimension), self.assertRaises(LinUCBError):
                SharedLinUCB(dimension, "math-v1")
        for kwargs in ({"alpha": -1}, {"alpha": math.nan}, {"alpha": math.inf}, {"alpha": True},
                       {"regularization": 0}, {"regularization": -1}, {"regularization": math.inf},
                       {"purpose": "production-training"}, {"schema_id": ""}):
            with self.subTest(kwargs=kwargs), self.assertRaises(LinUCBError):
                SharedLinUCB(2, **({"schema_id": "math-v1"} | kwargs))

    def test_invalid_context_values_and_identifiers(self):
        for values in ([], [math.nan, 0], [math.inf, 1], [True, 1], ["1", 0], [[1], [0]], [1 + 2j, 0]):
            with self.subTest(values=values), self.assertRaises(LinUCBError):
                DecisionContext("a", "math-v1", values)
        for arm, schema in (("", "math-v1"), ("a", ""), (None, "math-v1")):
            with self.assertRaises(LinUCBError):
                DecisionContext(arm, schema, (1, 0))

    def test_context_dimension_and_schema_mismatch_do_not_update(self):
        for context in (DecisionContext("a", "math-v1", (1,)), DecisionContext("a", "other", (1, 0))):
            with self.assertRaises(LinUCBError):
                self.model.score(context)
            with self.assertRaises(LinUCBError):
                self.model.update(context, 1)
        self.assertEqual(self.model.revision, 0)

    def test_context_and_model_state_are_defensive_snapshots(self):
        values = [1, 0]
        context = DecisionContext("a", "math-v1", values)
        values[0] = 100
        self.assertEqual(context.values, (1, 0))
        with self.assertRaises(FrozenInstanceError):
            context.arm_id = "x"
        a, b, theta = self.model.a, self.model.b, self.model.theta
        a[:] = 100
        b[:] = 100
        theta[:] = 100
        self.assertEqual(self.model.score(context).score, 0.5)

    def test_invalid_reward_and_overflow_are_atomic(self):
        before = self.model.to_state()
        for reward in (math.nan, math.inf, -math.inf, True, "1", None):
            with self.subTest(reward=reward), self.assertRaises(LinUCBError):
                self.model.update(self.a, reward)
            self.assertEqual(self.model.to_state(), before)
        for context, reward in ((DecisionContext("a", "math-v1", (1e308, 0)), 1),
                                (DecisionContext("a", "math-v1", (2, 0)), 1e308)):
            with self.assertRaises(LinUCBError):
                self.model.update(context, reward)
            self.assertEqual(self.model.to_state(), before)

    def test_nonfinite_score_is_rejected(self):
        model = SharedLinUCB(2, "math-v1", alpha=1e308)
        with self.assertRaises(LinUCBError):
            model.score(DecisionContext("a", "math-v1", (2, 0)))

    def test_serving_is_default_and_rejects_learning(self):
        serving = SharedLinUCB(2, "math-v1")
        before = serving.to_state()
        with self.assertRaisesRegex(LinUCBError, "Serving updates"):
            serving.update(self.a, 1)
        self.assertEqual(serving.to_state(), before)

    def test_concurrent_explicit_updates_are_not_lost(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: self.model.update(self.a, 1), range(40)))
        np.testing.assert_array_equal(self.model.a, [[41, 0], [0, 1]])
        np.testing.assert_array_equal(self.model.b, [40, 0])
        self.assertEqual(self.model.revision, 40)

    def test_documented_demo_matches_formula_and_is_repeatable(self):
        result = demo()
        self.assertEqual(result, demo())
        self.assertEqual(result["purpose"], "simulation")
        self.assertEqual([s["dish"] for s in result["before"]], ["dish-a", "dish-b"])
        self.assertEqual(result["before"][0]["score"], 0.5)
        self.assertEqual(result["after"][0]["dish"], "dish-b")
        self.assertAlmostEqual(result["after"][0]["score"], 0.8535533905932737)


class ContextFeatures(unittest.TestCase):
    def setUp(self):
        self.encoder = FeatureEncoder()
        self.dish = fixture()

    def feature_values(self, dish=None, profile=None):
        context = self.encoder.encode(dish or self.dish, profile)
        return dict(zip(self.encoder.schema.names, context.values))

    def test_fixed_28_dimensions_all_fields_normalized(self):
        features = self.feature_values()
        self.assertEqual(len(features), 28)
        self.assertEqual(len(self.encoder.schema.names), len(set(self.encoder.schema.names)))
        self.assertEqual(features["bias"], 1)
        self.assertEqual(features["category:1"], 1)
        self.assertEqual(features["category:2"], 0)
        self.assertEqual(features["dish:price"], 0.25)
        self.assertEqual(features["dish:calories"], 0.5)
        self.assertAlmostEqual(features["dish:spiciness"], 1 / 3)
        self.assertEqual(features["dish:vegetarian"], 0)
        self.assertTrue(all(0 <= v <= 1 for v in features.values()))

    def test_unknown_and_missing_category_use_reserved_bucket_no_growth(self):
        for category in (None, 999):
            features = self.feature_values(replace(self.dish, category_id=category))
            self.assertEqual(len(features), 28)
            self.assertEqual(features["category:unknown"], 1)
            self.assertEqual(sum(features[f"category:{i}"] for i in range(1, 7)), 0)

    def test_missing_numeric_values_have_flags_and_no_fake_similarity(self):
        profile = self.encoder.profile([self.dish])
        dish = replace(self.dish, base_price=None, calories=None, spiciness_level=None, is_vegetarian=None)
        features = self.feature_values(dish, profile)
        for name in ("price", "calories", "spiciness", "vegetarian"):
            self.assertEqual(features[f"dish:{name}"], 0)
            self.assertEqual(features[f"missing:{name}"], 1)
            self.assertEqual(features[f"similarity:{name}"], 0)

    def test_clipped_price_calories_and_decimal_model_price(self):
        features = self.feature_values(replace(self.dish, base_price=Decimal("300000.00"), calories=1500,
                                              spiciness_level=3, is_vegetarian=True))
        for name in ("price", "calories", "spiciness", "vegetarian"):
            self.assertEqual(features[f"dish:{name}"], 1)
            self.assertEqual(features[f"missing:{name}"], 0)

    def test_actual_sqlalchemy_model_scalar_adapter(self):
        from models import Dish
        dish = Dish(id=uuid4(), category_id=2, name="Memory fixture", base_price=Decimal("65000.00"),
                    calories=720, spiciness_level=2, is_vegetarian=False, is_available=True)
        candidate = DishFeatures.from_model(dish)
        context = self.encoder.encode(candidate)
        self.assertEqual(context.arm_id, str(dish.id))
        self.assertEqual(len(context.values), 28)
        self.assertEqual(candidate.base_price, Decimal("65000.00"))

    def test_invalid_dish_fields_are_rejected(self):
        changes = [{"category_id": v} for v in (0, -1, True, "1")]
        changes += [{"base_price": v} for v in (-1, math.nan, math.inf, True, "100", Decimal("sNaN"))]
        changes += [{"calories": v} for v in (-1, math.nan, math.inf, "100")]
        changes += [{"spiciness_level": v} for v in (-1, 4, 1.5, True)]
        changes += [{"is_vegetarian": v} for v in (0, 1, "false")]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(LinUCBError):
                self.encoder.encode(replace(self.dish, **change))
        for change in ({"dish_id": ""}, {"dish_id": None}, {"is_available": 1}):
            with self.assertRaises(LinUCBError):
                replace(self.dish, **change)

    def test_empty_history_is_safe_without_claiming_preferences(self):
        profile = self.encoder.profile()
        self.assertEqual(profile.observation_count, 0)
        self.assertEqual(profile.category_frequencies, (0,) * 7)
        self.assertEqual(profile.numeric_means, (None,) * 4)
        features = self.feature_values(profile=profile)
        self.assertEqual(features["history_present"], 0)
        self.assertTrue(all(features[name] == 0 for name in features if name.startswith(("affinity:", "similarity:"))))

    def test_history_means_skip_missing_values_and_encode_user_dish_matches(self):
        other = replace(self.dish, category_id=2, base_price=150_000, calories=None,
                        spiciness_level=3, is_vegetarian=True)
        profile = self.encoder.profile([self.dish, other])
        self.assertEqual(profile.category_frequencies, (0.5, 0.5, 0, 0, 0, 0, 0))
        np.testing.assert_allclose(profile.numeric_means, [0.5, 0.5, 2 / 3, 0.5])
        features = self.feature_values(profile=profile)
        self.assertEqual(features["affinity:1"], 0.5)
        self.assertEqual(features["affinity:2"], 0)
        self.assertEqual(features["similarity:price"], 0.75)
        self.assertEqual(features["history_present"], 1)

    def test_invalid_profile_dimension_sum_means_and_schema(self):
        profile = self.encoder.profile([self.dish])
        for changes in ({"schema_id": "other"}, {"category_frequencies": (1,)},
                        {"category_frequencies": (0,) * 7}, {"category_frequencies": (math.nan,) * 7},
                        {"numeric_means": (1,)}, {"numeric_means": (2, None, None, None)},
                        {"numeric_means": (math.inf,) * 4}, {"observation_count": -1},
                        {"observation_count": True}):
            with self.subTest(changes=changes), self.assertRaises(LinUCBError):
                self.encoder.encode(self.dish, replace(profile, **changes))
        with self.assertRaises(LinUCBError):
            self.encoder.encode(self.dish, HistoryProfile(self.encoder.schema.fingerprint, (0,) * 7, (0,) * 4, 0))

    def test_profile_copies_mutable_input_and_encoder_schema_is_frozen(self):
        frequencies, means = [1, 0, 0, 0, 0, 0, 0], [0.5] * 4
        profile = HistoryProfile(self.encoder.schema.fingerprint, frequencies, means, 1)
        frequencies[0], means[0] = 0, 0
        self.assertEqual(profile.category_frequencies[0], 1)
        self.assertEqual(profile.numeric_means[0], 0.5)
        with self.assertRaises(FrozenInstanceError):
            self.encoder.schema.price_cap = 1

    def test_schema_fingerprint_includes_order_caps_and_feature_version(self):
        schema = self.encoder.schema
        self.assertEqual(FeatureSchema.from_dict(schema.to_dict()).fingerprint, schema.fingerprint)
        for other in (FeatureSchema(category_ids=(2, 1, 3, 4, 5, 6)), FeatureSchema(price_cap=100_000),
                      FeatureSchema(category_ids=(1, 2))):
            self.assertNotEqual(other.fingerprint, schema.fingerprint)
        for changes in ({"version": 2}, {"price_cap": 0}, {"calories_cap": math.inf},
                        {"category_ids": [1, 1]}, {"category_ids": [True]}, {"category_ids": [0]}):
            with self.subTest(changes=changes), self.assertRaises(LinUCBError):
                FeatureSchema(**changes)


class RankerInterface(unittest.TestCase):
    def test_availability_guard_and_no_production_learning(self):
        ranker = LinUCBRanker()
        dishes = [fixture("a"), fixture("b", is_available=False), fixture("c", is_available=None)]
        decisions = ranker.rank(dishes)
        self.assertEqual([s.arm_id for s in decisions], ["a"])
        with self.assertRaises(LinUCBError):
            ranker.update_simulation(decisions[0], reward=1)
        self.assertEqual(ranker.model.revision, 0)

    def test_empty_candidates_unknown_availability_and_invalid_inputs(self):
        ranker = LinUCBRanker()
        self.assertEqual(ranker.rank([]), [])
        self.assertEqual(ranker.rank([fixture(is_available=None)]), [])
        with self.assertRaises(LinUCBError):
            ranker.rank([fixture(), fixture()])
        with self.assertRaises(LinUCBError):
            ranker.rank([{}])
        with self.assertRaises(LinUCBError):
            ranker.update_simulation(ranker.encoder.encode(fixture()), reward=1)

    def test_update_uses_exact_scored_snapshot_after_dish_or_history_changes(self):
        ranker = LinUCBRanker(purpose="simulation")
        dish = fixture()
        decision = ranker.rank([dish], profile=ranker.encoder.profile([dish]))[0]
        original = np.array(decision.context.values)
        # Future values differ but delayed feedback must refer to the old context.
        changed = replace(dish, base_price=199_999, category_id=2)
        fresh = ranker.rank([changed], profile=ranker.encoder.profile([changed]))[0]
        self.assertNotEqual(fresh.context.values, decision.context.values)
        ranker.update_simulation(decision, reward=0.75)
        np.testing.assert_allclose(ranker.model.a, np.eye(28) + np.outer(original, original))
        np.testing.assert_allclose(ranker.model.b, 0.75 * original)

    def test_foreign_encoder_decision_is_rejected(self):
        ranker = LinUCBRanker(purpose="simulation")
        other = LinUCBRanker(FeatureSchema(price_cap=100_000), purpose="simulation")
        with self.assertRaises(LinUCBError):
            ranker.update_simulation(other.rank([fixture()])[0], reward=1)
        self.assertEqual(ranker.model.revision, 0)

    def test_two_history_contexts_give_different_learned_rankings(self):
        # Equal numeric attributes: only category/history interactions distinguish
        # which dish matches each synthetic user's past category.
        ranker = LinUCBRanker(alpha=0, purpose="simulation")
        a, b = fixture("dish-a", category_id=1), fixture("dish-b", category_id=2)
        profile_a, profile_b = ranker.encoder.profile([a]), ranker.encoder.profile([b])
        for _ in range(10):
            for profile, preferred in ((profile_a, a.dish_id), (profile_b, b.dish_id)):
                for decision in ranker.rank([b, a], profile=profile):
                    ranker.update_simulation(decision, reward=float(decision.arm_id == preferred))
        for profile, expected in ((profile_a, "dish-a"), (profile_b, "dish-b")):
            ranked = ranker.rank([b, a], profile=profile)
            self.assertEqual(ranked[0].arm_id, expected)
            self.assertGreater(ranked[0].exploitation, ranked[1].exploitation)

    def test_internal_modules_do_not_import_event_services_or_database(self):
        import ast
        root = Path(__file__).parents[1]
        for module in ("linucb.py", "linucb_features.py", "linucb_service.py", "linucb_demo.py"):
            tree = ast.parse((root / module).read_text())
            imports = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imports.update(a.name.split(".")[0] for a in node.names)
                elif isinstance(node, ast.ImportFrom):
                    imports.add((node.module or "").split(".")[0])
            self.assertFalse(imports & {"database", "main", "models", "interactions", "purchases", "rating_feedback", "dotenv"})


class Checkpoints(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="foodorder-linucb-isolated-")
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "model.json"
        self.model = SharedLinUCB(2, "math-v1", alpha=0.5, purpose="simulation")
        self.context = DecisionContext("a", "math-v1", (1, 2))
        self.model.update(self.context, 0.75)

    def load(self, **changes):
        args = dict(expected_dimension=2, expected_schema_id="math-v1", expected_purpose="simulation")
        return SharedLinUCB.load(self.path, **(args | changes))

    def test_save_load_preserves_full_state_score_and_permissions(self):
        self.model.save(self.path)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        loaded = self.load()
        self.assertEqual(loaded.to_state(), self.model.to_state())
        self.assertEqual(loaded.score(self.context), self.model.score(self.context))
        loaded.update(self.context, 1)
        self.assertEqual(loaded.revision, 2)
        self.assertEqual(self.model.revision, 1)

    def test_full_ranker_bundle_restores_encoder_and_rankings(self):
        schema = FeatureSchema(category_ids=(9, 3), price_cap=90_000)
        ranker = LinUCBRanker(schema, alpha=0.7, regularization=2, purpose="simulation")
        dishes = [fixture("a", category_id=9), fixture("b", category_id=3, calories=200)]
        profile = ranker.encoder.profile([dishes[0]])
        ranker.update_simulation(ranker.rank(dishes, profile=profile)[0], reward=1)
        ranked = ranker.rank(dishes, profile=profile)
        ranker.save(self.path)
        loaded = LinUCBRanker.load(self.path, expected_schema=schema, expected_purpose="simulation")
        self.assertEqual(loaded.schema.to_dict(), schema.to_dict())
        self.assertEqual(loaded.rank(dishes, profile=profile), ranked)

    def test_serving_bundle_can_save_and_reload_but_never_update(self):
        ranker = LinUCBRanker()
        ranker.save(self.path)
        loaded = LinUCBRanker.load(self.path, expected_schema=ranker.schema, expected_purpose="serving")
        with self.assertRaises(LinUCBError):
            loaded.update_simulation(loaded.rank([fixture()])[0], reward=1)

    def test_purpose_dimension_and_schema_mismatch_are_rejected(self):
        self.model.save(self.path)
        for changes in ({"expected_purpose": "serving"}, {"expected_dimension": 3}, {"expected_schema_id": "new"}):
            with self.subTest(changes=changes), self.assertRaises(LinUCBError):
                self.load(**changes)

    def test_encoder_mismatch_even_when_dimensions_match(self):
        ranker = LinUCBRanker(purpose="simulation")
        ranker.save(self.path)
        for schema in (FeatureSchema(price_cap=100_000), FeatureSchema(category_ids=(2, 1, 3, 4, 5, 6))):
            with self.assertRaises(LinUCBError):
                LinUCBRanker.load(self.path, expected_schema=schema, expected_purpose="simulation")

    def test_corrupted_bytes_digest_json_duplicate_fields_are_rejected(self):
        self.model.save(self.path)
        original = json.loads(self.path.read_text())
        wrong = copy.deepcopy(original)
        wrong["payload"]["b"][0] += 1
        for data in (b"", b"not json", json.dumps(wrong).encode(), b'{"format":"a","format":"b"}',
                     b'{"payload":NaN}', b'{"payload":Infinity}'):
            self.path.write_bytes(data)
            with self.subTest(data=data[:50]), self.assertRaises(LinUCBError):
                self.load()

    def test_invalid_digest_text_or_path_are_safe_errors(self):
        self.model.save(self.path)
        envelope = json.loads(self.path.read_text())
        for digest in ("é" * 64, "g" * 64, 123, "short"):
            envelope["sha256"] = digest
            self.path.write_text(json.dumps(envelope))
            with self.assertRaises(LinUCBError):
                self.load()
        self.path.unlink()
        with self.assertRaises(LinUCBError):
            self.load()
        with self.assertRaises(LinUCBError):
            load_checkpoint(self.directory.name)

    def test_valid_checksum_does_not_bypass_state_validation(self):
        original = self.model.to_state()
        cases = [{"version": 2}, {"algorithm": "popularity"}, {"dimension": True}, {"revision": -1},
                 {"revision": 1.5}, {"a": [[1, 0], [0, 0]]}, {"a": [[1, 0], [0, -1]]},
                 {"a": [[2, 1], [0, 2]]}, {"a": [[1]]}, {"b": [1]}, {"b": ["1", 2]},
                 {"alpha": -1}, {"regularization": 0}]
        for changes in cases:
            save_checkpoint(self.path, original | changes, overwrite=True)
            with self.subTest(changes=changes), self.assertRaises(LinUCBError):
                self.load()
        with self.assertRaises(LinUCBError):
            SharedLinUCB.from_state(original | {"extra": 1}, expected_dimension=2,
                                    expected_schema_id="math-v1", expected_purpose="simulation")

    def test_nan_inf_and_ragged_state_cannot_be_loaded_or_saved(self):
        for changes in ({"b": [math.nan, 1]}, {"a": [[math.inf, 0], [0, 1]]}, {"a": [[1], [0, 1]]}):
            with self.subTest(changes=changes), self.assertRaises(LinUCBError):
                SharedLinUCB.from_state(self.model.to_state() | changes, expected_dimension=2,
                                        expected_schema_id="math-v1", expected_purpose="simulation")
        with self.assertRaises(LinUCBError):
            save_checkpoint(self.path, {"a": math.nan})
        self.assertFalse(self.path.exists())

    def test_default_save_does_not_overwrite_existing_file(self):
        self.model.save(self.path)
        original = self.path.read_bytes()
        self.model.update(self.context, 1)
        with self.assertRaises(FileExistsError):
            self.model.save(self.path)
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual([p.name for p in Path(self.directory.name).iterdir()], ["model.json"])
        self.model.save(self.path, overwrite=True)
        self.assertEqual(self.load().revision, 2)

    def test_failed_atomic_replace_preserves_previous_state(self):
        self.model.save(self.path)
        original = self.path.read_bytes()
        with patch("linucb.os.replace", side_effect=OSError("isolated failure")):
            with self.assertRaises(OSError):
                self.model.save(self.path, overwrite=True)
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(len(list(Path(self.directory.name).iterdir())), 1)

    def test_symlink_load_and_save_are_rejected(self):
        self.model.save(self.path)
        link = self.path.with_name("link.json")
        link.symlink_to(self.path)
        with self.assertRaises(LinUCBError):
            SharedLinUCB.load(link, expected_dimension=2, expected_schema_id="math-v1", expected_purpose="simulation")
        with self.assertRaises(LinUCBError):
            self.model.save(link, overwrite=True)

    def test_oversize_checkpoint_rejected_before_parsing(self):
        with self.path.open("wb") as stream:
            stream.truncate(MAX_CHECKPOINT_BYTES + 1)
        with self.assertRaises(LinUCBError):
            self.load()

    def test_unknown_bundle_version_and_tampered_encoder_rejected(self):
        ranker = LinUCBRanker(purpose="simulation")
        ranker.save(self.path)
        original = load_checkpoint(self.path)
        for changes in ({"bundle_version": 2}, {"features": original["features"] | {"version": 9}},
                        {"features": original["features"] | {"extra": "invalid"}}):
            save_checkpoint(self.path, original | changes, overwrite=True)
            with self.assertRaises(LinUCBError):
                LinUCBRanker.load(self.path, expected_schema=ranker.schema, expected_purpose="simulation")


if __name__ == "__main__":
    unittest.main()
