// Refresh the paper-style GitHub snapshot card.
// Usage:
//   GITHUB_TOKEN=... GH_LOGIN=muyi0736 node scripts/update-stats.mjs
//   node scripts/update-stats.mjs --mock        # writes preview/snapshot-sample.svg
//   node scripts/update-stats.mjs --placeholder # writes assets/snapshot.svg (dashes)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'scripts', 'snapshot.template.svg');
const MOON = join(ROOT, 'assets', 'yuuyuu.png');

const LANG_COLORS = {
  'C#': '#b78ac9',
  'F#': '#8aa9c9',
  TypeScript: '#7fa9d8',
  JavaScript: '#e3c45f',
  Vue: '#8fbf9a',
  HTML: '#e0a37a',
  CSS: '#9bb6d0',
  SCSS: '#cfa8bf',
  Shell: '#b7b09c',
  Python: '#8fb9a8',
  Rust: '#c99b84',
  'C++': '#d59f9a',
  Java: '#cfa98c',
  Other: '#c9bda6'
};

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmt(value) {
  return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
}

function fmtPct(pct) {
  if (pct > 0 && pct < 1) return '<1%';
  return Math.round(pct) + '%';
}

function render({ stars, followers, repos, languages, updated, state }) {
  const rows = [];
  if (languages && languages.length) {
    languages.slice(0, 4).forEach((lang, index) => {
      const y = 116 + index * 26;
      const color = LANG_COLORS[lang.name] || LANG_COLORS.Other;
      const width = Math.max(6, Math.round(280 * Math.min(100, Math.max(0, lang.pct)) / 100));
      rows.push(`  <g>
    <circle cx="440" cy="${y - 3}" r="2.6" fill="${color}"/>
    <text x="450" y="${y}" font-family="'Courier New', monospace" font-size="9.5" fill="#4f4a3f">${esc(lang.name)}</text>
    <rect x="532" y="${y - 7}" width="280" height="8" rx="4" fill="#e9dfcc"/>
    <rect x="532" y="${y - 7}" width="${width}" height="8" rx="4" fill="${color}"/>
    <text x="862" y="${y}" text-anchor="end" font-family="'Courier New', monospace" font-size="9.5" fill="#6f6858">${esc(fmtPct(lang.pct))}</text>
  </g>`);
    });
  } else {
    rows.push(`  <text x="440" y="146" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="13" fill="#8b816d">Waiting for the first update…</text>
  <text x="440" y="166" font-family="'Courier New', monospace" font-size="7" letter-spacing="1.1" fill="#a49a86">THE WORKFLOW FILLS THIS IN AFTER THE FIRST PUSH</text>`);
  }

  return readFile(TEMPLATE, 'utf8').then(template => {
    const moon = [];
    return readFile(MOON).then(buffer => {
      const b64 = buffer.toString('base64');
      moon.push(`  <image x="318" y="156" width="78" height="76" href="data:image/png;base64,${b64}"/>`);
    }).catch(() => {}).then(() => template
      .replaceAll('{{STARS}}', esc(fmt(stars)))
      .replaceAll('{{FOLLOWERS}}', esc(fmt(followers)))
      .replaceAll('{{REPOS}}', esc(fmt(repos)))
      .replaceAll('{{UPDATED}}', esc(updated))
      .replaceAll('{{STATE}}', esc(state))
      .replace('<!-- LANG_ROWS -->', rows.join('\n'))
      .replace('<!-- MOON_IMAGE -->', moon.join('\n')));
  });
}

async function writeSnapshot(target, data) {
  const svg = await render(data);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, svg, 'utf8');
  console.log('wrote', target, Math.round(svg.length / 1024) + ' KB');
}

async function fetchStats(login, token) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        followers { totalCount }
        repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
          totalCount
          nodes {
            stargazerCount
            languages(first: 20) { edges { size node { name } } }
          }
        }
      }
    }
  `;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'muyi-profile-snapshot'
    },
    body: JSON.stringify({ query, variables: { login } })
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }
  const json = await response.json();
  if (json.errors && json.errors.length) {
    throw new Error(json.errors.map(e => e.message).join('; '));
  }
  const user = json.data && json.data.user;
  if (!user) throw new Error(`GitHub user not found: ${login}`);

  const repositories = user.repositories;
  const nodes = repositories.nodes || [];
  const stars = nodes.reduce((sum, repo) => sum + (repo.stargazerCount || 0), 0);
  const bytes = new Map();
  for (const repo of nodes) {
    const edges = repo.languages && repo.languages.edges || [];
    for (const edge of edges) {
      const name = edge.node && edge.node.name;
      if (!name) continue;
      bytes.set(name, (bytes.get(name) || 0) + (edge.size || 0));
    }
  }
  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  const sorted = [...bytes.entries()].sort((a, b) => b[1] - a[1]);
  const languages = [];
  if (total > 0) {
    const top = sorted.slice(0, 3);
    let rest = 0;
    for (const [, size] of sorted.slice(3)) rest += size;
    for (const [name, size] of top) {
      languages.push({ name, pct: size / total * 100 });
    }
    if (rest > 0) languages.push({ name: 'Other', pct: rest / total * 100 });
  }

  const now = new Date();
  const date = `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.${String(now.getUTCDate()).padStart(2, '0')}`;
  return {
    stars,
    followers: user.followers.totalCount,
    repos: repositories.totalCount,
    languages,
    updated: `UPDATED ${date}`,
    state: 'PUBLIC REPOS ONLY · UPDATED DAILY'
  };
}

const args = new Set(process.argv.slice(2));

try {
  if (args.has('--placeholder')) {
    await writeSnapshot(join(ROOT, 'assets', 'snapshot.svg'), {
      stars: '—',
      followers: '—',
      repos: '—',
      languages: [],
      updated: 'WAITING FOR FIRST UPDATE',
      state: 'STATS FILL IN AFTER FIRST PUSH'
    });
  } else if (args.has('--mock')) {
    const mock = JSON.parse(await readFile(join(ROOT, 'scripts', 'mock-stats.json'), 'utf8'));
    await writeSnapshot(join(ROOT, 'preview', 'snapshot-sample.svg'), {
      ...mock,
      updated: 'PREVIEW SNAPSHOT',
      state: 'SAMPLE DATA · FOR PREVIEW'
    });
  } else {
    const token = process.env.GITHUB_TOKEN;
    const login = process.env.GH_LOGIN || process.env.GITHUB_REPOSITORY_OWNER || 'muyi0736';
    if (!token) throw new Error('GITHUB_TOKEN is missing');
    const stats = await fetchStats(login, token);
    await writeSnapshot(join(ROOT, 'assets', 'snapshot.svg'), stats);
  }
} catch (err) {
  console.error('snapshot update failed:', err.message || err);
  process.exitCode = 1;
}
