const $ = id => document.getElementById(id);

// 本次会话隐藏的 URL 列表，用 chrome.storage.session（跨弹窗开关保持）
async function getHidden() {
  const res = await chrome.storage.session.get('nibble_hidden');
  return res.nibble_hidden || [];
}
async function addHidden(url) {
  const list = await getHidden();
  if (!list.includes(url)) {
    list.push(url);
    await chrome.storage.session.set({ nibble_hidden: list });
  }
}

// ── 工具 ─────────────────────────────────────────────────
function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

function openWithTime(url, currentTime) {
  // 把时间戳塞进 URL 参数，content.js 读到后自动跳转
  try {
    const u = new URL(url);
    u.searchParams.set('_nibble_t', Math.round(currentTime));
    chrome.tabs.create({ url: u.toString() });
  } catch {
    chrome.tabs.create({ url });
  }
}

// ── 当前标签页的视频进度 ──────────────────────────────────
async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const res = await chrome.runtime.sendMessage({ type: 'GET_ONE', url: tab.url });
  const entry = res?.entry;

  const block = $('current-block');
  const noVideo = $('no-video-block');

  const saveNowBtn = $('save-now-btn');
  if (entry) {
    block.classList.remove('hidden');
    noVideo.classList.add('hidden');
    saveNowBtn.classList.add('hidden');
    $('cur-site').textContent = entry.hostname || new URL(entry.url).hostname;
    $('cur-title').textContent = entry.title;
    $('cur-fill').style.width = entry.percent + '%';
    $('cur-time').textContent = `${formatTime(entry.currentTime)} / ${formatTime(entry.duration)}`;
    $('cur-saved-ago').textContent = timeAgo(entry.updatedAt);
  } else {
    block.classList.add('hidden');
    noVideo.classList.remove('hidden');
    // 当前页面有视频但还没保存过，显示"立即保存"
    if (tab.url && !tab.url.startsWith('chrome')) {
      saveNowBtn.classList.remove('hidden');
    }
  }
}

// ── 最近记录列表 ──────────────────────────────────────────
async function loadList() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_ALL' });
  const entries = res?.entries || [];
  const hidden = await getHidden();
  const recent = entries.filter(e => !hidden.includes(e.url)).slice(0, 5);

  $('count-badge').textContent = `${entries.length} 个`;

  const list = $('list');
  if (!recent.length) {
    list.innerHTML = '<div class="empty-list">还没有记录，去看个视频试试吧</div>';
    return;
  }

  list.innerHTML = '';
  recent.forEach(e => {
    const done = e.percent >= 95;
    const timeLabel = done ? '已看完' : formatTime(e.currentTime);

    const item = document.createElement('div');
    item.className = 'item';
    item.dataset.url = e.url;
    item.dataset.time = e.currentTime;

    const thumb = document.createElement('div');
    thumb.className = 'item-thumb';
    const bar = document.createElement('div');
    bar.className = 'item-bar' + (done ? ' done' : '');
    bar.style.width = e.percent + '%';
    thumb.append(bar);
    thumb.append(document.createTextNode('▷'));

    const info = document.createElement('div');
    info.className = 'item-info';
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = e.title; // 安全：textContent 不解析 HTML
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    const posLabel = done ? '已看完' : '看到 ' + formatTime(e.currentTime);
    meta.textContent = `${e.hostname} · ${posLabel} · ${timeAgo(e.updatedAt)}`;
    info.append(name, meta);

    const btn = document.createElement('button');
    btn.className = 'item-btn';
    btn.textContent = done ? '重播' : '继续';

    const delBtn = document.createElement('button');
    delBtn.className = 'item-del';
    delBtn.title = '从列表移除';
    delBtn.textContent = '✕';

    item.append(thumb, info, btn, delBtn);
    list.appendChild(item);

    item.addEventListener('click', ev => {
      if (ev.target === delBtn) return;
      openWithTime(e.url, e.currentTime);
    });
    delBtn.addEventListener('click', async ev => {
      ev.stopPropagation();
      await addHidden(e.url);  // 记到本次会话黑名单
      item.remove();
      if (!list.querySelector('.item')) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.textContent = '还没有记录，去看个视频试试吧';
        list.appendChild(empty);
      }
    });
  });
}

// ── 设置 ──────────────────────────────────────────────────
async function loadSettings() {
  const { interval = 5, promptOnReturn = true } = await chrome.storage.local.get(['interval', 'promptOnReturn']);

  document.querySelectorAll('#seg button').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.min) === interval);
    btn.addEventListener('click', () => {
      const min = parseInt(btn.dataset.min);
      chrome.runtime.sendMessage({ type: 'SET_INTERVAL', minutes: min });
      chrome.storage.local.set({ interval: min });
      document.querySelectorAll('#seg button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('badge').textContent = `自动保存 · 每${min}分钟`;
    });
  });

  const tog = $('tog');
  tog.classList.toggle('off', !promptOnReturn);
  tog.addEventListener('click', () => {
    const isOn = !tog.classList.contains('off');
    tog.classList.toggle('off', isOn);
    chrome.storage.local.set({ promptOnReturn: !isOn });
  });

  $('badge').textContent = `自动保存 · 每${interval}分钟`;
}

$('dash-link').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
});

// 立即保存按钮：发消息给 content.js 触发保存
$('save-now-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SAVE' }, () => {
    $('save-now-btn').textContent = '已保存 ✓';
    setTimeout(() => {
      $('save-now-btn').textContent = '立即保存当前进度';
      loadCurrentTab();
      loadList();
    }, 1200);
  });
});

loadCurrentTab();
loadList();
loadSettings();
