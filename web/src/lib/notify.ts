/** System notification while the tab is in the background (needs permission; no push server involved). */
export async function showNotification(title: string, body: string, tag: string) {
  if (document.visibilityState === 'visible') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options: NotificationOptions = { body, tag, icon: '/icons/icon-192.png' };
  try {
    // Mobile browsers only allow notifications through the service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    /* notifications unavailable */
  }
}

export const canAskNotifications = () => 'Notification' in window && Notification.permission === 'default';

export async function askNotifications() {
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}
