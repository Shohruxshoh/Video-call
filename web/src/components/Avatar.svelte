<script lang="ts" module>
  // Glaze colors from Samarkand tilework; each friend keeps one.
  const TILES = ['#0f7f80', '#2d4a9a', '#b8740f', '#b8352c', '#3f7f4e', '#5b4a9e'];
  // Eight-pointed girih star (two overlapping squares) in a 100×100 box.
  export const STAR =
    '50,0 64.64,14.64 85.36,14.64 85.36,35.36 100,50 85.36,64.64 85.36,85.36 64.64,85.36 50,100 35.36,85.36 14.64,85.36 14.64,64.64 0,50 14.64,35.36 14.64,14.64 35.36,14.64';
</script>

<script lang="ts">
  let {
    name,
    id,
    size = 46,
    online = false,
  }: { name: string; id: number; size?: number; online?: boolean } = $props();

  const color = $derived(TILES[Math.abs(id) % TILES.length]);
  const initial = $derived((name.trim()[0] ?? '?').toUpperCase());
</script>

<span class="avatar" style:--size="{size}px" style:--tile={color}>
  <svg viewBox="-6 -6 112 112" aria-hidden="true">
    <polygon class="star" points={STAR} />
    <polygon class="inlay" points={STAR} transform="translate(50 50) scale(0.7) translate(-50 -50)" />
  </svg>
  <span class="initial" aria-hidden="true">{initial}</span>
  {#if online}<span class="dot"><span class="visually-hidden">tarmoqda</span></span>{/if}
</span>

<style>
  .avatar {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: var(--size);
    height: var(--size);
    flex: none;
  }

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .star {
    fill: var(--tile);
    stroke: var(--tile);
    stroke-width: 9;
    stroke-linejoin: round;
  }

  .inlay {
    fill: none;
    stroke: rgb(255 255 255 / 0.38);
    stroke-width: 3;
    stroke-linejoin: round;
  }

  .initial {
    position: relative;
    color: #fff;
    font-weight: 650;
    font-size: calc(var(--size) * 0.36);
    line-height: 1;
  }

  .dot {
    position: absolute;
    right: 0;
    bottom: 0;
    width: max(10px, 26%);
    height: max(10px, 26%);
    border-radius: 50%;
    background: var(--online);
    border: 2px solid var(--surface);
  }
</style>
