<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import maplibregl from 'maplibre-gl';
  import { supabase } from '$lib/supabaseClient'; // <-- CHANGE: Import Supabase client

  // This 'data' prop is how SvelteKit passes data from your +page.js
  export let data;

  // --- CONFIG (Removed old API URL) ---
  const C = {
    START: [-118.258683, 34.017235], ZREF: 16, MINPX: 8, MAXPX: 349, GOAL: 229 * 60 * 1000, SPEED: 1.35,
    RAD_M: 1609.344, D2R: Math.PI / 180, E111: 111320,
    MAX_CMT: 15, LS_ID: "lm_postId", LS_CMT: "lm_comment", LS_DEV: "lm_deviceId", LS_PX: "lm_pxSaved"
  };

  // --- STATE (Mostly unchanged) ---
  let map;
  let mapContainer;
  let step = 1;
  let anchor = null;
  let userCenter = null;
  let imgURL = "";
  let commentText = "";
  let tAct = 0;
  let savedId = "";
  let deviceId = "";
  let mediaReady = false;
  let natSize = { w: 0, h: 0 };
  let geoSize = { w: 0, h: 0 };
  let baseSize = { w: 0, h: 0 };
  let isCompact = false;
  let isUploading = false;
  let ghostCoords = null;
  let mapZoom = 11;

  // --- REACTIVE DERIVED STATE (Unchanged) ---
  $: curPx = Math.round(C.MINPX + (C.MAXPX - C.MINPX) * (1 - Math.pow(1 - Math.min(1, Math.max(0, tAct / C.GOAL)), 3)));

  // --- CORE LOGIC (Geo functions are unchanged) ---
  const Geo = {
    off: (lng, lat, dx, dy) => ({ lng: lng + dx / (C.E111 * Math.cos(lat * C.D2R) || 1e-9), lat: lat + dy / C.E111 }),
    quad: (lng, lat, w, h) => { const tl = Geo.off(lng, lat, -w/2, +h/2), tr = Geo.off(lng, lat, +w/2, +h/2), br = Geo.off(lng, lat, +w/2, -h/2), bl = Geo.off(lng, lat, -w/2, -h/2); return [[tl.lng, tl.lat], [tr.lng, tr.lat], [br.lng, br.lat], [bl.lng, bl.lat]] },
    hav: (a, b, c, d) => { const R = 6371000, p1 = b * C.D2R, p2 = d * C.D2R, dp = (d - b) * C.D2R, dl = (c - a) * C.D2R, x = Math.sin(dp/2)**2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2)**2; return 2 * R * Math.asin(Math.sqrt(x)) },
    inside: (lng, lat) => userCenter ? Geo.hav(lng, lat, userCenter.lng, userCenter.lat) <= C.RAD_M : false,
  };
  
  // --- CORE LOGIC (fit and lockM are unchanged) ---
  function fit(px) {
    if (!natSize.w || !natSize.h) { baseSize = {w: px, h: px}; return; }
    const a = natSize.w / natSize.h;
    baseSize = a >= 1 ? { w: px, h: Math.round(px / a) } : { h: px, w: Math.round(px * a) };
  }

  function lockM() {
    if (!map) return;
    const c = anchor || map.getCenter();
    const p = map.project([c.lng, c.lat]);
    const x = map.unproject([p.x + 1, p.y]);
    const y = map.unproject([p.x, p.y + 1]);
    const r = { x: Math.abs((x.lng - c.lng) * (C.E111 * Math.cos(c.lat * C.D2R) || 1e-9)), y: Math.abs((y.lat - c.lat) * C.E111) };
    const s = Math.pow(2, map.getZoom() - C.ZREF);
    geoSize = { w: baseSize.w * r.x * s, h: baseSize.h * r.y * s };
  }

  // --- UPDATED CORE LOGIC: loadFile now handles image upload to /api/upload ---
  async function loadFile(e) {
    const file = e.target.files[0];
    if (!file || !anchor) return;

    isUploading = true;
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Upload failed');

      const { url } = await response.json();
      imgURL = url; 

      const im = new Image();
      im.onload = () => {
        natSize = { w: im.naturalWidth, h: im.naturalHeight };
        applyMedia();
      };
      im.src = url;
    } catch (err) {
      console.error(err);
      alert('Upload failed. Try again.');
    } finally {
      isUploading = false;
    }
  }

  function applyMedia() {
    if (!anchor) return;
    const source = map.getSource('s');
    const coords = Geo.quad(anchor.lng, anchor.lat, geoSize.w, geoSize.h);
    
    if (!source) {
      map.addSource('s', { type: 'image', url: imgURL, coordinates: coords });
      map.addLayer({ id: 'l', type: 'raster', source: 's' });
    } else {
      source.updateImage({ url: imgURL, coordinates: coords });
    }
    mediaReady = true;
  }
  
  function geoOnce() {
    navigator.geolocation.getCurrentPosition(p => {
      userCenter = { lng: p.coords.longitude, lat: p.coords.latitude };
      map.easeTo({ center: [userCenter.lng, userCenter.lat], zoom: 14 });
      step = 2;
    }, () => alert("Couldn't get location. Check site permissions."), { enableHighAccuracy: true });
  }
  
  function placeOnClick(e) {
    if (step !== 2) return;
    const { lng, lat } = e.lngLat;
    if (Geo.inside(lng, lat)) {
      anchor = { lng, lat };
      step = 3;
    } else {
      alert('Please place inside the 1-mile radius.');
    }
  }
  
  async function saveAndCompact() {
    isCompact = true;
    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment: commentText || null,
          lat: anchor.lat,
          lng: anchor.lng,
          image_url: imgURL // Send the new image URL
        })
      });

      if (!response.ok) throw new Error('Failed to save post');

      const newPost = await response.json();
      if (newPost.id) savedId = newPost.id;

      new maplibregl.Marker()
        .setLngLat([newPost.lng, newPost.lat])
        .setPopup(new maplibregl.Popup().setText(newPost.comment))
        .addTo(map);

    } catch (err) {
      console.error("Save failed", err);
      alert("Save failed. Please try again.");
    }
  }

  // --- UPDATED: Added validation to prevent map crash ---
  onMount(() => {
    deviceId = localStorage.getItem(C.LS_DEV) || crypto.randomUUID();
    localStorage.setItem(C.LS_DEV, deviceId);
    commentText = localStorage.getItem(C.LS_CMT) || "";

    map = new maplibregl.Map({
      container: mapContainer,
      style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
      center: C.START,
      zoom: 11
    });

    map.doubleClickZoom.disable();
    map.on('click', placeOnClick);
    map.on('mousemove', (e) => { if (step === 2) { ghostCoords = e.lngLat; } });
    map.on('mouseout', () => { ghostCoords = null; });
    map.on('zoomend', () => { mapZoom = map.getZoom(); });
    
    // Add markers for posts loaded from the database
    map.on('load', () => {
      for (const post of data.posts) {
        
        // **CRITICAL FIX:** Validate lat/lng before creating marker
        const isLatLngValid = !isNaN(post.lat) && post.lat >= -90 && post.lat <= 90 && !isNaN(post.lng) && post.lng >= -180 && post.lng <= 180;

        if (!isLatLngValid) {
          console.warn(`Skipping post ID ${post.id}: Invalid coordinates (lat: ${post.lat}, lng: ${post.lng})`);
          continue; 
        }

        let popupHTML = `<p style="margin: 0; font-weight: 600;">${post.comment || 'No comment'}</p>`;

        if (post.image_url) {
          popupHTML = `
            <div style="padding: 0; max-width: 250px;">
              <img 
                src="${post.image_url}" 
                alt="${post.comment || 'Uploaded image'}" 
                style="width: 100%; height: auto; border-radius: 8px; margin-bottom: 8px;"
              />
              <p style="margin: 0; font-size: 0.9rem;">${post.comment || 'No comment'}</p>
            </div>
          `;
        }

        new maplibregl.Marker()
          .setLngLat([post.lng, post.lat])
          .setPopup(new maplibregl.Popup().setHTML(popupHTML)) // Use setHTML here
          .addTo(map);
      }
    });

    const timer = setInterval(() => {
        if (tAct < C.GOAL) { tAct += 1000 * C.SPEED; }
    }, 1000);
    
    return () => {
      clearInterval(timer);
      map.remove();
    };
  });
  
  // --- REACTIVE EFFECTS (Unchanged) ---
  $: if (browser && map && userCenter) {
    const r = C.RAD_M;
    const circle = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [Array.from({length: 97}, (_, i) => { const a = i/96*2*Math.PI; const p = Geo.off(userCenter.lng, userCenter.lat, Math.cos(a)*r, Math.sin(a)*r); return [p.lng, p.lat]})]}};
    const source = map.getSource('rad');
    if (!source) {
      map.addSource('rad', { type: 'geojson', data: circle });
      map.addLayer({ id: 'radf', type: 'fill', source: 'rad', paint: { "fill-color": "#2b2b2b", "fill-opacity": 0.05 } });
      map.addLayer({ id: 'radl', type: 'line', source: 'rad', paint: { "line-color": "#2b2b2b", "line-width": 2, "line-opacity": 0.1 }});
    } else {
      source.setData(circle);
    }
  }
  
  $: if (anchor) {
    fit(curPx);
    lockM();
    if (mediaReady) {
      const source = map.getSource('s');
      if (source) source.setCoordinates(Geo.quad(anchor.lng, anchor.lat, geoSize.w, geoSize.h));
    }
  }
  
  $: if (browser) {
    localStorage.setItem(C.LS_CMT, commentText);
  }
  
  $: if (mapZoom) {
    fit(curPx);
    lockM();
  }

  $: if (browser && map && step === 2 && ghostCoords && Geo.inside(ghostCoords.lng, ghostCoords.lat)) {
    const coords = Geo.quad(ghostCoords.lng, ghostCoords.lat, geoSize.w, geoSize.h);
    const poly = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] } };

    const source = map.getSource('gb');
    if (!source) {
        map.addSource('gb', { type: 'geojson', data: poly });
        map.addLayer({ id: 'gbf', type: 'fill', source: 'gb', paint: { 'fill-color': '#1e90ff', 'fill-opacity': 0.08 } });
        map.addLayer({ id: 'gbl', type: 'line', source: 'gb', paint: { 'line-color': '#1e90ff', 'line-width': 2 } });
    } else {
        source.setData(poly);
    }
  } else if (browser && map) {
      const source = map.getSource('gb');
      if (source) {
          if (map.getLayer('gbl')) map.removeLayer('gbl');
          if (map.getLayer('gbf')) map.removeLayer('gbf');
          if (map.getSource('gb')) map.removeSource('gb');
      }
  }

  $: if (browser && map) {
    if (step === 2) {
      map.getCanvas().style.cursor = 'none';
    } else {
      map.getCanvas().style.cursor = '';
    }
  }
