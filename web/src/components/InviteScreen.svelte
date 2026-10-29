<script lang="ts">
  import { ApiError } from '../lib/api';
  import { app } from '../lib/state.svelte';
  import { errorText } from '../lib/text';
  import Avatar from './Avatar.svelte';

  let { token, onDone }: { token: string; onDone: (friendId?: number) => void } = $props();

  let status = $state<'loading' | 'ready' | 'own' | 'already' | 'invalid'>('loading');
  let name = $state('');
  let error = $state('');
  let busy = $state(false);

  $effect(() => {
    app
      .inviteInfo(token)
      .then((r) => {
        name = r.inviter.displayName;
        status = r.own ? 'own' : r.alreadyFriends ? 'already' : 'ready';
      })
      .catch((err) => {
        error = errorText(err instanceof ApiError ? err.code : 'unknown');
        status = 'invalid';
      });
  });

  async function accept() {
    busy = true;
    try {
      const friend = await app.acceptInvite(token);
      onDone(friend?.id);
    } catch (err) {
      error = errorText(err instanceof ApiError ? err.code : 'unknown');
      status = 'invalid';
    } finally {
      busy = false;
    }
  }
</script>

<main class="invite">
  <div class="panel" aria-live="polite">
    {#if status === 'loading'}
      <p class="muted">Taklif tekshirilmoqda…</p>
    {:else if status === 'ready'}
      <Avatar {name} id={name.length} size={96} />
      <h1>{name} sizni do'st bo'lishga taklif qildi</h1>
      <p>
        Qabul qilsangiz, bir-biringizga yozishingiz va qo'ng'iroq qilishingiz mumkin bo'ladi. {name}ning boshqa
        do'stlari sizni ko'rmaydi.
      </p>
      <div class="actions">
        <button class="btn primary" onclick={accept} disabled={busy}>Do'st bo'lish</button>
        <button class="btn ghost" onclick={() => onDone()}>Hozir emas</button>
      </div>
    {:else if status === 'already'}
      <h1>Siz {name} bilan allaqachon do'stsiz</h1>
      <div class="actions"><button class="btn primary" onclick={() => onDone()}>Suhbatlarga o'tish</button></div>
    {:else if status === 'own'}
      <h1>Bu sizning havolangiz</h1>
      <p>Uni do'stingizga yuboring. Do'stingiz havolani ochib qabul qilganda, u ro'yxatingizda paydo bo'ladi.</p>
      <div class="actions"><button class="btn primary" onclick={() => onDone()}>Suhbatlarga o'tish</button></div>
    {:else}
      <h1>Havola ishlamayapti</h1>
      <p>{error}</p>
      <div class="actions"><button class="btn primary" onclick={() => onDone()}>Suhbatlarga o'tish</button></div>
    {/if}
  </div>
</main>

<style>
  .invite {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 24px 16px;
  }

  .panel {
    width: min(100%, 420px);
    display: grid;
    justify-items: start;
    gap: 16px;
  }

  h1 {
    font-size: 26px;
    line-height: 1.2;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  p {
    color: var(--ink-2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }

  .muted {
    color: var(--ink-2);
  }
</style>
