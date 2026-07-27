from __future__ import annotations

import argparse
import hmac
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class BudgetPoint:
    budget_bytes: int
    maximum_useful_charge: str
    minimum_relay_charge: str
    relay_capacity_credit_bytes: str
    useful_fits: bool
    relay_blocked: bool
    classification: str


@dataclass(frozen=True)
class PassingInterval:
    minimum_budget_bytes: int
    maximum_budget_bytes: int
    point_count: int


def _point_contract(point: BudgetPoint) -> dict[str, object]:
    return {
        "budgetBytes": point.budget_bytes,
        "maximumUsefulCharge": point.maximum_useful_charge,
        "minimumRelayCharge": point.minimum_relay_charge,
        "relayCapacityCreditBytes": point.relay_capacity_credit_bytes,
        "usefulFits": point.useful_fits,
        "relayBlocked": point.relay_blocked,
        "classification": point.classification,
    }


def _interval_contract(interval: PassingInterval) -> dict[str, int]:
    return {
        "minimumBudgetBytes": interval.minimum_budget_bytes,
        "maximumBudgetBytes": interval.maximum_budget_bytes,
        "pointCount": interval.point_count,
    }


def exact_reconstruction(expected: bytes, actual: bytes) -> bool:
    return hmac.compare_digest(expected, actual)


def build_budget_sweep(
    *,
    geometry_id: str,
    maximum_useful_charge: int,
    minimum_relay_charge: int,
    relay_capacity_credit_bytes: int,
    minimum_budget: int = 4096,
    maximum_budget: int = 65536,
    step: int = 1024,
) -> dict[str, object]:
    if maximum_useful_charge < 0 or minimum_relay_charge < 0 or relay_capacity_credit_bytes < 0:
        raise ValueError("Charges and capacity credit must be nonnegative.")
    if minimum_budget <= 0 or maximum_budget < minimum_budget or step <= 0:
        raise ValueError("Budget range is invalid.")
    budgets = list(range(minimum_budget, maximum_budget + 1, step))
    if budgets[-1] != maximum_budget:
        raise ValueError("Budget step must land exactly on the maximum.")

    points: list[BudgetPoint] = []
    for budget in budgets:
        useful_fits = maximum_useful_charge <= budget
        relay_blocked = minimum_relay_charge - relay_capacity_credit_bytes > budget
        points.append(
            BudgetPoint(
                budget_bytes=budget,
                maximum_useful_charge=str(maximum_useful_charge),
                minimum_relay_charge=str(minimum_relay_charge),
                relay_capacity_credit_bytes=str(relay_capacity_credit_bytes),
                useful_fits=useful_fits,
                relay_blocked=relay_blocked,
                classification="pass" if useful_fits and relay_blocked else "fail",
            )
        )

    intervals: list[PassingInterval] = []
    start: int | None = None
    previous: int | None = None
    for point in points:
        if point.classification == "pass":
            if start is None:
                start = point.budget_bytes
            previous = point.budget_bytes
        elif start is not None and previous is not None:
            intervals.append(PassingInterval(start, previous, (previous - start) // step + 1))
            start = None
            previous = None
    if start is not None and previous is not None:
        intervals.append(PassingInterval(start, previous, (previous - start) // step + 1))

    return {
        "schemaVersion": 1,
        "contractId": "budget-sweep-result",
        "geometryId": geometry_id,
        "points": [_point_contract(point) for point in points],
        "passingIntervals": [_interval_contract(interval) for interval in intervals],
        "minimumAdjacentPassingPoints": 3,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--geometry-id", required=True)
    parser.add_argument("--maximum-useful-charge", required=True, type=int)
    parser.add_argument("--minimum-relay-charge", required=True, type=int)
    parser.add_argument("--relay-capacity-credit-bytes", required=True, type=int)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = build_budget_sweep(
        geometry_id=args.geometry_id,
        maximum_useful_charge=args.maximum_useful_charge,
        minimum_relay_charge=args.minimum_relay_charge,
        relay_capacity_credit_bytes=args.relay_capacity_credit_bytes,
    )
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    )


if __name__ == "__main__":
    main()
