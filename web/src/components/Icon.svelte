<script lang="ts" module>
  const PATHS: Record<string, string> = {
    mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>',
    'mic-off':
      '<path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v3a3 3 0 0 0 4.7 2.5"/><path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.6 6M12 18v3M3 3l18 18"/>',
    cam: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    'cam-off': '<path d="M16 16v1a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1M10 6h4a2 2 0 0 1 2 2v2l5-3v10"/><path d="M3 3l18 18"/>',
    phone:
      '<path d="M5 4h3.5l2 5-2.4 1.6a11 11 0 0 0 5.3 5.3L15 13.5l5 2V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
    hangup:
      '<path d="M3.6 14.3c-.6-.6-.6-1.6 0-2.2a12 12 0 0 1 16.8 0c.6.6.6 1.6 0 2.2l-1.7 1.7-3.4-1.6v-2.6a9 9 0 0 0-6.6 0v2.6L5.3 16Z"/>',
    send: '<path d="M21 3 10 14"/><path d="m21 3-6.5 18-4.5-7-7-4.5Z"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    flip: '<path d="M4 10a8 8 0 0 1 14-4l2 2M20 14a8 8 0 0 1-14 4l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
    more: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    checks: '<path d="m2 12.5 4.5 4.5L16 7"/><path d="m11.5 16 1 1L22 7"/>',
    gauge: '<path d="M3.5 17a9 9 0 1 1 17 0"/><path d="m12 14 4.5-4.5"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    volume: '<path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M18 7l-1 13H7L6 7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  };
</script>

<script lang="ts">
  let { name, size = 22 }: { name: string; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.9"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {@html PATHS[name] ?? ''}
</svg>
