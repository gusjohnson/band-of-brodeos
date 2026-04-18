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

After the next round finishes on Music League:

1. Export the round's HTM file from Music League (same way you got Round 1).
2. Start a fresh chat with Claude, upload:
   - The new round's HTM file
   - The current `history.json`
3. Ask Claude to add the round to the history and generate the new round page.
4. You'll get back: an updated `history.json` and a new `round-N.html` file.
5. Commit both to your repo (drop them in, push, or edit directly on github.com).
6. Also update `round-1.html` (and any previous rounds') nav bar to include the new round — or ask Claude to do it for you.

## Local preview

To test changes before pushing:

```
cd brodeos-site
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.
