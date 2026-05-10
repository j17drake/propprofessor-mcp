#!/usr/bin/env python3
"""
Sharp Consensus Multi-Window Analyzer for PropProfessor.

Queries a single wide lookback (48h default) and segments line history
across multiple time windows to detect sustained sharp book movement.

Usage:
  python3 scripts/sharp-consensus-multi-window.py [--sport TENNIS] [--book NoVigApp]
      [--sharp-books PINNACLE,BETONLINE,BOOKMAKER] [--windows 1,2,6,12,24,48]
      [--lookback 48] [--limit 100] [--market Moneyline] [--live] [--min-consensus 2]
      [--dashboard-url http://127.0.0.1:9119]

Outputs plays ranked by multi-window sharp consensus strength.
"""

import argparse
import http.cookiejar
import json
import sys
import time
import urllib.parse
import urllib.request


def load_auth_cookies(auth_file=None):
    """Load PropProfessor auth cookies from auth.json for API requests."""
    if auth_file is None:
        # Default path relative to the script
        import os
        script_dir = os.path.dirname(os.path.abspath(__file__))
        auth_file = os.path.join(script_dir, "auth.json")
        if not os.path.exists(auth_file):
            # Fallback to known path
            auth_file = os.path.expanduser("~/Desktop/propprofessor-mcp/auth.json")

    if not os.path.exists(auth_file):
        return None

    try:
        with open(auth_file) as f:
            data = json.load(f)
        cookies = data.get("cookies", [])
        if not cookies:
            return None

        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
        return cookie_str
    except Exception:
        return None


def fetch_ranked_screen(dashboard_url, league, market, books, lookback_hours,
                        limit, include_all, is_live, debug, auth_cookies=None):
    """Fetch ranked screen data from the PropProfessor dashboard API."""
    params = {
        "league": league,
        "market": market,
        "books": ",".join(books),
        "lookbackHours": str(lookback_hours),
        "limit": str(limit),
        "includeAll": str(include_all).lower(),
        "is_live": str(is_live).lower(),
        "debug": str(debug).lower(),
    }
    url = f"{dashboard_url.rstrip('/')}/api/screen-odds-ranked?{urllib.parse.urlencode(params)}"

    try:
        req = urllib.request.Request(url)
        if auth_cookies:
            req.add_header("Cookie", auth_cookies)
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Connection failed: {e.reason}", file=sys.stderr)
        sys.exit(1)

    outer = json.loads(raw)
    inner = json.loads(outer["result"])
    return inner


def window_direction(history_points, window_hours, now_ms):
    """Check direction within a specific time window."""
    cutoff = now_ms - (window_hours * 60 * 60 * 1000)
    in_window = [h for h in history_points if h.get("time", 0) >= cutoff]
    if len(in_window) < 2:
        return None, 0

    opening = in_window[0].get("odds")
    current = in_window[-1].get("odds")
    if opening is None or current is None:
        return None, 0

    # current < opening = supportive (odds moving toward the pick)
    direction = "supportive" if current < opening else "adverse"
    pct = round(abs(opening - current) / abs(opening) * 100, 1) if opening != 0 else 0
    return direction, pct


def get_novig_odds(row):
    """Extract NoVigApp odds for the pick in this row."""
    pick = row.get("participant", "")
    selections = row.get("selections", {})
    for key, sel in selections.items():
        novig = sel.get("odds", {}).get("NoVigApp")
        if novig:
            if sel.get("selection1") == pick:
                return novig.get("odds1")
            else:
                return novig.get("odds2")
    return None


