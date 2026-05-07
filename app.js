// Band of Brodeos — Music League dashboard logic
// Every page loads history.json and renders the appropriate view.

// ----- Theme handling -----
(function initTheme() {
  const saved = localStorage.getItem('brodeos-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  if (theme === 'dark') document.body.classList.add('dark');
})();

function toggleTheme() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('brodeos-theme', isDark ? 'dark' : 'light');
  // Rerun any chart rebuilds needed
  if (window.__rerenderCharts) window.__rerenderCharts();
}

// ----- Data loading -----
async function loadHistory() {
  try {
    const res = await fetch('history.json');
    if (!res.ok) throw new Error('history.json not found');
    return await res.json();
  } catch (err) {
    console.error('Failed to load history:', err);
    return null;
  }
}

// ----- Chart helpers -----
function chartColors() {
  const isDark = document.body.classList.contains('dark');
  return {
    text: isDark ? '#e8e6e0' : '#2c2c2a',
    grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    isDark
  };
}

function pointsColor(v) {
  if (v >= 10) return '#3b6d11';
  if (v >= 7) return '#639922';
  if (v >= 4) return '#97c459';
  if (v >= 0) return '#b4b2a9';
  return '#e24b4a';
}

function voteCellColor(v) {
  if (v === 0) return 'rgba(127,127,127,0.12)';
  if (v >= 3) return '#3b6d11';
  if (v === 2) return '#639922';
  if (v === 1) return '#97c459';
  if (v === -1) return '#f09595';
  if (v === -2) return '#e24b4a';
  return '#a32d2d';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// ----- Tab switching -----
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.querySelector(`.panel[data-panel="${btn.dataset.tab}"]`);
      if (panel) panel.classList.add('active');
    });
  });
}

// ===== ROUND PAGE =====
async function renderRoundPage(roundNumber) {
  const history = await loadHistory();
  if (!history) {
    document.getElementById('content').innerHTML =
      '<div class="error">Could not load league data. Check that history.json is present.</div>';
    return;
  }

  const round = history.rounds.find(r => r.round_number === roundNumber);
  if (!round) {
    document.getElementById('content').innerHTML =
      `<div class="error">Round ${roundNumber} not found.</div>`;
    return;
  }

  // Update header
  document.getElementById('round-title').textContent = `Round ${round.round_number} — ${round.theme}`;
  document.getElementById('round-desc').textContent =
    `${round.description} · ${round.songs.length} songs · ${round.songs.reduce((a,s) => a + s.voter_count, 0)} votes cast`;

  // Build leaderboard data
  const lb = round.songs.slice().sort((a,b) => b.total_points - a.total_points);

  // Voter stats
  const voterStats = {};
  const players = new Set();
  round.songs.forEach(s => {
    players.add(s.submitter);
    s.votes.forEach(v => players.add(v.voter));
  });
  players.forEach(p => {
    voterStats[p] = {upvote_points: 0, downvote_points: 0, songs_voted: 0, negative_votes: 0, comments: 0};
  });
  round.songs.forEach(s => {
    s.votes.forEach(v => {
      const vs = voterStats[v.voter];
      vs.songs_voted++;
      if (v.vote > 0) vs.upvote_points += v.vote;
      if (v.vote < 0) { vs.downvote_points += Math.abs(v.vote); vs.negative_votes++; }
      if (v.comment) vs.comments++;
    });
  });

  // Vote matrix
  const matrix = {};
  round.songs.forEach(s => {
    s.votes.forEach(v => {
      if (!matrix[v.voter]) matrix[v.voter] = {};
      matrix[v.voter][s.submitter] = (matrix[v.voter][s.submitter] || 0) + v.vote;
    });
  });

  const sortedPlayers = Array.from(players).sort();
  const agreement = computeAgreement(round, sortedPlayers);
  const ctx = {round, lb, voterStats, matrix, agreement, players: sortedPlayers};

  renderLeaderboard(ctx);
  renderSongList(ctx);
  renderHeatmap(ctx);
  renderAgreementGrid(ctx);
  renderFunFacts(ctx);

  window.__rerenderCharts = () => {
    renderLeaderboard(ctx);
    renderAgreementGrid(ctx);
  };
}

