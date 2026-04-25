(() => {
  let resumeShown = false;
  let observedVideo = null;
  let watchStartTime = null;   // 开始播放的时间戳
  let watchedSeconds = 0;      // 本次页面累计实际观看秒数

  // ── 工具函数 ──────────────────────────────────────────
  function formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  function getDaysAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
  }

  // ── URL normalize：去掉 _nibble_t 及常见无关参数 ──────
  function normalizeUrl(href) {
    try {
      const u = new URL(href);
      // 去掉我们自己加的参数
      u.searchParams.delete('_nibble_t');
      // YouTube: 只保留 v 参数，去掉 t/list/index 等
      if (u.hostname.includes('youtube.com') && u.searchParams.has('v')) {
        const v = u.searchParams.get('v');
        u.search = '';
        u.searchParams.set('v', v);
      }
      // 去掉 hash
      u.hash = '';
      return u.toString();
    } catch {
      return href;
    }
  }

  // ── 找到页面主视频 ────────────────────────────────────
  function getMainVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) return null;
    return videos.sort((a, b) => {
      const aScore = (a.paused ? 0 : 10) + (a.duration || 0);
      const bScore = (b.paused ? 0 : 10) + (b.duration || 0);
      return bScore - aScore;
    })[0];
  }

  // ── 保存进度 ──────────────────────────────────────────
  function saveCurrentProgress() {
    const video = getMainVideo();
    if (!video || !video.duration) return;
    // 如果正在播放，先算一下当前这段
    const currentWatched = watchStartTime
      ? watchedSeconds + (Date.now() - watchStartTime) / 1000
      : watchedSeconds;

    chrome.runtime.sendMessage({
      type: 'SAVE_PROGRESS',
      data: {
        url: normalizeUrl(location.href),
        title: document.title,
        hostname: location.hostname.replace('www.', ''),
        currentTime: video.currentTime,
        duration: video.duration,
        watchedSeconds: Math.round(currentWatched),
      }
    }).catch(() => {});
  }

  // ── 监听 background 定时保存 ──────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'REQUEST_SAVE') saveCurrentProgress();
  });

  // ── pause / ended / visibilitychange / unload 时保存 ──
  function startTimer() {
    if (!watchStartTime) watchStartTime = Date.now();
  }

  function stopTimer() {
    if (watchStartTime) {
      watchedSeconds += (Date.now() - watchStartTime) / 1000;
      watchStartTime = null;
    }
  }

  function bindVideoSaveEvents(video) {
    video.addEventListener('play',   startTimer);
    video.addEventListener('pause',  () => { stopTimer(); saveCurrentProgress(); });
    video.addEventListener('ended',  () => { stopTimer(); saveCurrentProgress(); });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopTimer(); saveCurrentProgress(); }
    else { const v = getMainVideo(); if (v && !v.paused) startTimer(); }
  });
  window.addEventListener('beforeunload', () => { stopTimer(); saveCurrentProgress(); });

  // ── 检查历史进度，展示 toast ──────────────────────────
  async function checkResume() {
    if (resumeShown) return;

    const url = normalizeUrl(location.href);
    const res = await chrome.runtime.sendMessage({ type: 'GET_ONE', url }).catch(() => null);
    if (!res?.entry) return;

    const entry = res.entry;
    if (entry.percent >= 95) return;
    if (entry.currentTime < 10) return;

    const video = getMainVideo();
    if (!video) return;

    const { promptOnReturn = true } = await chrome.storage.local.get('promptOnReturn');
    if (!promptOnReturn) return;

    resumeShown = true;
    showResumeToast(entry, video);
  }

  // ── Toast UI（安全文本渲染，无 innerHTML 拼接用户数据）
  function showResumeToast(entry, video) {
    const existing = document.getElementById('nibble-toast');
    if (existing) existing.remove();

    const timeStr = formatTime(entry.currentTime);

    // 构建 DOM，不用 innerHTML 插入不可信内容
    const toast = document.createElement('div');
    toast.id = 'nibble-toast';

    const inner = document.createElement('div');
    inner.id = 'nibble-inner';

    // header
    const header = document.createElement('div');
    header.id = 'nibble-header';

    const logoWrap = document.createElement('div');
    logoWrap.id = 'nibble-logo';
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width','20'); svg.setAttribute('height','20'); svg.setAttribute('viewBox','0 0 20 20');
    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('width','20'); rect.setAttribute('height','20'); rect.setAttribute('rx','6'); rect.setAttribute('fill','#D85A30');
    const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('cx','15'); circle.setAttribute('cy','5'); circle.setAttribute('r','4'); circle.setAttribute('fill','white');
    const poly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
    poly.setAttribute('points','6,5 15,10 6,15'); poly.setAttribute('fill','white');
    svg.append(rect, circle, poly);
    const logoName = document.createElement('span');
    logoName.id = 'nibble-name';
    logoName.textContent = 'nibble';
    logoWrap.append(svg, logoName);

    const closeBtn = document.createElement('button');
    closeBtn.id = 'nibble-close';
    closeBtn.textContent = '✕';
    header.append(logoWrap, closeBtn);

    // desc（用 textContent 避免 XSS）
    const desc = document.createElement('p');
    desc.id = 'nibble-desc';
    desc.textContent = '上次看到 ';
    const strong = document.createElement('strong');
    strong.textContent = timeStr;
    const rest = document.createTextNode('，' + getDaysAgo(entry.updatedAt) + '在这里暂停的。');
    desc.append(strong, rest);

    // 按钮
    const btns = document.createElement('div');
    btns.id = 'nibble-btns';
    const yesBtn = document.createElement('button');
    yesBtn.id = 'nibble-yes';
    yesBtn.textContent = `从 ${timeStr} 继续`;
    const noBtn = document.createElement('button');
    noBtn.id = 'nibble-no';
    noBtn.textContent = '从头开始';
    btns.append(yesBtn, noBtn);

    inner.append(header, desc, btns);
    toast.append(inner);

    // 样式
    const style = document.createElement('style');
    style.textContent = `
      #nibble-toast { position:fixed; bottom:24px; right:24px; z-index:2147483647;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        font-size:14px; animation:nibble-in .25s ease; }
      @keyframes nibble-in { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
      #nibble-inner { background:white; border:1px solid rgba(0,0,0,.12);
        border-radius:14px; padding:14px 16px; width:280px; box-shadow:0 4px 24px rgba(0,0,0,.12); }
      #nibble-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      #nibble-logo { display:flex; align-items:center; gap:7px; }
      #nibble-name { font-size:14px; font-weight:600; color:#111; }
      #nibble-close { background:none; border:none; font-size:13px; color:#999;
        cursor:pointer; padding:2px 4px; border-radius:4px; line-height:1; }
      #nibble-close:hover { background:#f3f3f3; color:#333; }
      #nibble-desc { font-size:13px; color:#555; margin:0 0 12px; line-height:1.5; }
      #nibble-desc strong { color:#111; font-weight:600; }
      #nibble-btns { display:flex; gap:8px; }
      #nibble-yes { flex:1; padding:8px 0; background:#D85A30; color:white;
        border:none; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; }
      #nibble-yes:hover { background:#c04e28; }
      #nibble-no { flex:1; padding:8px 0; background:none; border:1px solid #ddd;
        color:#666; border-radius:8px; font-size:13px; cursor:pointer; }
      #nibble-no:hover { background:#f9f9f9; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(toast);

    // 点"继续"：等 loadedmetadata 后再 seek，更稳定
    yesBtn.addEventListener('click', () => {
      const doSeek = () => {
        video.currentTime = entry.currentTime;
        video.play().catch(() => {});
        toast.remove();
      };
      if (video.readyState >= 1) {
        doSeek();
      } else {
        video.addEventListener('loadedmetadata', doSeek, { once: true });
      }
    });
    noBtn.addEventListener('click', () => toast.remove());
    closeBtn.addEventListener('click', () => toast.remove());
    setTimeout(() => { if (document.contains(toast)) toast.remove(); }, 10000);
  }

  // ── URL 参数跳转（_nibble_t）────────────────────────
  function checkUrlTimestamp() {
    const params = new URLSearchParams(location.search);
    const t = params.get('_nibble_t');
    if (!t) return;
    const secs = parseInt(t);
    if (!secs || isNaN(secs)) return;

    function trySeek() {
      const video = getMainVideo();
      if (!video) return false;
      const doSeek = () => {
        video.currentTime = secs;
        const clean = new URL(location.href);
        clean.searchParams.delete('_nibble_t');
        history.replaceState(null, '', clean.toString());
      };
      if (video.readyState >= 1) { doSeek(); return true; }
      video.addEventListener('loadedmetadata', doSeek, { once: true });
      return true;
    }

    if (!trySeek()) {
      const timer = setInterval(() => { if (trySeek()) clearInterval(timer); }, 300);
      setTimeout(() => clearInterval(timer), 15000);
    }
  }

  // ── 绑定视频、等待视频出现 ────────────────────────────
  function attachVideo(v) {
    if (observedVideo === v) return;
    observedVideo = v;
    bindVideoSaveEvents(v);
    v.addEventListener('play', () => { if (!resumeShown) checkResume(); }, { once: true });
    if (!v.paused) checkResume();
  }

  function waitForVideo() {
    const video = getMainVideo();
    if (video) { attachVideo(video); return; }

    const observer = new MutationObserver(() => {
      const v = getMainVideo();
      if (v) attachVideo(v);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const poller = setInterval(() => {
      const v = getMainVideo();
      if (v) attachVideo(v);
    }, 1000);

    setTimeout(() => { observer.disconnect(); clearInterval(poller); }, 60000);
  }

  // ── 启动 ─────────────────────────────────────────────
  checkUrlTimestamp();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForVideo);
  } else {
    waitForVideo();
  }
})();
