<script lang="ts">
  import { app } from './lib/state.svelte';
  import { call } from './lib/call.svelte';
  import { showNotification } from './lib/notify';
  import AuthScreen from './components/AuthScreen.svelte';
  import CallScreen from './components/CallScreen.svelte';
  import Home from './components/Home.svelte';
  import IncomingCall from './components/IncomingCall.svelte';
  import InviteScreen from './components/InviteScreen.svelte';
  import Logo from './components/Logo.svelte';

  const INVITE_PATH = /^\/invite\/([A-Za-z0-9_-]{16,64})\/?$/;
  let inviteToken = $state<string | null>(location.pathname.match(INVITE_PATH)?.[1] ?? null);

  void app.boot();

  function leaveInvite(friendId?: number) {
    inviteToken = null;
    history.replaceState(null, '', '/');
    if (friendId) {
      history.pushState({ chat: friendId }, '');
      void app.openChat(friendId);
    }
  }

  $effect(() => {
    const n = app.totalUnread;
    document.title = n ? `(${n}) Aloqa` : 'Aloqa';
  });

  $effect(() => {
    if (call.phase !== 'incoming') return;
    const name = app.friends.find((f) => f.id === call.peerId)?.displayName ?? "Do'stingiz";
    void showNotification(name, call.kind === 'video' ? "Video qo'ng'iroq" : "Ovozli qo'ng'iroq", 'call');
  });
</script>

<!-- Remote call audio. It lives outside the call screen so it can be unlocked by the tap that starts a call. -->
<audio bind:this={call.audioEl} autoplay></audio>

{#if app.booting}
  <div class="splash"><Logo size={72} /></div>
{:else if !app.me}
  <AuthScreen {inviteToken} />
{:else if inviteToken}
  <InviteScreen token={inviteToken} onDone={leaveInvite} />
{:else}
  <Home />
{/if}

{#if app.me && call.phase === 'incoming'}
  <IncomingCall />
{:else if app.me && call.phase !== 'idle'}
  <CallScreen />
{/if}

{#if app.notice}
  <div class="toast" role="status">{app.notice}</div>
{/if}

<style>
  .splash {
    height: 100%;
    display: grid;
    place-items: center;
  }

  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(88px + env(safe-area-inset-bottom));
    z-index: 70;
    max-width: min(100% - 32px, 420px);
    padding: 10px 16px;
    border-radius: 12px;
    background: var(--ink);
    color: var(--bg);
    font-size: 15px;
    transform: translateX(-50%);
    box-shadow: 0 10px 30px rgb(14 26 51 / 0.25);
  }
</style>
