/* 익명 키 동기화 (Supabase RPC). app.js보다 먼저 로드된다.
   SYNC_CONFIG가 비어 있으면 모든 동기화 기능이 조용히 꺼진 상태로 동작한다. */

const SYNC_CONFIG = {
  url: "", // 예: https://xxxx.supabase.co
  apiKey: "", // sb_publishable_... (공개 전제 키)
};

const SYNC_STORE_KEY = "one_hundred_million_sync_v1";

function syncConfigured() {
  return Boolean(SYNC_CONFIG.url && SYNC_CONFIG.apiKey);
}

function syncGetSettings() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_STORE_KEY)) || null;
  } catch {
    return null;
  }
}

function syncSaveSettings(settings) {
  try {
    localStorage.setItem(SYNC_STORE_KEY, JSON.stringify(settings));
  } catch {
    // 저장 실패해도 앱은 계속 동작
  }
}

function syncEnabled() {
  return syncConfigured() && Boolean(syncGetSettings()?.key);
}

function syncNewKey() {
  return (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
}

function syncSetKey(key) {
  syncSaveSettings({ key, lastSyncedAt: null });
}

function syncClear() {
  try {
    localStorage.removeItem(SYNC_STORE_KEY);
  } catch {
    // 무시
  }
}

function syncMarkSynced() {
  const settings = syncGetSettings();
  if (settings) syncSaveSettings({ ...settings, lastSyncedAt: new Date().toISOString() });
}

async function syncRpc(name, args) {
  const res = await fetch(`${SYNC_CONFIG.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SYNC_CONFIG.apiKey },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`sync ${name} ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function syncPushNow(persisted) {
  const key = syncGetSettings()?.key;
  if (!key) return false;
  await syncRpc("sync_push", { sync_key: key, payload: persisted });
  syncMarkSynced();
  return true;
}

// 반환: 서버에 저장된 상태 JSON 또는 null
async function syncPullNow(overrideKey) {
  const key = overrideKey || syncGetSettings()?.key;
  if (!key) return null;
  const data = await syncRpc("sync_pull", { sync_key: key });
  if (!overrideKey && data) syncMarkSynced();
  return data;
}

let syncPushTimer = 0;
let syncPendingPersisted = null;

function syncCancelPending() {
  clearTimeout(syncPushTimer);
  syncPendingPersisted = null;
}

// saveState()마다 호출: 2초 디바운스 후 마지막 스냅샷을 업로드. 실패는 조용히 무시
function syncSchedulePush(persisted) {
  if (!syncEnabled()) return;
  syncPendingPersisted = persisted;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(() => {
    const snapshot = syncPendingPersisted;
    syncPendingPersisted = null;
    syncPushNow(snapshot).catch(() => {});
  }, 2000);
}
