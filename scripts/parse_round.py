#!/usr/bin/env python3
"""
Parse a Music League round HTM export and append it to history.json.

Usage:
    python3 scripts/parse_round.py <round_number> [theme] [description]

    Theme and description are normally read from the HTM file itself (the
    <title> tag and the data-description attribute). Pass them as CLI args
    only if you want to override the parsed values.

Example:
    python3 scripts/parse_round.py 5
    python3 scripts/parse_round.py 5 "Custom Theme" "Custom description"

Expects:
    - rounds-raw/round-<N>.htm to exist
    - history.json at repo root (will be created if missing)

Validates:
    - Each song's vote sum must equal its reported total points.
    - Round number must not already exist in history.json.

Exits nonzero on any validation failure — does not write a partial result.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: BeautifulSoup not installed. Run: pip install beautifulsoup4", file=sys.stderr)
    sys.exit(1)


REPO_ROOT = Path(__file__).resolve().parent.parent
HISTORY_PATH = REPO_ROOT / "history.json"
RAW_DIR = REPO_ROOT / "rounds-raw"
PAGE_TEMPLATE = REPO_ROOT / "round-1.html"


def parse_round(htm_path: Path) -> tuple[list[dict], str | None, str | None]:
    """Parse a Music League round HTM file into (songs, theme, description)."""
    with open(htm_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f, "html.parser")

    # Theme is the last `|`-separated segment of the <title> tag.
    # e.g. "Music League | The Band of Brodeos | Movie Soundtrack" → "Movie Soundtrack"
    title_elem = soup.find("title")
    theme = None
    if title_elem:
        parts = [p.strip() for p in title_elem.get_text().split("|")]
        if len(parts) >= 2:
            theme = parts[-1]

    # Strip scripts and styles so they don't pollute text extraction
    for tag in soup(["script", "style"]):
        tag.decompose()

    # Round description lives in a card-text p with a data-description attribute
    desc_elem = soup.find("p", attrs={"data-description": True})
    description = desc_elem.get("data-description") if desc_elem else None

    # Each song is wrapped in a `card mb-4` div
    song_containers = soup.find_all(
        "div", class_=lambda c: c and "card" in c and "mb-4" in c
    )

    if not song_containers:
        raise ValueError("No song containers found. HTM structure may have changed.")

    songs = []
    for sc in song_containers:
        song = parse_song_container(sc)
        if song:
            songs.append(song)

    return songs, theme, description


def parse_song_container(sc) -> dict | None:
    """Parse a single song container div into a dict."""
    # Title
    title_elem = sc.find("h6", class_=lambda c: c and "card-title" in c)
    if not title_elem:
        return None
    title = title_elem.get_text(strip=True)

    # Artist and album from card-text paragraphs
    card_texts = sc.find_all("p", class_=lambda c: c and "card-text" in c)
    artist = card_texts[0].get_text(strip=True) if len(card_texts) > 0 else ""
    album = card_texts[1].get_text(strip=True) if len(card_texts) > 1 else ""

    # Voter count text like "10 voters"
    voters_elem = sc.find(string=re.compile(r"\d+\s+voters?"))
    voter_count = None
    if voters_elem:
        m = re.match(r"(\d+)\s+voters?", voters_elem.strip())
        if m:
            voter_count = int(m.group(1))

    # Rank card contains both the rank number (in the class name) and submitter
    rank_card = sc.find("div", class_=re.compile(r"card mt-3 rank-\d+"))
    rank = None
    submitter = None
    disqualified = False
    if rank_card:
        rm = re.search(r"rank-(\d+)", " ".join(rank_card.get("class", [])))
        if rm:
            rank = int(rm.group(1))
        sub_name = rank_card.find(
            "h6", class_=lambda c: c and "fw-semibold" in c
        )
        if sub_name:
            submitter = sub_name.get_text(strip=True)
        # When a submitter doesn't vote, Music League shows a "Did not vote" badge
        # in their rank card and disqualifies their song (positive votes are dropped).
        if rank_card.find(string=re.compile(r"Did not vote", re.IGNORECASE)):
            disqualified = True

    # Score: an h3 inside the col-auto text-end block (sibling of the "X voters" p).
    # Disqualified songs render as <h3><s>{original}</s>{final}</h3> — the strike
    # holds the would-have-been score and the bare text holds the actual final score.
    total_points = None
    original_points = None
    score_block = sc.find("div", class_=lambda c: c and "col-auto" in c and "text-end" in c)
    score_h3 = score_block.find("h3") if score_block else None
    if score_h3:
        struck = score_h3.find("s")
        if struck:
            struck_txt = struck.get_text(strip=True)
            if re.match(r"^-?\d+$", struck_txt):
                original_points = int(struck_txt)
        # Build the final-score text from h3 children, skipping <s> content
        final_txt = "".join(
            "" if getattr(c, "name", None) == "s" else (c.get_text() if hasattr(c, "get_text") else str(c))
            for c in score_h3.children
        ).strip()
        if re.match(r"^-?\d+$", final_txt):
            total_points = int(final_txt)

    # Individual votes from footer. Each voter occupies a single .row block;
    # within it: <b> = name, <span class="text-break ws-pre-wrap"> = comment
    # (optional), <h6> = vote (optional — commenters may not have voted).
    footer = sc.find("div", class_=lambda c: c and "card-footer" in c)
    votes = []
    if footer:
        rows = footer.find_all(
            "div", class_=lambda c: c and "row" in c and "align-items-start" in c
        )
        for row in rows:
            name_elem = row.find("b")
            if not name_elem:
                continue
            name = name_elem.get_text(strip=True)
            comment_elem = row.find("span", class_=lambda c: c and "text-break" in c)
            comment = comment_elem.get_text(strip=True) if comment_elem else None
            vote_elem = row.find("h6")
            if vote_elem and re.match(r"^-?\d+$", vote_elem.get_text(strip=True)):
                vote = int(vote_elem.get_text(strip=True))
            else:
                vote = 0
            votes.append({"voter": name, "vote": vote, "comment": comment})

    song = {
        "rank": rank,
        "title": title,
        "artist": artist,
        "album": album,
        "submitter": submitter,
        "total_points": total_points,
    }
    if disqualified:
        song["disqualified"] = True
        song["original_points"] = original_points
    song["voter_count"] = voter_count
    song["votes"] = votes
    return song


def validate_songs(songs: list[dict]) -> list[str]:
    """Return a list of validation error messages. Empty list = all good."""
    errors = []
    for s in songs:
        if s["rank"] is None:
            errors.append(f"Song '{s['title']}' is missing rank.")
        if s["submitter"] is None:
            errors.append(f"Song '{s['title']}' is missing submitter.")
        if s["total_points"] is None:
            errors.append(f"Song '{s['title']}' is missing total_points.")
            continue
        vote_sum = sum(v["vote"] for v in s["votes"])
        if s.get("disqualified"):
            # Submitter didn't vote → positive votes are dropped, only negatives count.
            negative_sum = sum(v["vote"] for v in s["votes"] if v["vote"] < 0)
            if s["total_points"] != negative_sum:
                errors.append(
                    f"Song '{s['title']}' (rank {s['rank']}, disqualified): "
                    f"final total is {s['total_points']} but sum of negative votes is {negative_sum}."
                )
            if s.get("original_points") is not None and vote_sum != s["original_points"]:
                errors.append(
                    f"Song '{s['title']}' (rank {s['rank']}, disqualified): "
                    f"vote sum is {vote_sum} but struck-through original is {s['original_points']}."
                )
        elif vote_sum != s["total_points"]:
            errors.append(
                f"Song '{s['title']}' (rank {s['rank']}): "
                f"vote sum is {vote_sum} but reported total is {s['total_points']}."
            )
    return errors


def generate_round_page(round_number: int) -> Path:
    """Create round-<N>.html from the round-1 template."""
    out_path = REPO_ROOT / f"round-{round_number}.html"
    if out_path.exists():
        raise FileExistsError(f"{out_path.name} already exists — refusing to overwrite.")

    html = PAGE_TEMPLATE.read_text(encoding="utf-8")

    # <title>Round 1 — ...</title>  →  <title>Round N — ...</title>
    html = re.sub(r"<title>Round \d+", f"<title>Round {round_number}", html, count=1)

    # Drop any existing class="active" on round nav links so only the new one is active.
    html = re.sub(r'(<a href="round-\d+\.html")\s+class="active"', r"\1", html)

    # Mark the new round's link active (it was already inserted by update_nav_links).
    html = re.sub(
        rf'<a href="round-{round_number}\.html">Round {round_number}</a>',
        f'<a href="round-{round_number}.html" class="active">Round {round_number}</a>',
        html,
        count=1,
    )

    # renderRoundPage(1) → renderRoundPage(N)
    html = re.sub(r"renderRoundPage\(\d+\)", f"renderRoundPage({round_number})", html, count=1)

    out_path.write_text(html, encoding="utf-8")
    return out_path


def update_nav_links(round_number: int) -> list[Path]:
    """Add a Round <N> link to the nav in every existing round-*.html and index.html."""
    new_link = f'    <a href="round-{round_number}.html">Round {round_number}</a>'
    nav_files = sorted(REPO_ROOT.glob("round-*.html")) + [REPO_ROOT / "index.html"]
    touched = []
    for path in nav_files:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if f'href="round-{round_number}.html"' in text:
            continue  # link already present
        # Insert after the last existing round-*.html nav link
        pattern = re.compile(r'([ \t]*<a href="round-\d+\.html"[^>]*>Round \d+</a>\n)')
        matches = list(pattern.finditer(text))
        if not matches:
            continue
        last = matches[-1]
        updated = text[: last.end()] + new_link + "\n" + text[last.end():]
        path.write_text(updated, encoding="utf-8")
        touched.append(path)
    return touched


def load_history() -> dict:
    if HISTORY_PATH.exists():
        with open(HISTORY_PATH, "r") as f:
            return json.load(f)
    return {"league": "The Band of Brodeos", "rounds": []}


def save_history(history: dict) -> None:
    with open(HISTORY_PATH, "w") as f:
        json.dump(history, f, indent=2)


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    try:
        round_number = int(sys.argv[1])
    except ValueError:
        print(f"ERROR: round_number must be an integer, got '{sys.argv[1]}'", file=sys.stderr)
        sys.exit(1)

    theme_arg = sys.argv[2] if len(sys.argv) > 2 else None
    description_arg = sys.argv[3] if len(sys.argv) > 3 else None

    htm_path = RAW_DIR / f"round-{round_number}.htm"
    if not htm_path.exists():
        print(f"ERROR: {htm_path} not found.", file=sys.stderr)
        sys.exit(1)

    history = load_history()
    existing = {r["round_number"] for r in history["rounds"]}
    if round_number in existing:
        print(
            f"ERROR: Round {round_number} already exists in history.json. "
            f"Delete it first if you want to re-parse.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Parsing {htm_path}...")
    songs, parsed_theme, parsed_desc = parse_round(htm_path)
    print(f"  Found {len(songs)} songs.")

    theme = theme_arg if theme_arg is not None else parsed_theme
    if not theme:
        print(
            "ERROR: Could not extract theme from HTM <title> tag. "
            "Pass it explicitly: python3 scripts/parse_round.py <N> \"<theme>\"",
            file=sys.stderr,
        )
        sys.exit(1)
    description = description_arg if description_arg is not None else (parsed_desc or "")

    errors = validate_songs(songs)
    if errors:
        print("\nValidation FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        print("\nNo changes written to history.json.", file=sys.stderr)
        sys.exit(1)

    # Sort songs by rank for consistency
    songs.sort(key=lambda s: s["rank"])

    new_round = {
        "round_number": round_number,
        "theme": theme,
        "description": description,
        "songs": songs,
    }
    history["rounds"].append(new_round)
    history["rounds"].sort(key=lambda r: r["round_number"])

    save_history(history)
    print(f"\n✓ Round {round_number} '{theme}' added to history.json.")
    print(f"  Winner: {songs[0]['submitter']} — \"{songs[0]['title']}\" ({songs[0]['total_points']} pts)")
    print(f"  Total votes: {sum(s['voter_count'] or 0 for s in songs)}")

    touched = update_nav_links(round_number)
    print(f"\n✓ Added Round {round_number} nav link to {len(touched)} file(s).")
    page_path = generate_round_page(round_number)
    print(f"✓ Created {page_path.name}.")


if __name__ == "__main__":
    main()
