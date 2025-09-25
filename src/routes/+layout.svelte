<svelte:head>
  <title>HUD Map — 1-mile</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css"/>
  <link rel="icon" href="data:,">
</svelte:head>

<slot></slot>

<style>
  :global(body, html) {
    height: 100%;
    width: 100%;
    margin: 0;
    overflow: hidden;
    font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial;
    background: #fff;
  }

  :global(*) {
    box-sizing: border-box;
  }
</style>