function computeAgreement(round, players) {
  // For each song, snapshot per-voter vote (0 = didn't vote or submitter)
  const songVotes = round.songs.map(s => {
    const m = {};
    players.forEach(p => { m[p] = 0; });
    s.votes.forEach(v => { m[v.voter] = v.vote; });
    return {submitter: s.submitter, votes: m};
  });

  // Cosine similarity per pair, restricted to songs neither player submitted.
  // Cosine (vs. Pearson) treats "no vote" as a true zero: a song both
  // players skipped contributes nothing instead of dragging toward the mean.
  const agreement = {};
  players.forEach(a => {
    agreement[a] = {};
    players.forEach(b => {
      if (a === b) { agreement[a][b] = null; return; }
      let dot = 0, aMag = 0, bMag = 0, shared = 0;
      songVotes.forEach(sv => {
        if (sv.submitter === a || sv.submitter === b) return;
        const va = sv.votes[a], vb = sv.votes[b];
        dot += va * vb;
        aMag += va * va;
        bMag += vb * vb;
        if (va !== 0 && vb !== 0) shared++;
      });
      const sim = (aMag > 0 && bMag > 0) ? dot / Math.sqrt(aMag * bMag) : null;
      agreement[a][b] = sim === null ? null : {sim, shared};
    });
  });
  return agreement;
}

function renderLeaderboard({lb}) {
  const canvas = document.getElementById('leaderboardChart');
  if (!canvas) return;
  if (canvas._chart) canvas._chart.destroy();
  const colors = chartColors();
  canvas._chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: lb.map(s => s.submitter),
      datasets: [{
        label: 'Points',
        data: lb.map(s => s.total_points),
        backgroundColor: lb.map(s => pointsColor(s.total_points)),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: {
        legend: {display: false},
        tooltip: {callbacks: {
          label: ctx => `${ctx.parsed.x} points`,
          afterLabel: ctx => {
            const s = lb[ctx.dataIndex];
            return `"${s.title}" by ${s.artist}`;
          }
        }}
      },
      scales: {
        x: {ticks: {color: colors.text, font: {size: 12}}, grid: {color: colors.grid}},
        y: {ticks: {color: colors.text, font: {size: 13}}, grid: {display: false}}
      }
    }
  });
}

function renderSongList({round}) {
  const list = document.getElementById('songList');
  if (!list) return;
  list.innerHTML = '';
  round.songs.forEach(s => {
    const row = document.createElement('div');
    row.className = 'song-row';
    const ptsClass = s.total_points > 0 ? 'positive' : s.total_points < 0 ? 'negative' : 'neutral';
    row.innerHTML = `
      <div class="rank">${s.rank}</div>
      <div>
        <div class="title">${escapeHtml(s.title)}</div>
        <div class="meta">${escapeHtml(s.artist)} · submitted by ${escapeHtml(s.submitter)}</div>
      </div>
      <div class="pts ${ptsClass}">${s.total_points >= 0 ? '+' : ''}${s.total_points}<span class="vlbl">${s.voter_count} voters</span></div>
    `;
    const detail = document.createElement('div');
    detail.className = 'song-detail';
    detail.innerHTML = s.votes.map(v => {
      const cls = v.vote > 0 ? 'pos' : v.vote < 0 ? 'neg' : '';
      const vtxt = v.vote === 0 ? '—' : (v.vote > 0 ? '+' : '') + v.vote;
      return `<div class="vote-line"><div class="v ${cls}">${vtxt}</div><div><div>${escapeHtml(v.voter)}</div>${v.comment ? `<div class="comment">"${escapeHtml(v.comment)}"</div>` : ''}</div></div>`;
    }).join('');
    row.addEventListener('click', () => detail.classList.toggle('open'));
    list.appendChild(row);
    list.appendChild(detail);
  });
}

