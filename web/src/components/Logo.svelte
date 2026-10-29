<script lang="ts">
  import { STAR } from './Avatar.svelte';

  let { size = 32 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="-6 -6 112 112" aria-hidden="true">
  <polygon points={STAR} fill="var(--turq)" stroke="var(--turq)" stroke-width="9" stroke-linejoin="round" />
  <polygon
    points={STAR}
    fill="var(--lapis)"
    stroke="var(--lapis)"
    stroke-width="6"
    stroke-linejoin="round"
    transform="translate(50 50) scale(0.46) rotate(22.5) translate(-50 -50)"
  />
</svg>