def analyze_multi_window(rows, sharp_books, windows, now_ms):
    """Analyze all rows for multi-window sharp consensus."""
    results = []
    for r in rows:
        pick = r.get("participant", "?")
        game = f"{r.get('homeTeam','?')} vs {r.get('awayTeam','?')}"
        start = r.get("start", "?")
        novig_odds = get_novig_odds(r)

        if novig_odds is None:
            continue

        history = r.get("filteredLineHistory", [])
        if not history:
            continue

        # Per-book window analysis
        book_windows = {}
        for sb in sharp_books:
            sb_hist = [h for h in history if h.get("book") == sb]
            if len(sb_hist) < 2:
                continue

            wr = {}
            for w in windows:
                direction, pct = window_direction(sb_hist, w, now_ms)
                if direction:
                    # Get the open/current for this window
                    cutoff = now_ms - (w * 60 * 60 * 1000)
                    in_window = [h for h in sb_hist if h.get("time", 0) >= cutoff]
                    open_odds = in_window[0].get("odds")
                    cur_odds = in_window[-1].get("odds")
                    wr[f"{w}h"] = {
                        "dir": direction,
                        "pct": pct,
                        "open": open_odds,
                        "cur": cur_odds,
                    }

            if wr:
                book_windows[sb] = wr

        if not book_windows:
            continue

        # Count supportive windows per book
        book_supportive_count = {}
        for sb, wr in book_windows.items():
            book_supportive_count[sb] = sum(1 for v in wr.values() if v["dir"] == "supportive")

        # Consensus: which windows have ALL books supportive?
        consensus_windows = []
        for w in windows:
            wk = f"{w}h"
            if all(
                wk in book_windows.get(sb, {}) and book_windows[sb][wk]["dir"] == "supportive"
                for sb in book_windows
            ):
                consensus_windows.append(wk)

        total_supportive = sum(book_supportive_count.values())

        results.append({
            "pick": pick,
            "game": game,
            "start": start[11:16] if len(start) > 11 else start,
            "novig_odds": novig_odds,
            "book_windows": book_windows,
            "book_supportive_count": book_supportive_count,
            "consensus_windows": consensus_windows,
            "total_supportive": total_supportive,
            "score": r.get("screenScore", 0) or 0,
        })

    # Sort: consensus count, then total supportive, then score
    results.sort(key=lambda x: (
        -len(x["consensus_windows"]),
        -x["total_supportive"],
        -x["score"],
    ))
    return results


def format_output(results, sharp_books, windows, min_consensus):
    """Format results for terminal output."""
    # Filter by minimum consensus
    filtered = [r for r in results if len(r["consensus_windows"]) >= min_consensus]

    lines = []
    lines.append(f"{'=' * 100}")
    lines.append(f"SHARP CONSENSUS MULTI-WINDOW ANALYSIS")
    lines.append(f"Total plays analyzed: {len(results)} | Showing consensus >= {min_consensus} windows: {len(filtered)}")
    lines.append(f"{'=' * 100}")

    if not filtered:
        lines.append("\nNo plays meet the minimum consensus threshold.")
        return "\n".join(lines)

    for r in filtered:
        cons_count = len(r["consensus_windows"])
        total_supp = r["total_supportive"]
        if cons_count >= 4:
            tag = "VERY STRONG"
        elif cons_count >= 2:
            tag = "STRONG"
        elif total_supp >= 3:
            tag = "GOOD"
        elif total_supp >= 1:
            tag = "MIXED"
        else:
            tag = "ADVERSE"

        lines.append(f"\n[{tag}] Score:{r['score']} | {r['pick']} @ {r['novig_odds']}")
        lines.append(f"  {r['start']} | {r['game']}")

        for sb in sharp_books:
            wr = r["book_windows"].get(sb, {})
            if not wr:
                continue
            parts = []
            for wk in [f"{w}h" for w in windows]:
                if wk in wr:
                    d = wr[wk]["dir"]
                    p = wr[wk]["pct"]
                    o = wr[wk]["open"]
                    c = wr[wk]["cur"]
                    icon = "S" if d == "supportive" else "A"
                    parts.append(f"{wk}:{icon}{p}%({o}->{c})")
                else:
                    parts.append(f"{wk}:---")
            supp_count = r["book_supportive_count"].get(sb, 0)
            lines.append(f"  {sb} [{supp_count}/{len(wr)} supp]: {' | '.join(parts)}")

        if r["consensus_windows"]:
            lines.append(f"  >>> ALL-SHARP CONSENSUS: {', '.join(r['consensus_windows'])} <<<")

    # Summary
    lines.append(f"\n{'=' * 100}")
    lines.append("SUMMARY:")
    lines.append(f"  Very strong (4+ consensus): {sum(1 for r in results if len(r['consensus_windows']) >= 4)}")
    lines.append(f"  Strong (2-3 consensus): {sum(1 for r in results if 2 <= len(r['consensus_windows']) < 4)}")
    lines.append(f"  Good (3+ total supp, no consensus): {sum(1 for r in results if r['total_supportive'] >= 3 and len(r['consensus_windows']) < 2)}")
    lines.append(f"  Mixed (1-2 total supp): {sum(1 for r in results if 1 <= r['total_supportive'] < 3)}")
    lines.append(f"  All adverse: {sum(1 for r in results if r['total_supportive'] == 0)}")

    return "\n".join(lines)


