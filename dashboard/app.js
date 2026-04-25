const $ = id => document.getElementById(id);

let allEntries = [];
let currentFilter = 'all';
let searchQuery = '';

// ── 工具 ─────────────────────────────────────────────────
function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatWeekTime(secs) {
  if (secs < 60) return `${secs}秒`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}分`;
  const h = (secs / 3600).toFixed(1);
  return `${h}h`;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}天前`;
  return '上周';
}

// ── 加载数据 ──────────────────────────────────────────────
async function loadAll() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_ALL' });
  allEntries = res?.entries || [];
  renderStats();
  renderGrid();
  renderPlatformFilters();
}

// ── 统计数字 ──────────────────────────────────────────────
function renderStats() {
  const inProgress = allEntries.filter(e => e.percent < 95).length;
  const done = allEntries.filter(e => e.percent >= 95).length;
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekSecs = allEntries
    .filter(e => e.updatedAt > oneWeekAgo)
    .reduce((acc, e) => acc + (e.watchedSeconds || 0), 0);
  const platforms = new Set(allEntries.map(e => e.hostname)).size;

  $('s-progress').textContent = inProgress;
  $('s-done').textContent = done;
  $('s-week').textContent = formatWeekTime(weekSecs);
  $('s-sites').textContent = platforms;
}

// ── 平台筛选按钮 ──────────────────────────────────────────
function renderPlatformFilters() {
  const hosts = [...new Set(allEntries.map(e => e.hostname).filter(Boolean))];
  const filters = $('filters');

  // 移除旧的平台按钮
  filters.querySelectorAll('[data-filter^="host:"]').forEach(el => el.remove());

  hosts.slice(0, 6).forEach(host => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.filter = 'host:' + host;
    btn.textContent = host;
    btn.addEventListener('click', () => setFilter(btn.dataset.filter, btn));
    filters.appendChild(btn);
  });
}

// ── 网格渲染 ──────────────────────────────────────────────
function renderGrid() {
  let entries = allEntries;

  // 搜索过滤
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    entries = entries.filter(e =>
      e.title.toLowerCase().includes(q) ||
      (e.hostname || '').toLowerCase().includes(q)
    );
  }

  // 状态/平台过滤
  if (currentFilter === 'progress') {
    entries = entries.filter(e => e.percent < 95);
  } else if (currentFilter === 'done') {
    entries = entries.filter(e => e.percent >= 95);
  } else if (currentFilter.startsWith('host:')) {
    const host = currentFilter.slice(5);
    entries = entries.filter(e => e.hostname === host);
  }

  const grid = $('grid');
  const empty = $('empty');

  if (!entries.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  grid.innerHTML = entries.map(e => {
    const done = e.percent >= 95;
    const pctLabel = done ? '完成' : `${e.percent}%`;
    return `
      <div class="card" data-url="${e.url}" data-time="${e.currentTime}">
        <div class="card-thumb">
          <div class="card-pbar ${done ? 'done' : ''}" style="width:${e.percent}%"></div>
          ▷
          <div class="card-pct ${done ? 'done' : ''}">${pctLabel}</div>
          <button class="card-del" data-url="${e.url}" title="删除">✕</button>
        </div>
        <div class="card-body">
          <div class="card-site">${e.hostname || ''}</div>
          <div class="card-title">${e.title}</div>
          <div class="card-bottom">
            <span class="card-time">${timeAgo(e.updatedAt)}</span>
            <button class="card-btn ${done ? 'done' : ''}">${done ? '重播' : '继续看'}</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 点击卡片打开
  grid.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.classList.contains('card-del') ||
          e.target.classList.contains('card-btn')) return;
      chrome.tabs.create({ url: card.dataset.url });
    });
  });

  // 继续/重播按钮
  grid.querySelectorAll('.card-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const url = btn.closest('.card').dataset.url;
      chrome.tabs.create({ url });
    });
  });

  // 删除按钮
  grid.querySelectorAll('.card-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const url = btn.dataset.url;
      await chrome.runtime.sendMessage({ type: 'DELETE', url });
      allEntries = allEntries.filter(en => en.url !== url);
      renderStats();
      renderGrid();
      renderPlatformFilters();
    });
  });
}

// ── 筛选逻辑 ──────────────────────────────────────────────
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderGrid();
}

$('filters').addEventListener('click', e => {
  if (!e.target.classList.contains('chip')) return;
  setFilter(e.target.dataset.filter, e.target);
});

// ── 搜索 ──────────────────────────────────────────────────
$('search').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  renderGrid();
});

// ── 启动 ──────────────────────────────────────────────────
loadAll();
