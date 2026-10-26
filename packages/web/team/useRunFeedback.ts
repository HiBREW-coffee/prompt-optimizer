import { ref, onBeforeUnmount } from "vue";
export function useRunFeedback() {
  const elapsed = ref(0);
  let candidate: HTMLButtonElement | null = null, running: HTMLButtonElement | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  function capture(event: Event) {
    const submitter = "submitter" in event ? (event as SubmitEvent).submitter : null;
    const target = submitter ?? event.target;
    candidate = target instanceof Element ? target.closest("button") : null;
  }
  function end() {
    if (timer) clearInterval(timer);
    timer = undefined;
    running?.classList.remove("run-pending");
    running?.removeAttribute("aria-busy");
    running = null;
    candidate = null;
  }
  function begin() {
    running = candidate;
    running?.classList.add("run-pending");
    running?.setAttribute("aria-busy", "true");
    elapsed.value = 0;
    const start = Date.now();
    timer = setInterval(() => { elapsed.value = Math.max(0, Math.floor((Date.now() - start) / 1000)); }, 1000);
  }
  onBeforeUnmount(end);
  return { capture, begin, end, elapsed };
}
