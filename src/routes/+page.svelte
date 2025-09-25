<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import maplibregl from 'maplibre-gl';

  // --- CONFIG ---
  const C = {
    API: "http://localhost:3000",
    START: [-118.258683, 34.017235], ZREF: 16, MINPX: 8, MAXPX: 349, GOAL: 229 * 60 * 1000, SPEED: 1.35,
    RAD_M: 1609.344, D2R: Math.PI / 180, E111: 111320,
    MAX_CMT: 15, LS_ID: "lm_postId", LS_CMT: "lm_comment", LS_DEV: "lm_deviceId", LS_PX: "lm_pxSaved"
  };

  // --- STATE ---
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
  let mapZoom = 11; // <-- For lag fix

  // --- REACTIVE DERIVED STATE ---
  $: curPx = Math.round(C.MINPX + (C.MAXPX - C.MINPX) * (1 - Math.pow(1 - Math.min(1, Math.max(0, tAct / C.GOAL)), 3)));

  // --- CORE LOGIC ---
  const Geo = {
    off: (lng, lat, dx, dy) => ({ lng: lng + dx / (C.E111 * Math.cos(lat * C.D2R) || 1e-9), lat: lat + dy / C.E111 }),
    quad: (lng, lat, w, h) => { const tl = Geo.off(lng, lat, -w/2, +h/2), tr = Geo.off(lng, lat, +w/2, +h/2), br = Geo.off(lng, lat, +w/2, -h/2), bl = Geo.off(lng, lat, -w/2, -h/2); return [[tl.lng, tl.lat], [tr.lng, tr.lat], [br.lng, br.lat], [bl.lng, bl.lat]] },
    hav: (a, b, c, d) => { const R = 6371000, p1 = b * C.D2R, p2 = d * C.D2R, dp = (d - b) * C.D2R, dl = (c - a) * C.D2R, x = Math.sin(dp/2)**2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2)**2; return 2 * R * Math.asin(Math.sqrt(x)) },
    inside: (lng, lat) => userCenter ? Geo.hav(lng, lat, userCenter.lng, userCenter.lat) <= C.RAD_M : false,
  };

  const Api = {
    j: (u, o) => fetch(u, o).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json() }),
    upload: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return Api.j(`${C.API}/api/upload`, { method: 'POST', body: formData });
    },
    save: (body) => {
      const url = savedId ? `${C.API}/api/posts/${savedId}` : `${C.API}/api/posts`;
      const method = savedId ? 'PATCH' : 'POST';
      return Api.j(url, { method, headers: { "Content-Type": "application/json", "X-Device-Id": deviceId }, body: JSON.stringify(body) });
    }
  };
  
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

  async function loadFile(e) {
    const file = e.target.files[0];
    if (!file || !anchor) return;
    
    isUploading = true;
    try {
      const { url } = await Api.upload(file);
      imgURL = url;
      const im = new Image();
      im.crossOrigin = "anonymous";
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
      const res = await Api.save({
        lng: anchor.lng,
        lat: anchor.lat,
        mediaType: 'img',
        url: imgURL,
        comment: commentText || null,
        natSize: natSize.w ? natSize : null,
        pxAtPlace: curPx,
        userCenter,
        deviceId
      });
      if (res.id) savedId = res.id;
    } catch (err) {
      console.error("Save failed", err);
    }
  }

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

    map.on('mousemove', (e) => {
      if (step === 2) {
        ghostCoords = e.lngLat;
      }
    });

    map.on('mouseout', () => {
      ghostCoords = null;
    });

    map.on('zoomend', () => { // <-- For lag fix
      mapZoom = map.getZoom();
    });
    
    const timer = setInterval(() => {
        if (tAct < C.GOAL) {
            tAct += 1000 * C.SPEED;
        }
    }, 1000);
    
    return () => {
      clearInterval(timer);
      map.remove();
    };
  });
  
  // --- Reactive Effects ---
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
  
  // --- UPDATED THIS BLOCK FOR LAG FIX ---
  $: if (mapZoom) { // This will run only when zoom changes
    fit(curPx);
    lockM();
  }

  $: if (browser && map && step === 2 && ghostCoords && Geo.inside(ghostCoords.lng, ghostCoords.lat)) {
    // This now only calculates position, which is fast
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
  </div>
{/if}

<style>
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
    width: 560px;
    max-width: 92vw;
    color: #e5e7eb;
    background: #000;
    border-radius: 14px;
    box-shadow: 0 16px 40px rgba(0,0,0,.55);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ui.compact {
    width: auto;
    max-width: none;
    padding: 8px 10px;
    border-radius: 12px;
    flex-direction: row;
    align-items: center;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .input, .btn, .tag {
    padding: 10px 12px;
    border: 0;
    border-radius: 10px;
    background: #0a0a0a;
    color: #e5e7eb;
    outline: 0;
    font-family: inherit;
    font-size: 14px;
  }
  .input.tiny {
    padding: 6px 8px;
    min-width: 120px;
    font-size: 12px;
  }
  .btn {
    cursor: pointer;
  }
  .btn:hover {
    background: #111;
  }
  .btn[disabled] {
    opacity: .5;
    cursor: not-allowed;
  }
  .tag {
    font-weight: 600;
    font-size: 12px;
  }
  .help {
    font-weight: 600;
    font-size: 12px;
    opacity: .9;
  }
</style>