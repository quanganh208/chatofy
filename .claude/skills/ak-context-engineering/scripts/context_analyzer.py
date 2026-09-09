#!/usr/bin/env python3
"""
Context Analyzer - Health analysis and degradation detection for agent contexts.

Usage:
    python context_analyzer.py analyze <context_file>
    python context_analyzer.py budget --system 2000 --tools 1500 --docs 3000 --history 5000
    python context_analyzer.py estimate <path> [<path> ...] [--limit 200000]
"""

import argparse
import json
import math
import os
import re
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

MAX_FILE_SIZE_MB = 100


def load_json_file(path: str):
    """Load JSON file with proper error handling and size validation."""
    try:
        size_mb = os.path.getsize(path) / (1024 * 1024)
        if size_mb > MAX_FILE_SIZE_MB:
            print(f"Error: File too large ({size_mb:.1f}MB). Max {MAX_FILE_SIZE_MB}MB", file=sys.stderr)
            sys.exit(1)
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: File not found: {path}", file=sys.stderr)
        sys.exit(1)
    except PermissionError:
        print(f"Error: Permission denied: {path}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in {path}: {e}", file=sys.stderr)
        sys.exit(1)


class HealthStatus(Enum):
    HEALTHY = "healthy"
    WARNING = "warning"
    DEGRADED = "degraded"
    CRITICAL = "critical"


@dataclass
class ContextAnalysis:
    total_tokens: int
    token_limit: int
    utilization: float
    health_status: HealthStatus
    health_score: float
    degradation_risk: float
    poisoning_risk: float
    recommendations: list = field(default_factory=list)


def estimate_tokens(text: str) -> int:
    """Estimate token count (~4 chars per token for English)."""
    return len(text) // 4


def estimate_message_tokens(messages: list) -> int:
    """Estimate tokens in message list."""
    total = 0
    for msg in messages:
        if isinstance(msg, dict):
            content = msg.get("content", "")
            total += estimate_tokens(str(content))
            # Add overhead for role, metadata
            total += 10
        else:
            total += estimate_tokens(str(msg))
    return total


def measure_attention_distribution(context_length: int, sample_size: int = 100) -> list:
    """
    Simulate U-shaped attention distribution.
    Real implementation would extract from model attention weights.
    """
    attention = []
    for i in range(sample_size):
        position = i / sample_size
        # U-shaped curve: high at start/end, low in middle
        if position < 0.1:
            score = 0.9 - position * 2
        elif position > 0.9:
            score = 0.7 + (position - 0.9) * 2
        else:
            score = 0.3 + 0.1 * math.sin(position * math.pi)
        attention.append(score)
    return attention


def detect_lost_in_middle(messages: list, critical_keywords: list) -> list:
    """Identify critical items in attention-degraded regions."""
    if not messages:
        return []

    total = len(messages)
    warnings = []

    for i, msg in enumerate(messages):
        position = i / total
        content = str(msg.get("content", "") if isinstance(msg, dict) else msg)

        # Middle region (10%-90%)
        if 0.1 < position < 0.9:
            for keyword in critical_keywords:
                if keyword.lower() in content.lower():
                    warnings.append({
                        "position": i,
                        "position_pct": f"{position:.1%}",
                        "keyword": keyword,
                        "risk": "high" if 0.3 < position < 0.7 else "medium"
                    })
    return warnings


def detect_poisoning_patterns(messages: list) -> dict:
    """Detect potential context poisoning indicators."""
    error_patterns = [
        r"error", r"failed", r"exception", r"cannot", r"unable",
        r"invalid", r"not found", r"undefined", r"null"
    ]
    # Simple contradiction check - look for both positive and negative statements
    contradiction_keywords = [
        ("is correct", "is not correct"),
        ("should work", "should not work"),
        ("will succeed", "will fail"),
        ("is valid", "is invalid"),
    ]

    errors_found = []
    contradictions = []

    for i, msg in enumerate(messages):
        content = str(msg.get("content", "") if isinstance(msg, dict) else msg).lower()

        # Check error patterns
        for pattern in error_patterns:
            if re.search(pattern, content):
                errors_found.append({"position": i, "pattern": pattern})

        # Check for contradiction keywords (simplified)
        for pos_phrase, neg_phrase in contradiction_keywords:
            if pos_phrase in content and neg_phrase in content:
                contradictions.append({"position": i, "type": "self-contradiction"})

    total = max(len(messages), 1)
    return {
        "error_density": len(errors_found) / total,
        "contradiction_count": len(contradictions),
        "poisoning_risk": min(1.0, (len(errors_found) * 0.1 + len(contradictions) * 0.3))
    }


