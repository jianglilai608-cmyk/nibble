const ALARM_NAME = 'nibble-autosave';
const DEFAULT_INTERVAL = 5; // minutes

// 初始化：设置定时器
chrome.runtime.onInstalled.addListener(async () => {
  const { interval } = await chrome.storage.local.get({ interval: DEFAULT_INTERVAL });
  setAlarm(interval);
});

function setAlarm(minutes) {
  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
  });
}

// 定时器触发：向所有打开的 tab 发起保存请求（不只是当前激活的）
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SAVE' }).catch(() => {});
    });
  });
});

// 监听来自 content.js 和 popup 的消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SAVE_PROGRESS') {
    saveProgress(msg.data).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'GET_ALL') {
    chrome.storage.local.get(null, (items) => {
      const entries = Object.entries(items)
        .filter(([k]) => k.startsWith('v:'))
        .map(([, v]) => v)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      sendResponse({ entries });
    });
    return true;
  }

  if (msg.type === 'GET_ONE') {
    const key = 'v:' + msg.url;
    chrome.storage.local.get(key, (items) => {
      sendResponse({ entry: items[key] || null });
    });
    return true;
  }

  if (msg.type === 'DELETE') {
    const key = 'v:' + msg.url;
    chrome.storage.local.remove(key, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'SET_INTERVAL') {
    chrome.storage.local.set({ interval: msg.minutes }, () => {
      setAlarm(msg.minutes);
      sendResponse({ ok: true });
    });
    return true;
  }

});

async function saveProgress(data) {
  if (!data.url || data.currentTime == null || data.duration == null) return;
  if (data.duration < 30) return; // 忽略太短的视频
  if (data.currentTime < 3) return; // 刚开始播放不记录

  const key = 'v:' + data.url;
  const existing = await chrome.storage.local.get(key);
  const prev = existing[key] || {};

  const percent = Math.round((data.currentTime / data.duration) * 100);
  // 累加实际观看时间（跨多次访问叠加）
  const prevWatched = prev.watchedSeconds || 0;
  const newWatched = data.watchedSeconds || 0;
  const totalWatched = prevWatched + newWatched;

  const entry = {
    url: data.url,
    title: data.title || prev.title || '未知标题',
    currentTime: Math.round(data.currentTime),
    duration: Math.round(data.duration),
    percent,
    hostname: data.hostname,
    watchedSeconds: Math.round(totalWatched),
    createdAt: prev.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  await chrome.storage.local.set({ [key]: entry });
}
