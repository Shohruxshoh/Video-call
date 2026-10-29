<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../lib/api';
  import { app, type Friend } from '../lib/state.svelte';
  import { call } from '../lib/call.svelte';
  import { errorText } from '../lib/text';
  import { clock, dayLabel, sameDay } from '../lib/util';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let { friend, onBack }: { friend: Friend; onBack: () => void } = $props();

  let text = $state('');
  let list = $state<HTMLElement>();
  let input = $state<HTMLTextAreaElement>();
  let menuOpen = $state(false);
  let stick = true;
  const coarse = matchMedia('(pointer: coarse)').matches;

  const conv = $derived(app.convs[friend.id]);
  const messages = $derived(conv?.messages ?? []);
  const status = $derived(app.typing[friend.id] ? 'yozmoqda…' : friend.online ? 'tarmoqda' : 'tarmoqda emas');

  // Follow new messages while the reader is at the bottom.
  $effect(() => {
    messages.length;
    if (stick) tick().then(() => list && (list.scrollTop = list.scrollHeight));
  });

  async function onScroll() {
    if (!list) return;
    stick = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (list.scrollTop < 60 && conv?.hasMore && !conv.loading) {
      const before = list.scrollHeight;
      await app.loadHistory(friend.id, true);
      await tick();
      list.scrollTop += list.scrollHeight - before;
    }
  }

  function autosize() {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  function submit(e?: Event) {
    e?.preventDefault();
    if (!text.trim()) return;
    app.send(friend.id, text);
    text = '';
    stick = true;
    tick().then(autosize);
    input?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    // On phones Enter adds a new line; the send button sends.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !coarse) submit(e);
  }

  async function unfriend() {
    menuOpen = false;
    const ok = confirm(
      `${friend.displayName} do'stlaringizdan o'chirilsinmi? Siz bir-biringizga yoza olmaysiz va qo'ng'iroq qila olmaysiz.`,
    );
    if (!ok) return;
    try {
      await app.removeFriend(friend.id);
    } catch (err) {
      app.flash(errorText(err instanceof ApiError ? err.code : 'unknown'));
    }
  }

  const isMine = (from: number) => from === app.me?.id;
</script>

<section class="chat">
  <header class="bar">
    <button class="icon-btn back" aria-label="Orqaga" onclick={onBack}><Icon name="back" /></button>
    <Avatar name={friend.displayName} id={friend.id} size={38} online={friend.online} />
    <div class="who">
      <h2>{friend.displayName}</h2>
      <p class:typing={app.typing[friend.id]}>{status}</p>
    </div>
    <button
      class="icon-btn"
      aria-label="Ovozli qo'ng'iroq"
      title="Ovozli qo'ng'iroq"
      disabled={call.inProgress}
      onclick={() => call.start(friend.id, 'audio')}
    >
      <Icon name="phone" />
    </button>
    <button
      class="icon-btn"
      aria-label="Video qo'ng'iroq"
      title="Video qo'ng'iroq"
      disabled={call.inProgress}
      onclick={() => call.start(friend.id, 'video')}
    >
      <Icon name="cam" />
    </button>
    <div class="menu-wrap">
      <button class="icon-btn" aria-label="Boshqa amallar" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
        <Icon name="more" />
      </button>
      {#if menuOpen}
        <button class="backdrop" aria-label="Yopish" onclick={() => (menuOpen = false)}></button>
        <div class="menu">
          <button class="item danger" onclick={unfriend}>
            <Icon name="trash" size={20} />
            Do'stlikdan chiqarish
          </button>
        </div>
      {/if}
    </div>
  </header>

  <div class="messages" bind:this={list} onscroll={onScroll}>
    {#if conv?.loading && !messages.length}
      <p class="hint">Yuklanmoqda…</p>
    {:else if conv?.loaded && !messages.length}
      <p class="hint">
        Bu {friend.displayName} bilan suhbatingizning boshlanishi. Xabarlarni faqat ikkalangiz ko'rasiz.
      </p>
    {/if}
    {#if conv?.hasMore}
      <p class="hint small">{conv.loading ? 'Yuklanmoqda…' : 'Oldingi xabarlar uchun yuqoriga suring'}</p>
    {/if}

    {#each messages as m, i (`${m.from}:${m.cid}`)}
      {#if i === 0 || !sameDay(messages[i - 1].at, m.at)}
        <p class="day">{dayLabel(m.at)}</p>
      {/if}
      <div class="msg" class:mine={isMine(m.from)}>
        <p class="bubble">
          {m.body}<span class="meta">
            <time>{clock(m.at)}</time>
            {#if isMine(m.from)}
              {#if m.pending}
                <span title="Yuborilmoqda"><Icon name="clock" size={14} /></span>
              {:else if m.id && m.id <= friend.peerRead}
                <span class="read" title="O'qildi"><Icon name="checks" size={16} /></span>
              {:else if m.id}
                <span title="Yetkazildi"><Icon name="check" size={16} /></span>
              {/if}
            {/if}
          </span>
        </p>
        {#if m.error}<p class="error">{m.error}</p>{/if}
      </div>
    {/each}
  </div>

  <form class="composer" onsubmit={submit}>
    <textarea
      bind:this={input}
      bind:value={text}
      rows="1"
      placeholder="Xabar yozing"
      enterkeyhint={coarse ? 'enter' : 'send'}
      maxlength="4000"
      aria-label="Xabar"
      oninput={() => {
        autosize();
        app.typed(friend.id);
      }}
      onkeydown={onKeydown}
    ></textarea>
    <button class="send" aria-label="Yuborish" disabled={!text.trim()}><Icon name="send" /></button>
  </form>
</section>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px;
    padding-top: calc(8px + env(safe-area-inset-top));
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }

  .who {
    flex: 1;
    min-width: 0;
    margin-left: 4px;
  }

  .who h2 {
    font-size: 17px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .who p {
    color: var(--ink-2);
    font-size: 13px;
  }

  .who p.typing {
    color: var(--turq);
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
    width: 240px;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    box-shadow: 0 12px 32px rgb(14 26 51 / 0.16);
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
  }

  .item:hover {
    background: var(--surface-2);
  }

  .item.danger {
    color: var(--anor);
  }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hint {
    align-self: center;
    max-width: 40ch;
    margin: 24px 0;
    color: var(--ink-2);
    text-align: center;
    font-size: 15px;
  }

  .hint.small {
    margin: 4px 0 8px;
    font-size: 13px;
  }

  .day {
    align-self: center;
    margin: 12px 0 6px;
    padding: 2px 10px;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--ink-2);
    font-size: 13px;
  }

  .msg {
    display: grid;
    justify-items: start;
  }

  .msg.mine {
    justify-items: end;
  }

  .bubble {
    max-width: min(78%, 60ch);
    padding: 7px 10px 6px 12px;
    border-radius: 16px 16px 16px 5px;
    background: var(--bubble-theirs);
    border: 1px solid var(--line);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .mine .bubble {
    border-radius: 16px 16px 5px 16px;
    border-color: transparent;
    background: var(--bubble-mine);
    color: var(--bubble-mine-ink);
  }

  .meta {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    float: right;
    margin: 6px 0 -2px 10px;
    font-size: 12px;
    opacity: 0.72;
    line-height: 1;
  }

  .meta .read {
    opacity: 1;
  }

  .error {
    margin-top: 2px;
    color: var(--anor);
    font-size: 13px;
  }

  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 8px;
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    background: var(--surface);
  }

  textarea {
    flex: 1;
    resize: none;
    max-height: 140px;
    border-radius: 20px;
    padding: 10px 14px;
    line-height: 1.35;
  }

  .send {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
    border: 0;
    border-radius: 50%;
    background: var(--turq);
    color: var(--turq-ink);
  }

  .send:disabled {
    background: var(--surface-2);
    color: var(--ink-2);
    cursor: default;
  }

  @media (min-width: 820px) {
    .back {
      display: none;
    }
  }
</style>
