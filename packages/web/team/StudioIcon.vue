<script setup lang="ts">
withDefaults(defineProps<{ name?: string }>(), { name: "spark" });
const paths: Record<string, string> = {
  spark: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z",
  image: "M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M8 8h.01",
  text: "M4 5h16M12 5v15M8 20h8",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  clock: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 8v5l3 2",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z",
  people:
    "M8 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-2a6 6 0 0 1 12 0v2M16 6a4 4 0 0 1 0 8M17 17a5 5 0 0 1 5 4",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  copy: "M8 8h12v12H8zM16 4H4v12",
  check: "m5 12 4 4L19 6",
  chart: "M5 20V10M12 20V4M19 20v-7",
};
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.55"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="studio-icon"
  >
    <path :d="paths[name] || paths.spark" />
  </svg>
</template>
