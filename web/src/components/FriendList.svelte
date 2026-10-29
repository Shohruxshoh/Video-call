<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { call } from '../lib/call.svelte';
  import { socket } from '../lib/socket.svelte';
  import { askNotifications, canAskNotifications } from '../lib/notify';
  import { shortTime } from '../lib/util';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';

  let { onInvite, onOpen }: { onInvite: () => void; onOpen: (id: number) => void } = $props();

  let menuOpen = $state(false);
  let canNotify = $state(canAskNotifications());
  let offline = $state(false);

  // Only mention the connection once it has been down for a moment; reconnects are usually quick.
  $effect(() => {
    if (socket.status === 'open') {
      offline = false;
      return;
    }
    const t = setTimeout(() => (offline = true), 2000);
    return () => clearTimeout(t);
  });

  function preview(f: (typeof app.friends)[number]) {
    if (app.typing[f.id]) return 'yozmoqda…';
    if (!f.last) return "Hali xabar yo'q";
    return (f.last.from === app.me?.id ? 'Siz: ' : '') + f.last.body;
  }

  async function enableNotifications() {
    await askNotifications();
    canNotify = canAskNotifications();
  }
</script>

<header class="bar">
  <div class="brand">
    <Logo size={30} />
    <span>Aloqa</span>
  </div>
  <button class="btn primary small" onclick={onInvite}>
    <Icon name="plus" size={18} />
    Taklif qilish
  </button>
  <div class="menu-wrap">
    <button class="icon-btn" aria-label="Sozlamalar" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
      <Icon name="more" />
    </button>
    {#if menuOpen}
      <button class="backdrop" aria-label="Yopish" onclick={() => (menuOpen = false)}></button>
      <div class="menu">
        <p class="who">
          <strong>{app.me?.displayName}</strong>
          <span>@{app.me?.username}</span>
        </p>
        <label class="item">
          <input type="checkbox" checked={call.dataSaver} onchange={(e) => call.setDataSaver(e.currentTarget.checked)} />
          <span>
            Trafikni tejash
            <small>Video past sifatda, kam internet sarflanadi</small>
          </span>
        </label>
        <button class="item" onclick={() => app.logout()}>
          <Icon name="logout" size={20} />
          Chiqish
        </button>
      </div>
    {/if}
  </div>
</header>

{#if offline}
  <p class="status-line" role="status">Internet yo'q yoki sekin. Qayta ulanmoqda, yozgan xabarlaringiz keyin yuboriladi.</p>
{/if}

{#if canNotify && app.friends.length}
  <button class="notify-hint" onclick={enableNotifications}>
    <Icon name="bell" size={20} />
    Yangi xabar va qo'ng'iroqlar haqida bildirishnoma olish
  </button>
{/if}

<ul class="friends">
  {#each app.friends as f (f.id)}
    <li>
      <button class="row" class:active={app.activeId === f.id} onclick={() => onOpen(f.id)}>
        <Avatar name={f.displayName} id={f.id} online={f.online} />
        <span class="text">
          <span class="line">
            <span class="name">{f.displayName}</span>
            {#if f.last}<time>{shortTime(f.last.at)}</time>{/if}
          </span>
          <span class="line">
            <span class="preview" class:typing={app.typing[f.id]}>{preview(f)}</span>
            {#if f.unread}<span class="badge" aria-label="{f.unread} ta yangi xabar">{f.unread}</span>{/if}
          </span>
        </span>
      </button>
    </li>
  {:else}
    <li class="empty">
      <h2>Hali do'stlaringiz yo'q</h2>
      <p>
        Taklif havolasini yarating va do'stingizga yuboring. U havolani ochib qabul qilsa, bir-biringizni ko'rasiz.
        Boshqa hech kim sizni ko'rmaydi.
      </p>
      <button class="btn primary" onclick={onInvite}>Taklif havolasini yaratish</button>
    </li>
  {/each}
</ul>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 8px 10px 16px;
    padding-top: calc(10px + env(safe-area-inset-top));
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: auto;
    font-size: 21px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .menu-wrap {
    position: relative;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    border: 0;
    background: transparent;
    cursor: default;
  }

  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 11;
    width: 280px;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    box-shadow: 0 12px 32px rgb(14 26 51 / 0.16);
  }

  .who {
    display: grid;
    padding: 10px 12px 12px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 4px;
  }

  .who span {
    color: var(--ink-2);
    font-size: 14px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .item:hover {
    background: var(--surface-2);
  }

  .item input {
    width: 20px;
    height: 20px;
    accent-color: var(--turq);
  }

  .item small {
    display: block;
    color: var(--ink-2);
    font-size: 13px;
  }

  .status-line {
    margin: 0 12px 8px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--saffron-soft);
    color: var(--saffron);
    font-size: 14px;
  }

  .notify-hint {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 12px 8px;
    width: calc(100% - 24px);
    padding: 10px 12px;
    border: 1px dashed var(--line);
    border-radius: 10px;
    background: transparent;
    color: var(--ink-2);
    font-size: 14px;
    text-align: left;
  }

  .friends {
    list-style: none;
    margin: 0;
    padding: 0 0 calc(16px + env(safe-area-inset-bottom));
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 16px;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .row:hover {
    background: var(--surface-2);
  }

  .row.active {
    background: var(--turq-soft);
  }

  .text {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    padding-bottom: 10px;
    margin-bottom: -10px;
    border-bottom: 1px solid var(--line);
  }

  li:last-child .text,
  .row.active .text {
    border-bottom-color: transparent;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  time {
    color: var(--ink-2);
    font-size: 13px;
  }

  .preview {
    flex: 1;
    min-width: 0;
    color: var(--ink-2);
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview.typing {
    color: var(--turq);
  }

  .badge {
    min-width: 22px;
    height: 22px;
    padding: 0 7px;
    border-radius: 11px;
    background: var(--turq);
    color: var(--turq-ink);
    font-size: 13px;
    font-weight: 700;
    line-height: 22px;
    text-align: center;
  }

  .empty {
    display: grid;
    justify-items: start;
    gap: 12px;
    padding: 32px 16px;
  }

  .empty h2 {
    font-size: 19px;
  }

  .empty p {
    color: var(--ink-2);
    max-width: 38ch;
  }
</style>