def calculate_health_score(utilization: float, degradation_risk: float, poisoning_risk: float) -> float:
    """
    Calculate composite health score.
    1.0 = healthy, 0.0 = critical
    """
    score = 1.0
    # Utilization penalty (kicks in after 70%)
    if utilization > 0.7:
        score -= (utilization - 0.7) * 1.5
    # Degradation penalty
    score -= degradation_risk * 0.3
    # Poisoning penalty
    score -= poisoning_risk * 0.2
    return max(0.0, min(1.0, score))


def get_health_status(score: float) -> HealthStatus:
    """Map health score to status."""
    if score > 0.8:
        return HealthStatus.HEALTHY
    elif score > 0.6:
        return HealthStatus.WARNING
    elif score > 0.4:
        return HealthStatus.DEGRADED
    return HealthStatus.CRITICAL


def analyze_context(messages: list, token_limit: int = 128000,
                    critical_keywords: Optional[list] = None) -> ContextAnalysis:
    """
    Comprehensive context health analysis.

    Args:
        messages: List of context messages
        token_limit: Model's context window size
        critical_keywords: Keywords that should be at attention-favored positions

    Returns:
        ContextAnalysis with health metrics and recommendations
    """
    critical_keywords = critical_keywords or ["goal", "task", "important", "critical", "must"]

    # Calculate token utilization
    total_tokens = estimate_message_tokens(messages)
    utilization = total_tokens / token_limit

    # Check for lost-in-middle issues
    middle_warnings = detect_lost_in_middle(messages, critical_keywords)
    degradation_risk = min(1.0, len(middle_warnings) * 0.2)

    # Check for poisoning
    poisoning = detect_poisoning_patterns(messages)
    poisoning_risk = poisoning["poisoning_risk"]

    # Calculate health
    health_score = calculate_health_score(utilization, degradation_risk, poisoning_risk)
    health_status = get_health_status(health_score)

    # Generate recommendations
    recommendations = []
    if utilization > 0.8:
        recommendations.append("URGENT: Context utilization >80%. Trigger compaction immediately.")
    elif utilization > 0.7:
        recommendations.append("WARNING: Context utilization >70%. Plan for compaction.")

    if middle_warnings:
        recommendations.append(f"Found {len(middle_warnings)} critical items in middle region. "
                               "Consider moving to beginning/end.")

    if poisoning_risk > 0.3:
        recommendations.append("High poisoning risk detected. Review recent tool outputs for errors.")

    if health_status == HealthStatus.CRITICAL:
        recommendations.append("CRITICAL: Consider context reset with clean state.")

    return ContextAnalysis(
        total_tokens=total_tokens,
        token_limit=token_limit,
        utilization=utilization,
        health_status=health_status,
        health_score=health_score,
        degradation_risk=degradation_risk,
        poisoning_risk=poisoning_risk,
        recommendations=recommendations
    )


def calculate_budget(system: int, tools: int, docs: int, history: int,
                     buffer_pct: float = 0.15) -> dict:
    """Calculate context budget allocation."""
    subtotal = system + tools + docs + history
    buffer = int(subtotal * buffer_pct)
    total = subtotal + buffer

    return {
        "allocation": {
            "system_prompt": system,
            "tool_definitions": tools,
            "retrieved_docs": docs,
            "message_history": history,
            "reserved_buffer": buffer
        },
        "total_budget": total,
        "warning_threshold": int(total * 0.7),
        "critical_threshold": int(total * 0.8),
        "recommendations": [
            f"Trigger compaction at {int(total * 0.7):,} tokens",
            f"Aggressive optimization at {int(total * 0.8):,} tokens",
            f"Reserved {buffer:,} tokens ({buffer_pct:.0%}) for responses"
        ]
    }


# Read-strategy thresholds for `estimate` (tokens). Files at or under WHOLE fit in
# one read; up to RANGES they should be searched then read by line range; larger
# files should be searched first and read only around the hits.
ESTIMATE_WHOLE_MAX = 2000
ESTIMATE_RANGES_MAX = 8000
ESTIMATE_MAX_FILES = 500
ESTIMATE_SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target"}


def read_advice(tokens: int) -> str:
    """Map an estimated token count to a read strategy."""
    if tokens <= ESTIMATE_WHOLE_MAX:
        return "read-whole"
    if tokens <= ESTIMATE_RANGES_MAX:
        return "search-then-ranges"
    return "search-first"


def collect_files(paths: list) -> tuple:
    """Expand files and directories into a bounded file list. Returns (files, errors)."""
    files, errors = [], []
    for raw in paths:
        if os.path.isfile(raw):
            files.append(raw)
            continue
        if not os.path.isdir(raw):
            errors.append(f"Path not found: {raw}")
            continue
        for root, dirs, names in os.walk(raw):
            dirs[:] = sorted(d for d in dirs if d not in ESTIMATE_SKIP_DIRS and not d.startswith("."))
            for name in sorted(names):
                files.append(os.path.join(root, name))
                if len(files) >= ESTIMATE_MAX_FILES:
                    errors.append(f"Stopped after {ESTIMATE_MAX_FILES} files; narrow the path")
                    return files, errors
    return files, errors


