<svelte:head>
  <title>Lalo's Map App</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl/dist/maplibre-gl.css"/>
</svelte:head>

<slot></slot>

<style>
  :global(body, html) {
    height: 100%;
    width: 100%;
    margin: 0;
    overflow: hidden;
    font-family: Inter, system-ui, sans-serif;
    background: #fff;
  }

  :global(*) {
    box-sizing: border-box;
  }
</style>