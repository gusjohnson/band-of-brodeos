# The Band of Brodeos — Music League site

Static site showing Music League round results and cumulative standings.

## File layout

```
brodeos-site/
├── index.html         # league overview + cumulative leaderboard
├── round-1.html       # Round 1 detail page
├── round-2.html       # (drop in new rounds here)
├── history.json       # source of truth — all rounds' data
├── styles.css         # shared styles
└── app.js             # shared rendering logic
```

All pages read from `history.json`. Adding a new round is mostly a matter of updating that one file.

## One-time setup: publishing with GitHub Pages

1. Create a new GitHub repo (public). Anything like `brodeos-league` works.
2. Upload all the files in this folder to the root of the repo.
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to "Deploy from a branch", pick your default branch (usually `main`), folder `/ (root)`, save.
5. Wait ~1 minute. Your site will be at `https://<your-username>.github.io/<repo-name>/`.

That's it. Share the URL with the league.

## Adding a new round

One-time setup: `pip install beautifulsoup4`.

After the next round finishes on Music League:

Throughout these steps, `<N>` is the new round number (e.g. `5` if you're adding the 5th round).

1. **Download the round page.** Save As from the round's page in Music League. It lands as `Music League _ The Band of Brodeos _ <round name>.htm`. Drop it into `rounds-raw/`.
2. **Give it the name the script expects.** Copy (or rename) it to `rounds-raw/round-<N>.htm` — for round 5, that's `rounds-raw/round-5.htm`.
3. **Run the parser.** From the repo root:
   ```
   python3 scripts/parse_round.py <N>
   ```
   For example, for round 5: `python3 scripts/parse_round.py 5`.

   The theme and description are read from the HTM file (the `<title>` tag and the round's `data-description`). You can override them if you want: `python3 scripts/parse_round.py 5 "Custom Theme" "Custom description"`.

   This does everything:
   - parses the HTM and appends the round to `history.json` (validating that each song's individual votes sum to its reported total — exits with an error and writes nothing if off)
   - generates `round-<N>.html` from the `round-1.html` template
   - adds a `Round <N>` nav link to every existing `round-*.html` and to `index.html`
4. **Preview locally** (see below), eyeball the new round, then commit and push.

Don't edit `app.js`, `styles.css`, or existing entries in `history.json` — just append.

## Local preview

To test changes before pushing:

```
cd brodeos-site
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.
