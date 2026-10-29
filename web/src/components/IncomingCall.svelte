<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { call } from '../lib/call.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  const name = $derived(app.friends.find((f) => f.id === call.peerId)?.displayName ?? "Do'stingiz");
</script>

<div class="incoming" role="alertdialog" aria-labelledby="incoming-name" aria-describedby="incoming-kind">
  <div class="tile">
    <Avatar {name} id={call.peerId} size={132} />
  </div>
  <h2 id="incoming-name">{name}</h2>
  <p id="incoming-kind">{call.kind === 'video' ? "Video qo'ng'iroq" : "Ovozli qo'ng'iroq"}</p>
  <p class="note">Mikrofon va kamerangiz o'chiq holda ulanadi. Ularni qo'ng'iroq paytida o'zingiz yoqasiz.</p>

  <div class="actions">
    <button class="round decline" onclick={() => call.reject()}>
      <Icon name="hangup" size={30} />
      <span>Rad etish</span>
    </button>
    <button class="round accept" onclick={() => call.accept()}>
      <Icon name={call.kind === 'video' ? 'cam' : 'phone'} size={30} />
      <span>Javob berish</span>
    </button>
  </div>
</div>

<style>
  .incoming {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 8px;
    padding: 24px 16px calc(32px + env(safe-area-inset-bottom));
    background: var(--night);
    color: #fff;
    text-align: center;
  }

  /* The one moving thing in the app: the caller's tile turns slowly while it rings. */
  .tile :global(svg) {
    animation: turn 16s linear infinite;
  }

  .tile {
    margin-bottom: 20px;
  }

  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }

  h2 {
    font-size: 28px;
    font-weight: 700;
  }

  p {
    color: rgb(255 255 255 / 0.75);
  }

  .note {
    max-width: 34ch;
    margin-top: 12px;
    font-size: 14px;
    color: rgb(255 255 255 / 0.6);
  }

  .actions {
    display: flex;
    gap: 64px;
    margin-top: 48px;
  }

  .round {
    display: grid;
    justify-items: center;
    gap: 10px;
    border: 0;
    background: transparent;
    color: #fff;
    font-size: 14px;
  }

  .round :global(svg) {
    box-sizing: content-box;
    padding: 19px;
    border-radius: 50%;
  }

  .decline :global(svg) {
    background: var(--anor);
  }

  .accept :global(svg) {
    background: #13a19f;
  }
</style>
