#!/usr/bin/env python3
import argparse
import json
from copy import deepcopy
from pathlib import Path


TRACKED_EXERCISE_KEYS = {"bench", "incline", "squat", "rdl", "pullup", "pulldown", "shoulderPress"}


def to_number(value, fallback=None):
    if value in ("", None):
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def completed_sets(exercise):
    sets = []
    for item in exercise.get("sets", []):
        if not item.get("done"):
            continue
        reps = to_number(item.get("reps"), 0)
        if not reps:
            continue
        sets.append({
            "load": to_number(item.get("load"), 0) or 0,
            "reps": int(reps),
            "note": item.get("note") or "",
        })
    return sets


def estimate_score(exercise, item):
    if exercise.get("unit") == "次" or exercise.get("key") == "pullup":
        return item["reps"]
    return item["load"] * (1 + item["reps"] / 30)


def best_set(exercise):
    sets = completed_sets(exercise)
    if not sets:
        return None
    return max(sets, key=lambda item: estimate_score(exercise, item))


def workout_set_count(workout):
    return sum(len(completed_sets(exercise)) for exercise in workout.get("exercises", []))


def workout_summary(workout):
    highlights = []
    for exercise in workout.get("exercises", []):
        best = best_set(exercise)
        if not best:
            continue
        if exercise.get("unit") == "次":
            highlights.append(f"{exercise.get('name')} {best['reps']}次")
        else:
            highlights.append(f"{exercise.get('name')} {best['load']:g}×{best['reps']}")
        if len(highlights) == 3:
            break
    return "；".join(highlights) if highlights else "网站训练"


def normalize_workouts(payload):
    workouts = payload.get("workouts", [])
    if not isinstance(workouts, list):
        return []
    return [item for item in workouts if item.get("id") and item.get("date") and item.get("day")]


def upsert_sessions(existing, workouts):
    by_key = {}
    for item in existing:
        key = item.get("id") or (item.get("date"), item.get("day"), item.get("phase"))
        by_key[key] = item

    for workout in workouts:
        if workout_set_count(workout) == 0:
            continue
        bodyweight = to_number(workout.get("bodyweight"))
        duration = to_number(workout.get("duration"))
        by_key[workout["id"]] = {
            "id": workout["id"],
            "date": workout["date"],
            "cycle": workout.get("cycle") or "当前",
            "day": workout["day"],
            "bodyweight": bodyweight,
            "duration": duration,
            "sleep": workout.get("sleep") or "",
            "phase": "网站训练",
            "summary": workout_summary(workout),
        }

    return sorted(by_key.values(), key=lambda item: item["date"])


def upsert_records(existing, workouts):
    result = deepcopy(existing)
    for workout in workouts:
        for exercise in workout.get("exercises", []):
            key = exercise.get("key")
            if key not in TRACKED_EXERCISE_KEYS or key not in result:
                continue
            best = best_set(exercise)
            if not best:
                continue
            current = result.setdefault(key, {"records": []})
            row_key = (workout["date"], workout.get("cycle") or "当前")
            by_key = {(row[0], row[1]): row for row in current.get("records", [])}
            by_key[row_key] = [
                workout["date"],
                workout.get("cycle") or "当前",
                best["load"],
                best["reps"],
                best["note"] or "网站训练",
            ]
            current["records"] = sorted(by_key.values(), key=lambda row: row[0])
    return result


def write_outputs(data, json_path, js_path):
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    js_path.write_text("window.TRAINING_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workout-log", default=Path("web-training-records.json"), type=Path)
    parser.add_argument("--data-json", default=Path("training-dashboard/data/training-data.json"), type=Path)
    parser.add_argument("--data-js", default=Path("training-dashboard/data/training-data.js"), type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.workout_log.exists():
        print(json.dumps({"workouts_found": 0, "reason": "workout log file missing"}, ensure_ascii=False))
        return

    existing = json.loads(args.data_json.read_text(encoding="utf-8"))
    payload = json.loads(args.workout_log.read_text(encoding="utf-8"))
    workouts = normalize_workouts(payload)
    merged = deepcopy(existing)
    merged["sessions"] = upsert_sessions(existing["sessions"], workouts)
    merged["exercises"] = upsert_records(existing["exercises"], workouts)

    print(json.dumps({
        "workouts_found": len(workouts),
        "completed_workouts": sum(1 for item in workouts if workout_set_count(item) > 0),
        "tracked_records": {
            key: sum(1 for workout in workouts for exercise in workout.get("exercises", []) if exercise.get("key") == key and best_set(exercise))
            for key in sorted(TRACKED_EXERCISE_KEYS)
        },
    }, ensure_ascii=False, indent=2))

    if not args.dry_run:
        write_outputs(merged, args.data_json, args.data_js)


if __name__ == "__main__":
    main()