function renderHeatmap({players, matrix}) {
  const wrap = document.getElementById('heatmapWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'heatmap';
  grid.style.gridTemplateColumns = `minmax(140px, auto) repeat(${players.length}, minmax(40px, 1fr))`;

  // Corner
  const corner = document.createElement('div');
  corner.className = 'hm-label-col';
  corner.style.fontSize = '10px';
  corner.textContent = 'voter ↓ / submitter →';
  grid.appendChild(corner);

  // Column headers
  players.forEach(p => {
    const d = document.createElement('div');
    d.className = 'hm-label-row';
    d.textContent = p;
    d.style.height = '100px';
    grid.appendChild(d);
  });

  // Rows
  const isDark = document.body.classList.contains('dark');
  players.forEach(voter => {
    const lbl = document.createElement('div');
    lbl.className = 'hm-label-col';
    lbl.textContent = voter;
    grid.appendChild(lbl);

    players.forEach(sub => {
      const d = document.createElement('div');
      d.className = 'hm-cell';
      const v = (matrix[voter] && matrix[voter][sub] !== undefined) ? matrix[voter][sub] : null;

      if (voter === sub) {
        d.style.background = 'rgba(127,127,127,0.08)';
        d.style.color = isDark ? '#6a6a66' : '#b4b2a9';
        d.textContent = '–';
        d.title = `${voter} can't vote for themselves`;
      } else if (v === null) {
        d.style.background = 'rgba(127,127,127,0.05)';
        d.textContent = '';
        d.title = `${voter} didn't vote on ${sub}'s song`;
      } else {
        d.style.background = voteCellColor(v);
        d.style.color = Math.abs(v) >= 2 ? '#ffffff' : (isDark ? '#1a1a18' : '#2c2c2a');
        d.textContent = v === 0 ? '' : (v > 0 ? '+' : '') + v;
        d.title = `${voter} → ${sub}: ${v > 0 ? '+' : ''}${v}`;
      }
      grid.appendChild(d);
    });
  });

  wrap.appendChild(grid);
}

function agreementColor(v) {
  if (v >= 0.6) return '#3b6d11';
  if (v >= 0.3) return '#639922';
  if (v >= 0.1) return '#97c459';
  if (v > -0.1) return 'rgba(127,127,127,0.12)';
  if (v > -0.3) return '#f09595';
  if (v > -0.6) return '#e24b4a';
  return '#a32d2d';
}

function renderAgreementGrid({players, agreement}) {
  const wrap = document.getElementById('agreementWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'heatmap';
  grid.style.gridTemplateColumns = `minmax(140px, auto) repeat(${players.length}, minmax(46px, 1fr))`;

  const corner = document.createElement('div');
  corner.className = 'hm-label-col';
  grid.appendChild(corner);

  players.forEach(p => {
    const d = document.createElement('div');
    d.className = 'hm-label-row';
    d.textContent = p;
    d.style.height = '100px';
    grid.appendChild(d);
  });

  const isDark = document.body.classList.contains('dark');
  players.forEach(a => {
    const lbl = document.createElement('div');
    lbl.className = 'hm-label-col';
    lbl.textContent = a;
    grid.appendChild(lbl);

    players.forEach(b => {
      const d = document.createElement('div');
      d.className = 'hm-cell';
      const entry = agreement[a] && agreement[a][b];

      if (a === b) {
        d.style.background = 'rgba(127,127,127,0.08)';
        d.style.color = isDark ? '#6a6a66' : '#b4b2a9';
        d.textContent = '–';
      } else if (!entry) {
        d.style.background = 'rgba(127,127,127,0.05)';
        d.textContent = '';
        d.title = `${a} and ${b} have no shared votes`;
      } else {
        const {sim, shared} = entry;
        d.style.background = agreementColor(sim);
        d.style.color = Math.abs(sim) >= 0.3 ? '#ffffff' : (isDark ? '#e8e6e0' : '#2c2c2a');
        const short = sim >= 0 ? '+' + sim.toFixed(1).replace(/^0/, '') : '−' + Math.abs(sim).toFixed(1).replace(/^0/, '');
        d.textContent = short;
        d.title = `${a} ↔ ${b}: ${sim.toFixed(2)} (${shared} shared non-zero votes)`;
      }
      grid.appendChild(d);
    });
  });

  wrap.appendChild(grid);
}

function renderFunFacts({round, voterStats, lb}) {
  const grid = document.getElementById('funGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const facts = computeFunFacts(round, voterStats, lb);
  facts.forEach(f => {
    const c = document.createElement('div');
    c.className = 'fun-card';
    c.innerHTML = `
      <div class="label">${escapeHtml(f.label)}</div>
      <div class="headline">${escapeHtml(f.headline)}</div>
      <div class="detail">${escapeHtml(f.detail)}</div>
    `;
    grid.appendChild(c);
  });
}

function computeFunFacts(round, voterStats, lb) {
  const facts = [];
  const winner = lb[0], runnerUp = lb[1];

  const margin = winner.total_points - runnerUp.total_points;
  facts.push({
    label: 'Winning margin',
    headline: `${margin} ${margin === 1 ? 'point' : 'points'}`,
    detail: `${winner.submitter}'s "${winner.title}" edged out ${runnerUp.submitter}'s "${runnerUp.title}".`
  });

  // Polarizer: song that received both a 3-point vote AND a downvote
  const polarizers = round.songs
    .map(s => {
      const pos = s.votes.filter(v => v.vote > 0).reduce((a,b) => a + b.vote, 0);
      const neg = s.votes.filter(v => v.vote < 0).reduce((a,b) => a + b.vote, 0);
      const has3 = s.votes.some(v => v.vote === 3);
      const hasNeg = s.votes.some(v => v.vote < 0);
      return {s, pos, neg, has3, hasNeg};
    })
    .filter(p => p.has3 && p.hasNeg)
    .sort((a,b) => (b.pos - b.neg) - (a.pos - a.neg));
  if (polarizers.length) {
    const p = polarizers[0];
    facts.push({
      label: 'Polarizer',
      headline: `${p.s.submitter}'s "${p.s.title}"`,
      detail: `Pulled a 3-point vote AND a downvote — +${p.pos} from fans, ${p.neg} from detractors.`
    });
  }

  // Picked the winner: voters who gave a 3 to the winning song
  const winnerThreeVoters = winner.votes.filter(v => v.vote === 3).map(v => v.voter);
  if (winnerThreeVoters.length) {
    facts.push({
      label: 'Picked the winner',
      headline: winnerThreeVoters.join(' · '),
      detail: `Threw their 3 at ${winner.submitter}'s "${winner.title}".`
    });
  }

  // Backfired: voter whose 3-point pick finished in the bottom half
  const halfRank = Math.ceil(lb.length / 2);
  const backfires = [];
  round.songs.forEach(s => {
    if (s.rank > halfRank) {
      s.votes.forEach(v => {
        if (v.vote === 3) {
          backfires.push({voter: v.voter, title: s.title, rank: s.rank});
        }
      });
    }
  });
  backfires.sort((a,b) => b.rank - a.rank);
  if (backfires.length) {
    const w = backfires[0];
    facts.push({
      label: 'Backfired',
      headline: `${w.voter}'s 3 → "${w.title}"`,
      detail: `Finished #${w.rank} of ${lb.length} — high conviction, low return.`
    });
  }

  // Crowd pleaser: non-winner with the most distinct positive voters
  let crowdPleaserSong = null;
  const nonWinnerByReach = round.songs
    .filter(s => s !== winner)
    .map(s => ({s, n: s.votes.filter(v => v.vote > 0).length}))
    .sort((a,b) => b.n - a.n);
  if (nonWinnerByReach.length && nonWinnerByReach[0].n >= 4) {
    const cp = nonWinnerByReach[0];
    crowdPleaserSong = cp.s;
    facts.push({
      label: 'Crowd pleaser',
      headline: `${cp.s.submitter}'s "${cp.s.title}"`,
      detail: `${cp.n} voters gave it a positive vote — broad support that didn't quite top the chart.`
    });
  }

  // Unanimous love: every non-zero vote was positive. Prefer the winner (special: "won with no haters").
  const unanimous = round.songs
    .map(s => {
      const nonZero = s.votes.filter(v => v.vote !== 0);
      const pos = nonZero.filter(v => v.vote > 0);
      return {s, nonZero: nonZero.length, pos: pos.length};
    })
    .filter(u => u.nonZero >= 4 && u.pos === u.nonZero && u.s !== crowdPleaserSong);
  unanimous.sort((a,b) => {
    if (a.s === winner) return -1;
    if (b.s === winner) return 1;
    return b.pos - a.pos;
  });
  if (unanimous.length) {
    const u = unanimous[0];
    const isWin = u.s === winner;
    facts.push({
      label: 'Unanimous love',
      headline: `${u.s.submitter}'s "${u.s.title}"`,
      detail: isWin
        ? `Took the round with zero downvotes — ${u.pos} positive votes and not a single hater.`
        : `${u.pos} positive votes, zero downvotes — nobody had a bad word.`
    });
  }

  // Peanut gallery
  const commentCounts = Object.entries(voterStats).map(([n,s]) => [n, s.comments]).sort((a,b) => b[1] - a[1]);
  if (commentCounts[0][1] > 0) {
    facts.push({
      label: 'Peanut gallery champion',
      headline: `${commentCounts[0][0]} — ${commentCounts[0][1]} comments`,
      detail: 'Carried the chat energy this round.'
    });
  }

  // Wrote a novel: longest single comment
  let longestComment = null;
  round.songs.forEach(s => s.votes.forEach(v => {
    if (v.comment && (!longestComment || v.comment.length > longestComment.comment.length)) {
      longestComment = {voter: v.voter, comment: v.comment, title: s.title};
    }
  }));
  if (longestComment && longestComment.comment.length >= 60) {
    facts.push({
      label: 'Wrote a novel',
      headline: `${longestComment.voter} on "${longestComment.title}"`,
      detail: `"${longestComment.comment}"`
    });
  }

  // Downvote enthusiast — only when there's a clear leader (skip when everyone tied at the locked −2)
  const downRanked = Object.entries(voterStats).map(([n,s]) => [n, s.downvote_points]).sort((a,b) => b[1] - a[1]);
  if (downRanked.length >= 2 && downRanked[0][1] > 0 && downRanked[0][1] > downRanked[1][1]) {
    facts.push({
      label: 'Downvote enthusiast',
      headline: `${downRanked[0][0]} — ${downRanked[0][1]} downvote points`,
      detail: `Cast ${voterStats[downRanked[0][0]].negative_votes} negative votes this round.`
    });
  }

  // Rivalry
  const rivalry = {};
  round.songs.forEach(s => s.votes.forEach(v => {
    if (v.vote < 0) {
      const key = `${v.voter}→${s.submitter}`;
      rivalry[key] = (rivalry[key] || 0) + v.vote;
    }
  }));
  const worstPair = Object.entries(rivalry).sort((a,b) => a[1] - b[1])[0];
  if (worstPair && worstPair[1] <= -2) {
    const parts = worstPair[0].split('→');
    facts.push({
      label: 'Potential rivalry',
      headline: `${parts[0]} → ${parts[1]}: ${worstPair[1]}`,
      detail: 'Worst voter-to-submitter pairing this round. One to watch.'
    });
  }

  // Bottom of the pile
  const last = lb[lb.length - 1];
  if (last.total_points <= 0) {
    facts.push({
      label: 'Bottom of the pile',
      headline: `${last.submitter}'s "${last.title}"`,
      detail: `Finished at ${last.total_points} points.`
    });
  }

  return facts;
}

// ===== INDEX PAGE =====
async function renderIndexPage() {
  const history = await loadHistory();
  if (!history) {
    document.getElementById('content').innerHTML =
      '<div class="error">Could not load league data. Check that history.json is present.</div>';
    return;
  }

  // Render rounds list
  const list = document.getElementById('roundList');
  list.innerHTML = '';
  history.rounds.slice().reverse().forEach(r => {
    const winner = r.songs.slice().sort((a,b) => b.total_points - a.total_points)[0];
    const card = document.createElement('a');
    card.className = 'round-card';
    card.href = `round-${r.round_number}.html`;
    card.innerHTML = `
      <div class="round-num">Round ${r.round_number}</div>
      <div class="round-title">${escapeHtml(r.theme)}</div>
      <div class="round-meta">${r.songs.length} songs · ${r.songs.reduce((a,s) => a + s.voter_count, 0)} votes</div>
      <div class="round-winner">🏆 ${escapeHtml(winner.submitter)} — "${escapeHtml(winner.title)}" (${winner.total_points} pts)</div>
    `;
    list.appendChild(card);
  });

  // Cumulative leaderboard
  const cumulative = {};
  const roundsPlayed = {};
  history.rounds.forEach(r => {
    r.songs.forEach(s => {
      cumulative[s.submitter] = (cumulative[s.submitter] || 0) + s.total_points;
      roundsPlayed[s.submitter] = (roundsPlayed[s.submitter] || 0) + 1;
    });
  });
  const cumSorted = Object.entries(cumulative).sort((a,b) => b[1] - a[1]);

  // Rank delta vs. the standings after the previous round.
  // Positive = climbed, negative = dropped, null = newcomer, undefined = only one round played.
  const standingsHistory = computeStandingsHistory(history);
  const rankDelta = {};
  if (standingsHistory.length >= 2) {
    const last = standingsHistory[standingsHistory.length - 1];
    const prev = standingsHistory[standingsHistory.length - 2];
    Object.keys(last.ranks).forEach(p => {
      rankDelta[p] = prev.ranks[p] !== undefined ? prev.ranks[p] - last.ranks[p] : null;
    });
  }

  const canvas = document.getElementById('cumulativeChart');
  if (canvas && cumSorted.length) {
    if (canvas._chart) canvas._chart.destroy();
    const colors = chartColors();
    canvas._chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: cumSorted.map(c => c[0]),
        datasets: [{
          label: 'Total points',
          data: cumSorted.map(c => c[1]),
          backgroundColor: cumSorted.map(c => pointsColor(c[1] / Math.max(1, roundsPlayed[c[0]]))),
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: {
          legend: {display: false},
          tooltip: {callbacks: {
            label: ctx => `${ctx.parsed.x} total points`,
            afterLabel: ctx => {
              const player = cumSorted[ctx.dataIndex][0];
              const rounds = `across ${roundsPlayed[player]} round(s)`;
              const d = rankDelta[player];
              if (d === undefined) return rounds;
              if (d === null) return `${rounds} · new this round`;
              if (d === 0) return `${rounds} · rank unchanged`;
              const arrow = d > 0 ? `▲ +${d}` : `▼ ${d}`;
              return `${rounds} · rank ${arrow} from last round`;
            }
          }}
        },
        scales: {
          x: {ticks: {color: colors.text, font: {size: 12}}, grid: {color: colors.grid}},
          y: {
            ticks: {
              color: colors.text,
              font: {size: 13},
              callback: function(_, index) {
                const player = cumSorted[index][0];
                const d = rankDelta[player];
                if (d === undefined) return player;
                if (d === null) return `${player}  (NEW)`;
                if (d === 0) return `${player}  (–)`;
                if (d > 0) return `${player}  (▲${d})`;
                return `${player}  (▼${Math.abs(d)})`;
              }
            },
            grid: {display: false}
          }
        }
      }
    });
  }

  // League meta
  document.getElementById('leagueMeta').textContent =
    `${history.rounds.length} round${history.rounds.length !== 1 ? 's' : ''} · ${Object.keys(cumulative).length} players · ${history.rounds.reduce((a,r) => a + r.songs.length, 0)} total songs submitted`;

  renderMovementSection(history);

  window.__rerenderCharts = () => renderIndexPage();
}

// ----- Standings movement across rounds -----
const PLAYER_PALETTE = [
  '#9e00c4', '#3b6d11', '#a32d2d', '#d18c19', '#1f6feb', '#b854a3',
  '#0b8b8b', '#c46c2d', '#6b3eaa', '#5a8a2a', '#ad2861', '#246b4f',
  '#825a14', '#4a4f8c', '#7a1f47'
];

function computeStandingsHistory(history) {
  // For each round in order, compute cumulative points + rank for every player
  // who has submitted at least once by that round.
  const rounds = history.rounds.slice().sort((a, b) => a.round_number - b.round_number);
  const cumulative = {};
  const standings = [];
  rounds.forEach(r => {
    r.songs.forEach(s => {
      cumulative[s.submitter] = (cumulative[s.submitter] || 0) + s.total_points;
    });
    const sorted = Object.entries(cumulative).sort((a, b) => b[1] - a[1]);
    const ranks = {};
    sorted.forEach(([p], i) => { ranks[p] = i + 1; });
    standings.push({
      round_number: r.round_number,
      ranks,
      points: { ...cumulative }
    });
  });
  return standings;
}

function renderMovementSection(history) {
  const standings = computeStandingsHistory(history);
  const allPlayers = Array.from(
    new Set(history.rounds.flatMap(r => r.songs.map(s => s.submitter)))
  ).sort();
  renderRankChart(standings, allPlayers);
  renderMovers(standings, history);
}

function renderRankChart(standings, allPlayers) {
  const canvas = document.getElementById('rankChart');
  if (!canvas) return;
  if (canvas._chart) canvas._chart.destroy();
  const colors = chartColors();
  const labels = standings.map(s => `Round ${s.round_number}`);
  const maxRank = allPlayers.length;
  const datasets = allPlayers.map((p, i) => ({
    label: p,
    data: standings.map(s => s.ranks[p] ?? null),
    pointsData: standings.map(s => s.points[p] ?? null),
    borderColor: PLAYER_PALETTE[i % PLAYER_PALETTE.length],
    backgroundColor: PLAYER_PALETTE[i % PLAYER_PALETTE.length],
    borderWidth: 2.5,
    tension: 0.25,
    pointRadius: 4,
    pointHoverRadius: 6,
    spanGaps: false
  }));

  canvas._chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: {
          position: 'right',
          labels: { color: colors.text, font: { size: 12 }, boxWidth: 12, padding: 8 },
          onClick: (e, legendItem, legend) => {
            const chart = legend.chart;
            const clickedIndex = legendItem.datasetIndex;
            const allHidden = chart.data.datasets.every((ds, i) => i === clickedIndex || !chart.isDatasetVisible(i));
            chart.data.datasets.forEach((ds, i) => {
              chart.setDatasetVisibility(i, allHidden || i === clickedIndex);
            });
            chart.update();
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const ds = ctx.dataset;
              const pts = ds.pointsData[ctx.dataIndex];
              return `${ds.label}: rank #${ctx.parsed.y} (${pts} pts)`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: colors.text, font: { size: 12 } }, grid: { color: colors.grid } },
        y: {
          reverse: true,
          min: 1,
          max: maxRank,
          ticks: {
            color: colors.text,
            font: { size: 12 },
            stepSize: 1,
            callback: v => `#${v}`
          },
          grid: { color: colors.grid },
          title: { display: true, text: 'Cumulative rank', color: colors.text, font: { size: 12 } }
        }
      }
    }
  });
}

