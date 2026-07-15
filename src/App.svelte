<script>
  let count = $state(0);
</script>

<main>
  <h1>Svelte-Setup OK</h1>
  <p>Phase 0 (TOOLING_SPEC.md): Svelte 5 rendert über Vite in diesem Projekt.</p>
  <button onclick={() => count++}>Klicks: {count}</button>
</main>

<style>
  main {
    font-family: system-ui, sans-serif;
    background: #0f172a;
    color: #cbd5e1;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }
  button {
    background: #118ab2;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.5rem 1rem;
    font-size: 1rem;
    cursor: pointer;
  }
</style>