</script>

<div class="map-container" bind:this={mapContainer}></div>

{#if !isCompact}
  <div class="ui">
    <div class="row">
      <span class="tag">Location: {userCenter ? 'Confirmed' : '—'}</span>
    </div>

    {#if step === 1}
      <div class="row">
        <span class="tag">1/3</span>
        <button class="btn" on:click={geoOnce}>📍 Use my location</button>
      </div>
    {/if}

    {#if step === 2}
      <div class="row">
        <span class="tag">2/3</span>
        <span class="help">Click on the map to place</span>
      </div>
    {/if}

    {#if step === 3}
      <div class="row">
        <span class="tag">3/3</span>
        <input type="file" id="file-input" accept="image/*" on:change={loadFile} style="display: none;">
        <button id="pick" class="btn" on:click={() => document.getElementById('file-input').click()} disabled={isUploading}>
          {isUploading ? 'Uploading…' : 'Upload image'}
        </button>
        {#if mediaReady}
          <button class="btn" on:click={saveAndCompact}>✓ Done</button>
        {/if}
      </div>
      <div class="row">
        <span class="tag">Size: {curPx}px / {C.MAXPX}px</span>
        <span class="tag">rate: {C.SPEED}×</span>
      </div>
    {/if}

  </div>
{:else}
  <div class="ui compact">
    <span class="tag">Size: {curPx}px / {C.MAXPX}px</span>
    <input class="input tiny" type="text" maxlength="15" placeholder="comment…" bind:value={commentText}/>
    <a href="{imgURL}" target="_blank" style="font-size: 0.9rem; color: #1e90ff; text-decoration: none;">View Image</a>
  </div>
{/if}

<style>
  :root {
    --fg: #e5e7eb;
    --bg: #000;
    --bg-s: #0a0a0a;
    --bg-h: #111;
    --r: 1.5rem;
    --g: 8px;
  }
  
  .map-container {
    position: fixed;
    inset: 0;
  }
  
  .ui {
    position: fixed;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    z-index: 2147483647;
    width: 360px;
    max-width: 92vw;
    color: var(--fg);
    background: var(--bg);
    border-radius: var(--r);
    padding: 12px;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
  }
  
  .ui .row {
    display: flex;
    gap: var(--g);
    align-items: center;
    flex-wrap: wrap;
  }
  
  .ui :where(.input, .btn, .tag) {
    padding: 10px 12px;
    border: 0;
    border-radius: var(--r);
    color: inherit;
    outline: 0;
    font: inherit;
    background: var(--bg-s);
  }
  
  .ui .input.tiny {
    padding: 6px 8px;
    min-width: 120px;
    font-size: 12px;
  }
  
  .ui .btn {
    cursor: pointer;
  }
  .ui .btn:hover {
    background: var(--bg-h);
  }
  .ui .btn[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .ui :where(.tag, .help) {
    font-weight: 600;
    font-size: 12px;
  }
  
  .ui .help {
    opacity: 0.9;
  }
  
  @container (width < 420px) {
    .ui {
      width: auto;
      max-width: none;
      padding: 8px 10px;
      border-radius: 0;
      flex-direction: row;
      align-items: center;
    }
  }
</style>