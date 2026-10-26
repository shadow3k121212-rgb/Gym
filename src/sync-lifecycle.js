export function wireSyncLifecycle({
  target = globalThis.window,
  hasAuth = () => false,
  refreshAuth = async () => ({ ok:false }),
  flushSyncQueue = async () => {}
} = {}) {
  if (!target || typeof target.addEventListener !== "function") return () => {};

  let onlineRecovery = null;

  const handleOnline = () => {
    if (onlineRecovery) return;
    onlineRecovery = (async () => {
      if (!hasAuth()) await refreshAuth();
      await flushSyncQueue();
    })().finally(() => {
      onlineRecovery = null;
    });
  };

  const handleAuthChanged = () => {
    if (onlineRecovery) return;
    void flushSyncQueue();
  };

  target.addEventListener("online", handleOnline);
  target.addEventListener("gym:auth-changed", handleAuthChanged);

  return () => {
    target.removeEventListener("online", handleOnline);
    target.removeEventListener("gym:auth-changed", handleAuthChanged);
  };
}
