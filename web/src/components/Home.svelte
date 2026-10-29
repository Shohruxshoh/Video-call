<script lang="ts">
  import { app } from '../lib/state.svelte';
  import ChatView from './ChatView.svelte';
  import FriendList from './FriendList.svelte';
  import InviteDialog from './InviteDialog.svelte';
  import Logo from './Logo.svelte';

  let inviteOpen = $state(false);

  // Opening a chat adds a history entry so the phone's back button returns to the list.
  function open(id: number) {
    if (history.state?.chat) history.replaceState({ chat: id }, '');
    else history.pushState({ chat: id }, '');
    void app.openChat(id);
  }

  function back() {
    if (history.state?.chat) history.back();
    else app.activeId = null;
  }
</script>

<svelte:window
  onpopstate={() => {
    if (!history.state?.chat) app.activeId = null;
  }}
/>

<div class="home" class:chat-open={app.active !== null}>
  <aside class="side">
    <FriendList onInvite={() => (inviteOpen = true)} onOpen={open} />
  </aside>
  <main class="main">
    {#if app.active}
      {#key app.active.id}
        <ChatView friend={app.active} onBack={back} />
      {/key}
    {:else}
      <div class="placeholder">
        <Logo size={64} />
        <p>Suhbatni ochish uchun do'stingizni tanlang.</p>
      </div>
    {/if}
  </main>
</div>

<InviteDialog bind:open={inviteOpen} />

<style>
  .home {
    height: 100%;
    display: grid;
    grid-template-columns: 1fr;
  }

  .side {
    min-height: 0;
    overflow-y: auto;
    background: var(--bg);
  }

  .main {
    display: none;
    min-height: 0;
    background: var(--bg);
  }

  .chat-open .side {
    display: none;
  }

  .chat-open .main {
    display: block;
  }

  .placeholder {
    height: 100%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 16px;
    color: var(--ink-2);
  }

  @media (min-width: 820px) {
    .home {
      grid-template-columns: 340px 1fr;
    }

    .side {
      border-right: 1px solid var(--line);
    }

    .chat-open .side {
      display: block;
    }

    .main {
      display: block;
    }
  }
</style>
