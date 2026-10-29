<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError } from '../lib/api';
  import { app } from '../lib/state.svelte';
  import { errorText } from '../lib/text';
  import Logo from './Logo.svelte';

  let { inviteToken }: { inviteToken: string | null } = $props();

  // Someone arriving through an invite most likely has no account yet.
  let mode = $state<'login' | 'register'>(untrack(() => inviteToken) ? 'register' : 'login');
  let username = $state('');
  let displayName = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);
  let inviter = $state('');

  $effect(() => {
    if (!inviteToken) return;
    app
      .inviteInfo(inviteToken)
      .then((r) => (inviter = r.inviter.displayName))
      .catch(() => {});
  });

  function switchMode(next: 'login' | 'register') {
    mode = next;
    error = '';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      if (mode === 'login') await app.login(username, password);
      else await app.register(username, displayName, password);
    } catch (err) {
      error = errorText(err instanceof ApiError ? err.code : 'unknown');
    } finally {
      busy = false;
    }
  }
</script>

<main class="auth">
  <div class="panel">
    <div class="brand">
      <Logo size={52} />
      <h1>Aloqa</h1>
    </div>

    {#if inviter}
      <p class="lead"><strong>{inviter}</strong> sizni do'st bo'lishga taklif qildi. Davom etish uchun ro'yxatdan o'ting yoki kiring.</p>
    {:else}
      <p class="lead">Faqat o'zingiz taklif qilgan do'stlar bilan xabar yozish, ovozli va video qo'ng'iroqlar.</p>
    {/if}

    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={mode === 'login'} onclick={() => switchMode('login')}>Kirish</button>
      <button role="tab" aria-selected={mode === 'register'} onclick={() => switchMode('register')}>Ro'yxatdan o'tish</button>
    </div>

    <form onsubmit={submit}>
      {#if mode === 'register'}
        <label>
          <span>Ismingiz</span>
          <input bind:value={displayName} autocomplete="name" maxlength="40" required />
        </label>
      {/if}
      <label>
        <span>Foydalanuvchi nomi</span>
        <input
          bind:value={username}
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          minlength="3"
          maxlength="24"
          required
        />
        {#if mode === 'register'}
          <small>Lotin harflari, raqamlar, _ va nuqta. Kirishda shu nomni yozasiz.</small>
        {/if}
      </label>
      <label>
        <span>Parol</span>
        <input
          type="password"
          bind:value={password}
          autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
          minlength="8"
          required
        />
        {#if mode === 'register'}<small>Kamida 8 belgi.</small>{/if}
      </label>

      {#if error}<p class="error" role="alert">{error}</p>{/if}

      <button class="btn primary wide" disabled={busy}>
        {mode === 'login' ? 'Kirish' : "Ro'yxatdan o'tish"}
      </button>
    </form>
  </div>
</main>

<style>
  .auth {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
  }

  .panel {
    width: min(100%, 400px);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  h1 {
    font-size: 34px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .lead {
    color: var(--ink-2);
    margin-bottom: 28px;
    max-width: 36ch;
  }

  .lead strong {
    color: var(--ink);
  }

  .tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 4px;
    margin-bottom: 20px;
    border-radius: 12px;
    background: var(--surface-2);
  }

  .tabs button {
    min-height: 40px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--ink-2);
    font-weight: 600;
  }

  .tabs button[aria-selected='true'] {
    background: var(--surface);
    color: var(--ink);
  }

  form {
    display: grid;
    gap: 16px;
  }

  label {
    display: grid;
    gap: 6px;
  }

  label span {
    font-size: 15px;
    font-weight: 600;
  }

  small {
    color: var(--ink-2);
    font-size: 14px;
  }

  .error {
    color: var(--anor);
    font-size: 15px;
  }
</style>
