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
  const ctx = {round, lb, voterStats, matrix, players: sortedPlayers};

  renderLeaderboard(ctx);
  renderSongList(ctx);
  renderHeatmap(ctx);
  renderVoterChart(ctx);
  renderFunFacts(ctx);

  window.__rerenderCharts = () => {
    renderLeaderboard(ctx);
    renderVoterChart(ctx);
  };
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

function renderVoterChart({voterStats}) {
  const canvas = document.getElementById('voterChart');
  if (!canvas) return;
  if (canvas._chart) canvas._chart.destroy();
  const colors = chartColors();
  const names = Object.keys(voterStats).sort((a,b) => voterStats[b].downvote_points - voterStats[a].downvote_points);
  canvas._chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: names,
      datasets: [
        {label: 'Upvote points given', data: names.map(n => voterStats[n].upvote_points), backgroundColor: '#639922', borderWidth: 0},
        {label: 'Downvote points given', data: names.map(n => -voterStats[n].downvote_points), backgroundColor: '#e24b4a', borderWidth: 0}
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: {
        legend: {labels: {color: colors.text, font: {size: 13}}},
        tooltip: {callbacks: {label: ctx => `${Math.abs(ctx.parsed.x)} points`}}
      },
      scales: {
        x: {ticks: {color: colors.text, font: {size: 12}, callback: v => Math.abs(v)}, grid: {color: colors.grid}},
        y: {ticks: {color: colors.text, font: {size: 13}}, grid: {display: false}}
      }
    }
  });
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

  facts.push({
    label: 'Winning margin',
    headline: `${winner.total_points - runnerUp.total_points} points`,
    detail: `${winner.submitter}'s "${winner.title}" edged out ${runnerUp.submitter}'s "${runnerUp.title}".`
  });

  let mostDivisive = null, divScore = -1;
  round.songs.forEach(s => {
    const pos = s.votes.filter(v => v.vote > 0).reduce((a,b) => a + b.vote, 0);
    const neg = s.votes.filter(v => v.vote < 0).reduce((a,b) => a + b.vote, 0);
    const score = pos - neg;
    if (score > divScore) { divScore = score; mostDivisive = {s, pos, neg}; }
  });
  facts.push({
    label: 'Most divisive',
    headline: `${mostDivisive.s.submitter}'s "${mostDivisive.s.title}"`,
    detail: `+${mostDivisive.pos} in upvotes and ${mostDivisive.neg} in downvotes. Opinions were strong in both directions.`
  });

  // Kingmaker: most 3-point votes
  const threeVotes = {};
  round.songs.forEach(s => s.votes.forEach(v => {
    if (v.vote === 3) threeVotes[v.voter] = (threeVotes[v.voter] || 0) + 1;
  }));
  const kingmakers = Object.entries(threeVotes);
  if (kingmakers.length) {
    facts.push({
      label: 'Kingmakers',
      headline: kingmakers.map(k => k[0]).join(', '),
      detail: 'Players who handed out a max 3-point vote this round. High conviction voters.'
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

  // Downvote enthusiast
  const downRanked = Object.entries(voterStats).map(([n,s]) => [n, s.downvote_points]).sort((a,b) => b[1] - a[1]);
  if (downRanked[0][1] > 0) {
    facts.push({
      label: 'Downvote enthusiast',
      headline: `${downRanked[0][0]} — ${downRanked[0][1]} downvote points`,
      detail: `Cast ${voterStats[downRanked[0][0]].negative_votes} negative votes this round.`
    });
  }

  // No hate in their heart
  const clean = Object.entries(voterStats).filter(([n,s]) => s.downvote_points === 0).map(([n]) => n);
  if (clean.length) {
    facts.push({
      label: 'No hate in their heart',
      headline: clean.join(' · '),
      detail: 'Cast zero downvotes all round. Pure positivity.'
    });
  }

  // Widest net
  const reach = Object.entries(voterStats).map(([n,s]) => [n, s.songs_voted]).sort((a,b) => b[1] - a[1]);
  facts.push({
    label: 'Widest net',
    headline: `${reach[0][0]} voted on ${reach[0][1]} songs`,
    detail: `Out of a maximum ${round.songs.length - 1} (you can't vote on your own submission).`
  });

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
            afterLabel: ctx => `across ${roundsPlayed[cumSorted[ctx.dataIndex][0]]} round(s)`
          }}
        },
        scales: {
          x: {ticks: {color: colors.text, font: {size: 12}}, grid: {color: colors.grid}},
          y: {ticks: {color: colors.text, font: {size: 13}}, grid: {display: false}}
        }
      }
    });
  }

  // League meta
  document.getElementById('leagueMeta').textContent =
    `${history.rounds.length} round${history.rounds.length !== 1 ? 's' : ''} · ${Object.keys(cumulative).length} players · ${history.rounds.reduce((a,r) => a + r.songs.length, 0)} total songs submitted`;

  window.__rerenderCharts = () => renderIndexPage();
}