def format_json(results):
    """Output as JSON for programmatic consumption."""
    output = []
    for r in results:
        output.append({
            "pick": r["pick"],
            "game": r["game"],
            "start": r["start"],
            "novig_odds": r["novig_odds"],
            "score": r["score"],
            "consensus_windows": r["consensus_windows"],
            "total_supportive": r["total_supportive"],
            "book_windows": {
                sb: {wk: v["dir"] for wk, v in wr.items()}
                for sb, wr in r["book_windows"].items()
            },
        })
    return json.dumps(output, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Sharp Consensus Multi-Window Analyzer")
    parser.add_argument("--sport", default="Tennis", help="League/sport (default: Tennis)")
    parser.add_argument("--book", default="NoVigApp", help="Target execution book (default: NoVigApp)")
    parser.add_argument("--sharp-books", default="Pinnacle,BetOnline,BookMaker",
                        help="Comma-separated sharp books for consensus (default: Pinnacle,BetOnline,BookMaker)")
    parser.add_argument("--windows", default="1,2,6,12,24,48",
                        help="Comma-separated time windows in hours (default: 1,2,6,12,24,48)")
    parser.add_argument("--lookback", type=int, default=48,
                        help="Total lookback hours for API query (default: 48)")
    parser.add_argument("--limit", type=int, default=100,
                        help="Max rows to fetch (default: 100)")
    parser.add_argument("--market", default="Moneyline", help="Market filter (default: Moneyline)")
    parser.add_argument("--live", action="store_true", help="Query live odds")
    parser.add_argument("--min-consensus", type=int, default=0,
                        help="Minimum consensus windows required (default: 0, show all)")
    parser.add_argument("--dashboard-url", default="http://127.0.0.1:9119",
                        help="PropProfessor dashboard URL (default: http://127.0.0.1:9119)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--no-debug", action="store_true", help="Disable debug in API request")

    args = parser.parse_args()

    sharp_books = [b.strip() for b in args.sharp_books.split(",")]
    windows = [int(w.strip()) for w in args.windows.split(",")]
    now_ms = int(time.time() * 1000)

    print(f"Fetching {args.sport} {args.market} | lookback={args.lookback}h | windows={windows}h | sharp={sharp_books}",
          file=sys.stderr)

    data = fetch_ranked_screen(
        dashboard_url=args.dashboard_url,
        league=args.sport,
        market=args.market,
        books=[args.book] + sharp_books,
        lookback_hours=args.lookback,
        limit=args.limit,
        include_all=True,
        is_live=args.live,
        debug=not args.no_debug,
    )

    rows = data.get("result", [])
    results = analyze_multi_window(rows, sharp_books, windows, now_ms)

    if args.json:
        print(format_json(results))
    else:
        print(format_output(results, sharp_books, windows, args.min_consensus))


if __name__ == "__main__":
    main()