function renderMovers(standings, history) {
  const grid = document.getElementById('moversGrid');
  const note = document.getElementById('moversNote');
  if (!grid || !note) return;
  grid.innerHTML = '';

  if (standings.length < 2) {
    note.textContent = 'Mover comparisons appear once a second round is played.';
    return;
  }

  const last = standings[standings.length - 1];
  const prev = standings[standings.length - 2];
  const latestRound = history.rounds.find(r => r.round_number === last.round_number);

  // Round-N points per submitter (only for players who submitted this round)
  const roundPoints = {};
  latestRound.songs.forEach(s => { roundPoints[s.submitter] = s.total_points; });

  note.textContent = `How round ${last.round_number} reshuffled the cumulative standings vs. after round ${prev.round_number}.`;

  const movers = Object.keys(last.ranks).map(p => {
    const wasIn = prev.ranks[p] !== undefined;
    return {
      player: p,
      prevRank: wasIn ? prev.ranks[p] : null,
      newRank: last.ranks[p],
      delta: wasIn ? prev.ranks[p] - last.ranks[p] : null,
      isNew: !wasIn,
      roundPoints: roundPoints[p] ?? null
    };
  });

  // Risers (delta > 0)
  const risers = movers
    .filter(m => m.delta !== null && m.delta > 0)
    .sort((a, b) => b.delta - a.delta || a.newRank - b.newRank)
    .slice(0, 3);
  // Fallers (delta < 0)
  const fallers = movers
    .filter(m => m.delta !== null && m.delta < 0)
    .sort((a, b) => a.delta - b.delta || a.newRank - b.newRank)
    .slice(0, 3);
  // New entrants this round
  const newcomers = movers.filter(m => m.isNew);
  // Top scorer this round (single-round point haul)
  const topRound = movers
    .filter(m => m.roundPoints !== null)
    .sort((a, b) => b.roundPoints - a.roundPoints)[0];

  const cards = [];
  const top = risers[0];
  if (top) {
    const rest = risers.slice(1);
    cards.push({
      label: `Biggest climb in round ${last.round_number}`,
      headline: `${top.player} · #${top.prevRank} → #${top.newRank}`,
      detail: `Moved up ${top.delta} spot${top.delta !== 1 ? 's' : ''}.` +
        (rest.length ? ` Also climbing: ${rest.map(m => `${m.player} (${m.prevRank}→${m.newRank})`).join(', ')}.` : '')
    });
  }

  const worst = fallers[0];
  if (worst) {
    const rest = fallers.slice(1);
    cards.push({
      label: `Biggest slide in round ${last.round_number}`,
      headline: `${worst.player} · #${worst.prevRank} → #${worst.newRank}`,
      detail: `Dropped ${Math.abs(worst.delta)} spot${Math.abs(worst.delta) !== 1 ? 's' : ''}.` +
        (rest.length ? ` Also slipping: ${rest.map(m => `${m.player} (${m.prevRank}→${m.newRank})`).join(', ')}.` : '')
    });
  }

  if (topRound) {
    cards.push({
      label: `Biggest round-${last.round_number} haul`,
      headline: `${topRound.player} — ${topRound.roundPoints} pts`,
      detail: `Single-round total. Currently #${topRound.newRank} on the cumulative leaderboard.`
    });
  }

  const leader = movers.find(m => m.newRank === 1);
  if (leader && leader.prevRank === 1) {
    cards.push({
      label: 'Held the crown',
      headline: leader.player,
      detail: `Still #1 after round ${last.round_number}.`
    });
  } else if (leader && leader.delta !== null && leader.delta > 0) {
    cards.push({
      label: 'New #1',
      headline: leader.player,
      detail: `Took over the top spot from #${leader.prevRank}.`
    });
  }

  // Stood still: players whose rank didn't change (excluding newcomers)
  const stuck = movers.filter(m => m.delta === 0);
  if (stuck.length) {
    cards.push({
      label: 'Didn\'t budge',
      headline: stuck.map(m => `${m.player} (#${m.newRank})`).join(' · '),
      detail: `Rank unchanged from after round ${prev.round_number}.`
    });
  }

  if (newcomers.length) {
    cards.push({
      label: 'New this round',
      headline: newcomers.map(m => `${m.player} (#${m.newRank})`).join(' · '),
      detail: `First round submitting — entered the standings here.`
    });
  }

  cards.forEach(c => {
    const el = document.createElement('div');
    el.className = 'fun-card';
    el.innerHTML = `
      <div class="label">${escapeHtml(c.label)}</div>
      <div class="headline">${escapeHtml(c.headline)}</div>
      <div class="detail">${escapeHtml(c.detail)}</div>
    `;
    grid.appendChild(el);
  });
}
