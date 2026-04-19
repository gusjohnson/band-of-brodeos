# Band of Brodeos — Music League site

This repo is a static GitHub Pages site showing Music League round results.

## When I ask you to "add round N":

1. Find the new round's HTM file in `rounds-raw/round-N.htm`.
2. Parse it (see `scripts/parse_round.py` for the BeautifulSoup approach — 
   song-level containers are `div.card.mb-4`, vote rows live in the 
   `card-footer` element of each).
3. Append the parsed round to `history.json`. Don't reorder existing rounds.
4. Create `round-N.html` by copying `round-1.html` and changing:
   - The `<title>` tag
   - The `renderRoundPage(1)` call at the bottom
   - Which nav `<a>` has the `active` class
5. Update the nav bar in ALL existing `round-*.html` files to include a 
   link to the new round.
6. Validate: vote sums should equal reported points for every song. 
   If any don't, stop and tell me — something's wrong with the parse.
7. Don't commit. Let me review the diff first.

## What NOT to change:
- `styles.css` and `app.js` are stable. Don't edit unless I ask.
- The `history.json` schema — existing rounds should be byte-identical 
  after your edit.

## Running locally:
`python3 -m http.server 8000` from repo root, then open localhost:8000.