def estimate_file(path: str) -> dict:
    """Estimate tokens for one file. Oversized, binary, and unreadable files are
    sized without being decoded, instead of raising and losing every other file's
    result in the same `estimate` run."""
    try:
        size = os.path.getsize(path)
    except OSError as e:
        return {"path": path, "bytes": None, "lines": None, "tokens": 0, "advice": "unreadable", "error": str(e)}
    if size > MAX_FILE_SIZE_MB * 1024 * 1024:
        # Too large to safely decode whole; size-only estimate still guides the read strategy.
        return {"path": path, "bytes": size, "lines": None, "tokens": size // 4, "advice": "search-first"}
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except UnicodeDecodeError:
        return {"path": path, "bytes": size, "lines": None, "tokens": 0, "advice": "binary-skip"}
    except OSError as e:
        return {"path": path, "bytes": size, "lines": None, "tokens": 0, "advice": "unreadable", "error": str(e)}
    tokens = estimate_tokens(text)
    lines = text.count(chr(10)) + (1 if text and not text.endswith(chr(10)) else 0)
    return {"path": path, "bytes": size, "lines": lines, "tokens": tokens, "advice": read_advice(tokens)}


def estimate_paths(paths: list, limit: int = 200000) -> dict:
    """Estimate tokens for files/directories and advise a read strategy per file."""
    files, errors = collect_files(paths)
    entries = [estimate_file(f) for f in files]
    total = sum(e["tokens"] for e in entries)
    return {
        "files": entries,
        "total_tokens": total,
        "token_limit": limit,
        "percent_of_limit": round(total / limit * 100, 1) if limit > 0 else None,
        "thresholds": {"read_whole_max": ESTIMATE_WHOLE_MAX, "search_then_ranges_max": ESTIMATE_RANGES_MAX},
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(description="Context health analyzer")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Analyze command
    analyze_parser = subparsers.add_parser("analyze", help="Analyze context health")
    analyze_parser.add_argument("context_file", help="JSON file with messages array")
    analyze_parser.add_argument("--limit", type=int, default=128000, help="Token limit")
    analyze_parser.add_argument("--keywords", nargs="+", help="Critical keywords to track")

    # Budget command
    budget_parser = subparsers.add_parser("budget", help="Calculate context budget")
    budget_parser.add_argument("--system", type=int, default=2000, help="System prompt tokens")
    budget_parser.add_argument("--tools", type=int, default=1500, help="Tool definitions tokens")
    budget_parser.add_argument("--docs", type=int, default=3000, help="Retrieved docs tokens")
    budget_parser.add_argument("--history", type=int, default=5000, help="Message history tokens")
    budget_parser.add_argument("--buffer", type=float, default=0.15, help="Buffer percentage")

    # Estimate command
    estimate_parser = subparsers.add_parser("estimate", help="Estimate tokens for files or directories before reading")
    estimate_parser.add_argument("paths", nargs="+", help="Files or directories to size")
    estimate_parser.add_argument("--limit", type=int, default=200000, help="Model context window in tokens")

    args = parser.parse_args()

    if args.command == "analyze":
        data = load_json_file(args.context_file)
        messages = data if isinstance(data, list) else data.get("messages", [])
        result = analyze_context(messages, args.limit, args.keywords)
        print(json.dumps({
            "total_tokens": result.total_tokens,
            "token_limit": result.token_limit,
            "utilization": f"{result.utilization:.1%}",
            "health_status": result.health_status.value,
            "health_score": f"{result.health_score:.2f}",
            "degradation_risk": f"{result.degradation_risk:.2f}",
            "poisoning_risk": f"{result.poisoning_risk:.2f}",
            "recommendations": result.recommendations
        }, indent=2))

    elif args.command == "budget":
        result = calculate_budget(args.system, args.tools, args.docs, args.history, args.buffer)
        print(json.dumps(result, indent=2))

    elif args.command == "estimate":
        result = estimate_paths(args.paths, args.limit)
        print(json.dumps(result, indent=2))
        # Errors always surface on stderr (e.g. a truncation notice alongside a
        # successful partial result). Exit 1 only when nothing usable came back —
        # an empty directory with zero errors is a legitimate empty result, not a failure.
        for err in result["errors"]:
            print(f"Error: {err}", file=sys.stderr)
        if result["errors"] and not result["files"]:
            sys.exit(1)


if __name__ == "__main__":
    main()
