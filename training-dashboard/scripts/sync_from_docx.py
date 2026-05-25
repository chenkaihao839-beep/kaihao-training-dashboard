#!/usr/bin/env python3
import argparse
import json
import re
import zipfile
from copy import deepcopy
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET


NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

EXERCISES = {
    "bench": "平板卧推",
    "incline": "上斜哑铃卧推",
    "squat": "杠铃深蹲",
    "rdl": "罗马尼亚硬拉",
    "pullup": "引体向上",
    "pulldown": "高位下拉",
    "shoulderPress": "坐姿哑铃推肩",
}


def clean_text(text):
    text = re.sub(r"[_]{2,}", "", text)
    text = text.replace("\u2028", "\n")
    return text.strip()


def extract_lines(docx_path):
    with zipfile.ZipFile(docx_path) as archive:
        xml = archive.read("word/document.xml")
    root = ET.fromstring(xml)
    lines = []
    for para in root.findall(".//w:p", NS):
        text = "".join(node.text or "" for node in para.findall(".//w:t", NS))
        for line in clean_text(text).splitlines():
            line = clean_text(line)
            if line:
                lines.append(line)
    return lines


def parse_cycle(lines):
    joined = "\n".join(lines[:8])
    match = re.search(r"第\s*(\d+)\s*个?\s*Cycle", joined, re.I)
    if match:
        return f"Cycle {match.group(1)}"
    if "回归" in joined:
        return "回归"
    return "当前"


def parse_short_date(value, year):
    match = re.search(r"(\d{1,2})[./月](\d{1,2})", value)
    if not match:
        return None
    month = int(match.group(1))
    day = int(match.group(2))
    return date(year, month, day).isoformat()


def value_after_label(lines, label):
    for index, line in enumerate(lines):
        if line.startswith(label):
            inline = line.split("：", 1)[1] if "：" in line else line[len(label):]
            inline = clean_text(inline)
            if inline:
                return inline
            if index + 1 < len(lines):
                return clean_text(lines[index + 1])
    return ""


def parse_bodyweight(value):
    match = re.search(r"(\d+(?:\.\d+)?)", value)
    return float(match.group(1)) if match else None


def parse_duration(value):
    hour_match = re.search(r"(\d+)\s*h", value, re.I)
    minute_match = re.search(r"(\d+)\s*m", value, re.I)
    if hour_match or minute_match:
        return (int(hour_match.group(1)) * 60 if hour_match else 0) + (int(minute_match.group(1)) if minute_match else 0)
    number = re.search(r"(\d+(?:\.\d+)?)", value)
    return float(number.group(1)) if number else None


def split_days(lines):
    starts = [idx for idx, line in enumerate(lines) if line.startswith("Day ")]
    segments = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        segment_start = 0 if position == 0 else start
        segments.append(lines[segment_start:end])
    return segments


def parse_sets(window, key):
    text = " ".join(window)
    text = re.sub(r"([×xX]\d{1,2})([1-4]\.)", r"\1 \2", text)
    if key == "pullup":
        reps = [int(value) for value in re.findall(r"(?:^|\s)(?:\d+\.\s*)?(\d{1,2})(?:次|$|\s)", text)]
        reps = [value for value in reps if 3 <= value <= 15]
        if reps:
            return {"load": 0, "reps": max(reps), "raw": "/".join(str(value) for value in reps[:3])}

    sets = []
    for load, reps in re.findall(r"(\d+(?:\.\d+)?)\s*(?:kg)?\s*[×xX]\s*(\d{1,2})", text, re.I):
        load_value = float(load)
        reps_value = int(reps)
        if 1 <= reps_value <= 30:
            estimated = load_value * (1 + reps_value / 30)
            sets.append((estimated, load_value, reps_value))
    if not sets:
        return None
    _, load, reps = max(sets, key=lambda item: item[0])
    return {"load": load, "reps": reps, "raw": f"{load:g}×{reps}"}


def find_exercise_record(segment, key, name):
    for idx, line in enumerate(segment):
        if line == name or line.startswith(name):
            window = segment[idx: idx + 14]
            parsed = parse_sets(window, key)
            if not parsed:
                return None
            note_candidates = [
                item for item in window
                if not item.startswith(("1.", "2.", "3.", "4."))
                and item != name
                and not re.search(r"^\d+(\.\d+)?\s*(?:kg)?\s*[×xX]", item, re.I)
            ]
            note = note_candidates[-1] if note_candidates else parsed["raw"]
            return parsed["load"], parsed["reps"], note
    return None


def parse_docx(docx_path, year):
    lines = extract_lines(docx_path)
    cycle = parse_cycle(lines)
    sessions = []
    records = {key: [] for key in EXERCISES}

    for segment in split_days(lines):
        heading = next((line for line in segment if line.startswith("Day ")), "")
        if not heading:
            continue
        date_value = value_after_label(segment, "日期")
        iso_date = parse_short_date(date_value, year)
        if not iso_date:
            continue

        bodyweight = parse_bodyweight(value_after_label(segment, "体重"))
        duration = parse_duration(value_after_label(segment, "训练时长"))
        sleep = value_after_label(segment, "睡眠")
        day_name = heading.replace("·", "·").strip()
        summary_bits = []

        for key, name in EXERCISES.items():
            found = find_exercise_record(segment, key, name)
            if found:
                load, reps, note = found
                records[key].append([iso_date, cycle, load, reps, note])
                if key in {"bench", "squat", "pullup"}:
                    summary_bits.append(f"{name} {reps}次" if key == "pullup" else f"{name} {load:g}×{reps}")

        if summary_bits:
            sessions.append({
                "date": iso_date,
                "cycle": cycle,
                "day": re.sub(r"^Day\s*\d+\s*[·-]?\s*", "", day_name),
                "bodyweight": bodyweight,
                "duration": duration,
                "sleep": sleep,
                "phase": "自动同步",
                "summary": "；".join(summary_bits)
            })

    return {"sessions": sessions, "exercises": records}


def upsert_sessions(existing, incoming):
    by_key = {(item["date"], item["day"]): item for item in existing}
    for item in incoming:
        by_key[(item["date"], item["day"])] = item
    return sorted(by_key.values(), key=lambda item: item["date"])


def upsert_records(existing, incoming):
    result = deepcopy(existing)
    for key, rows in incoming.items():
        current = result.setdefault(key, {"records": []})
        by_key = {(row[0], row[1]): row for row in current["records"]}
        for row in rows:
            by_key[(row[0], row[1])] = row
        current["records"] = sorted(by_key.values(), key=lambda row: row[0])
    return result


def write_outputs(data, json_path, js_path):
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    js_path.write_text("window.TRAINING_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--docx", required=True, type=Path)
    parser.add_argument("--data-json", default=Path("training-dashboard/data/training-data.json"), type=Path)
    parser.add_argument("--data-js", default=Path("training-dashboard/data/training-data.js"), type=Path)
    parser.add_argument("--year", default=2026, type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    existing = json.loads(args.data_json.read_text(encoding="utf-8"))
    parsed = parse_docx(args.docx, args.year)
    merged = deepcopy(existing)
    merged["sessions"] = upsert_sessions(existing["sessions"], parsed["sessions"])
    merged["exercises"] = upsert_records(existing["exercises"], parsed["exercises"])

    print(json.dumps({
        "sessions_found": len(parsed["sessions"]),
        "records_found": {key: len(rows) for key, rows in parsed["exercises"].items() if rows},
    }, ensure_ascii=False, indent=2))

    if not args.dry_run:
        write_outputs(merged, args.data_json, args.data_js)


if __name__ == "__main__":
    main()
