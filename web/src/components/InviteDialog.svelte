<script lang="ts">
  import { ApiError } from '../lib/api';
  import { app, type Invite } from '../lib/state.svelte';
  import { errorText } from '../lib/text';
  import { shortTime } from '../lib/util';
  import Icon from './Icon.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let dialog = $state<HTMLDialogElement>();
  let invites = $state<Invite[]>([]);
  let current = $state<Invite | null>(null);
  let loading = $state(false);
  let error = $state('');
  let copied = $state(false);
  const canShare = typeof navigator.share === 'function';

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      void load();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  // Someone just accepted a link (a friend was added): that link is spent, so fetch a fresh one.
  let friendCount = app.friends.length;
  $effect(() => {
    const count = app.friends.length;
    if (count > friendCount && open) void load();
    friendCount = count;
  });

  const fail = (err: unknown) => (error = errorText(err instanceof ApiError ? err.code : 'unknown'));

  async function load() {
    loading = true;
    error = '';
    copied = false;
    try {
      invites = await app.listInvites();
      // An unused link can be handed out again, so reuse the newest one.
      current = invites[0] ?? (await create());
    } catch (err) {
      fail(err);
    } finally {
      loading = false;
    }
  }

  async function create() {
    const invite = await app.createInvite();
    invites = [invite, ...invites];
    return invite;
  }

  async function newLink() {
    error = '';
    try {
      current = await create();
      copied = false;
    } catch (err) {
      fail(err);
    }
  }

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.url);
      copied = true;
    } catch {
      error = "Nusxalab bo'lmadi. Havolani belgilab, qo'lda nusxalang.";
    }
  }

  async function share() {
    if (!current) return;
    try {
      await navigator.share({
        title: 'Aloqa',
        text: `${app.me?.displayName} sizni Aloqa'da do'st bo'lishga taklif qilmoqda`,
        url: current.url,
      });
    } catch {
      /* share sheet dismissed */
    }
  }

  async function revoke(invite: Invite) {
    try {
      await app.revokeInvite(invite.token);
      invites = invites.filter((i) => i.token !== invite.token);
      if (current?.token === invite.token) current = invites[0] ?? null;
    } catch (err) {
      fail(err);
    }
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} aria-labelledby="invite-title">
  <header>
    <h2 id="invite-title">Do'stni taklif qilish</h2>
    <button class="icon-btn" aria-label="Yopish" onclick={() => (open = false)}><Icon name="x" /></button>
  </header>

  <p class="lead">
    Havolani faqat do'st bo'lmoqchi bo'lgan odamga yuboring. Uni birinchi ochib qabul qilgan kishi do'stingizga aylanadi.
    Havola 7 kun amal qiladi.
  </p>

  {#if loading && !current}
    <p class="muted">Havola tayyorlanmoqda…</p>
  {:else if current}
    <input class="link" readonly value={current.url} aria-label="Taklif havolasi" onfocus={(e) => e.currentTarget.select()} />
    <div class="actions">
      {#if canShare}
        <button class="btn primary" onclick={share}><Icon name="share" size={20} /> Ulashish</button>
      {/if}
      <button class="btn" class:primary={!canShare} onclick={copy}>
        <Icon name="copy" size={20} />
        {copied ? 'Nusxalandi' : 'Nusxalash'}
      </button>
    </div>
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if invites.length > 1}
    <h3>Faol havolalar</h3>
    <ul>
      {#each invites as inv (inv.token)}
        <li class:current={inv.token === current?.token}>
          <button
            class="pick"
            onclick={() => {
              current = inv;
              copied = false;
            }}
          >
            …{inv.token.slice(-6)}
            <small>{shortTime(inv.expiresAt)} gacha</small>
          </button>
          <button class="icon-btn" aria-label="Havolani bekor qilish" title="Bekor qilish" onclick={() => revoke(inv)}>
            <Icon name="trash" size={20} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <footer>
    <button class="btn ghost" onclick={newLink}><Icon name="plus" size={20} /> Yangi havola</button>
    {#if current && invites.length === 1}
      <button class="btn ghost danger" onclick={() => current && revoke(current)}>Havolani bekor qilish</button>
    {/if}
  </footer>
</dialog>

<style>
  dialog {
    width: min(100% - 32px, 460px);
    padding: 20px;
    border: 0;
    border-radius: 18px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 24px 60px rgb(14 26 51 / 0.28);
  }

  dialog::backdrop {
    background: rgb(14 26 51 / 0.45);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: -6px -8px 8px 0;
  }

  h2 {
    font-size: 20px;
  }

  h3 {
    margin: 20px 0 6px;
    font-size: 15px;
  }

  .lead,
  .muted {
    color: var(--ink-2);
    font-size: 15px;
    margin-bottom: 16px;
  }

  .link {
    font-size: 15px;
    color: var(--ink-2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .error {
    margin-top: 12px;
    color: var(--anor);
    font-size: 15px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    border-radius: 10px;
  }

  li.current {
    background: var(--turq-soft);
  }

  .pick {
    flex: 1;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .pick small {
    color: var(--ink-2);
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    margin: 16px -12px -8px;
  }

  .danger {
    color: var(--anor);
  }
</style>
