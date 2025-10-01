<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import maplibregl from 'maplibre-gl';

  export let data;

  // --- CONFIG ---
  const C = {
    START: [-118.258683, 34.017235], ZREF: 16, MINPX: 8, MAXPX: 349, GOAL: 229 * 60 * 1000, SPEED: 1.35,
    RAD_M: 1609.344, D2R: Math.PI / 180, E111: 111320,
    MAX_CMT: 15, LS_ID: "lm_postId", LS_CMT: "lm_comment", LS_DEV: "lm_deviceId", LS_PX: "lm_pxSaved",
    SAVE_DPX: 4,
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
  let mapZoom = 11;
  let lastPxSaved = 0;
  let timer;
  
  let domCmt = null;
  let youMarker = null;
  let isMobile = false;

  // Set to track posts already on the map
  let displayedPostIds = new Set();

  $: curPx = Math.round(C.MINPX + (C.MAXPX - C.MINPX) * (1 - Math.pow(1 - Math.min(1, Math.max(0, tAct / C.GOAL)), 3)));

  const saveComment = (() => {
      let timeout;
      return async () => {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(async () => {
              const trimmedComment = commentText.slice(0, C.MAX_CMT).trim();
              if (!savedId) return;
              try {
                  await fetch(`/api/items?id=${savedId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ comment: trimmedComment || null })
                  });
              } catch (e) {
                  console.error("Failed to save comment:", e);
              }
          }, 400);
      };
  })();

  const Geo = {
    off: (lng, lat, dx, dy) => ({ lng: lng + dx / (C.E111 * Math.cos(lat * C.D2R) || 1e-9), lat: lat + dy / C.E111 }),
    quad: (lng, lat, w, h) => { const tl = Geo.off(lng, lat, -w/2, +h/2), tr = Geo.off(lng, lat, +w/2, +h/2), br = Geo.off(lng, lat, +w/2, -h/2), bl = Geo.off(lng, lat, -w/2, -h/2); return [[tl.lng, tl.lat], [tr.lng, tr.lat], [br.lng, br.lat], [bl.lng, bl.lat]] },
    hav: (a, b, c, d) => { const R = 6371000, p1 = b * C.D2R, p2 = d * C.D2R, dp = (d - b) * C.D2R, dl = (c - a) * C.D2R, x = Math.sin(dp/2)**2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2)**2; return 2 * R * Math.asin(Math.sqrt(x)) },
    inside: (lng, lat) => userCenter ? Geo.hav(lng, lat, userCenter.lng, userCenter.lat) <= C.RAD_M : false,
  };

  function youPos() {
      if (!anchor) return null;
      lockM();
      return [anchor.lng, anchor.lat + ((geoSize.h / 2) + 10) / C.E111];
  }
  function showYou() {
      const p = youPos();
      if (!p || !map) return;
      if (domCmt) domCmt.remove();
      domCmt = null;
      if (!youMarker) {
          const el = document.createElement("div");
          el.textContent = "you";
          el.style.cssText = "font:600 11px/1 Inter,system-ui;color:#111;background:#fff;padding:2px 6px;border-radius:999px;border:1px solid #ddd;box-shadow:0 1px 2px rgba(0,0,0,.06);pointer-events:none;";
          youMarker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(p).addTo(map);
      } else {
          youMarker.setLngLat(p);
      }
  }
  function hideYou() {
      if (youMarker) youMarker.remove();
      youMarker = null;
  }
  
  function restoreState(post) {
    if (!post || !post.lng || !post.lat) {
      console.log('No post to restore.');
      return;
    }
    savedId = post.id;
    anchor = { lng: post.lng, lat: post.lat };
    imgURL = post.image_url;
    commentText = post.comment || '';
    userCenter = post.usercenter || null;
    if (post.natsize) {
      natSize = post.natsize;
    }
    const px = post.pxatplace || C.MINPX;
    const y = Math.max(0, (px - C.MINPX) / (C.MAXPX - C.MINPX));
    tAct = (1 - Math.cbrt(1 - y)) * C.GOAL;
    lastPxSaved = px;
    step = 3;
    isCompact = true;
    console.log('State restored for post ID:', savedId);
  }

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
  
  async function maybeSaveSize(curPx) {
    if (Math.abs(curPx - lastPxSaved) >= C.SAVE_DPX) {
      try {
        await fetch(`/api/items?id=${savedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pxatplace: curPx }),
          keepalive: true
        });
        lastPxSaved = curPx;
      } catch (e) {
        console.error('Failed to save size', e);
      }
    }
  }

  async function finalSave() {
    if (!savedId) return;
    try {
      await fetch(`/api/items?id=${savedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pxAtPlace: curPx }),
        keepalive: true
      });
    } catch (e) {
      console.error('Final save failed', e);
    }
  }

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
    if (!anchor || !map) return;
    const source = map.getSource('s');
    lockM(); 
    const coords = Geo.quad(anchor.lng, anchor.lat, geoSize.w, geoSize.h);
    if (!source) {
      map.addSource('s', { type: 'image', url: imgURL, coordinates: coords });
      map.addLayer({ id: 'l', type: 'raster', source: 's', paint: { 'raster-fade-duration': 0 } });
    } else {
      source.setCoordinates(coords); 
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
    if (step !== 2 || isMobile) return;
    const { lng, lat } = e.lngLat;
    if (Geo.inside(lng, lat)) {
      anchor = { lng, lat };
      step = 3;
    } else {
      alert('Please place inside the 1-mile radius.');
    }
  }
  
  function placeAtCenter() {
    if (step !== 2) return;
    const { lng, lat } = map.getCenter();
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
      const response = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment: commentText || null,
          lat: anchor.lat,
          lng: anchor.lng,
          image_url: imgURL,
          userCenter: userCenter,
          natSize: natSize,
          pxAtPlace: curPx
        })
      });
      if (!response.ok) throw new Error('Failed to save post');
      const newPost = await response.json();
      if (newPost.id) savedId = newPost.id;
    } catch (err) {
      console.error("Save failed", err);
      alert("Save failed. Please try again.");
    }
  }

  function isNewDay() {
    const RESET_HOUR = 3;
    const now = new Date().getTime();
    const lastReset = parseInt(localStorage.getItem('lm_lastReset') || '0');
    const todaysReset = new Date();
    todaysReset.setHours(RESET_HOUR, 0, 0, 0);
    const todaysResetTime = todaysReset.getTime();
    if (now > todaysResetTime && lastReset < todaysResetTime) {
        console.log("Daily reset triggered.");
        localStorage.setItem('lm_lastReset', now.toString());
        return true;
    }
    return false;
  }

  async function loadPostsInView() {
    if (!map || map.isMoving()) return;
    
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    try {
      const response = await fetch(`/api/items/near?min_lon=${sw.lng}&min_lat=${sw.lat}&max_lon=${ne.lng}&max_lat=${ne.lat}`);
      if (!response.ok) throw new Error('Failed to fetch nearby posts');

      const posts = await response.json();

      for (const post of posts) {
        const isLatLngValid = !isNaN(post.lat) && post.lat >= -90 && post.lat <= 90 && !isNaN(post.lng) && post.lng >= -180 && post.lng <= 180;
        if (!post.image_url || !isLatLngValid) continue; 

        // Ignore our own post
        if (savedId && post.id === savedId) {
            continue;
        }

        const sourceId = `post-src-${post.id}`;
        const layerId = `post-layer-${post.id}`;
        
        // Handle comment updates
        const existingMarker = document.querySelector(`[data-post-id="${post.id}"]`);
        if (post.comment) {
          // If the post has a comment, and a marker doesn't exist, create one
          if (!existingMarker) {
            const el = document.createElement("div");
            el.style.cssText = "font:700 11px/1.2 Inter;color:#111;background:rgba(255,255,255,.9);padding:3px 7px;border-radius:8px;border:1px solid rgba(0,0,0,.1);box-shadow:0 1px 4px rgba(0,0,0,.15);pointer-events:none;max-width:150px;text-align:center;";
            el.textContent = post.comment;
            el.dataset.postId = post.id;
            const otherNatSize = post.natsize || { w: 256, h: 256 };
            const a = otherNatSize.w / otherNatSize.h;
            const otherBaseSize = a >= 1 ? { w: post.pxatplace || C.MINPX, h: Math.round((post.pxatplace || C.MINPX) / a) } : { h: post.pxatplace || C.MINPX, w: Math.round((post.pxatplace || C.MINPX) * a) };
            const c = { lng: post.lng, lat: post.lat };
            const p = map.project([c.lng, c.lat]);
            const x = map.unproject([p.x + 1, p.y]);
            const y = map.unproject([p.x, p.y + 1]);
            const r = { x: Math.abs((x.lng - c.lng) * (C.E111 * Math.cos(c.lat * C.D2R))), y: Math.abs((y.lat - c.lat) * C.E111) };
            const s = Math.pow(2, map.getZoom() - C.ZREF);
            const otherGeoSize = { w: otherBaseSize.w * r.x * s, h: otherBaseSize.h * r.y * s };
            const latUp = post.lat + ((otherGeoSize.h / 2) + 5) / C.E111;
            new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([post.lng, latUp]).addTo(map);
          } else {
            // If a marker exists, check if the comment text has changed and update it
            if (existingMarker.textContent !== post.comment) {
              existingMarker.textContent = post.comment;
            }
          }
        } else if (existingMarker) {
          // If the post no longer has a comment but a marker exists, remove it
          existingMarker.remove();
        }

        // Only add the image layer if it doesn't already exist on the map
        if (!displayedPostIds.has(post.id)) {
          displayedPostIds.add(post.id);

          const otherNatSize = post.natsize || { w: 256, h: 256 };
          const otherCurPx = post.pxatplace || C.MINPX;
          const a = otherNatSize.w / otherNatSize.h;
          const otherBaseSize = a >= 1 ? { w: otherCurPx, h: Math.round(otherCurPx / a) } : { h: otherCurPx, w: Math.round(otherCurPx * a) };
          const c = { lng: post.lng, lat: post.lat };
          const p = map.project([c.lng, c.lat]);
          const x = map.unproject([p.x + 1, p.y]);
          const y = map.unproject([p.x, p.y + 1]);
          const r = { x: Math.abs((x.lng - c.lng) * (C.E111 * Math.cos(c.lat * C.D2R))), y: Math.abs((y.lat - c.lat) * C.E111) };
          const s = Math.pow(2, map.getZoom() - C.ZREF);
          const otherGeoSize = { w: otherBaseSize.w * r.x * s, h: otherBaseSize.h * r.y * s };
          const coordinates = Geo.quad(post.lng, post.lat, otherGeoSize.w, otherGeoSize.h);
          
          map.addSource(sourceId, { type: 'image', url: post.image_url, coordinates: coordinates });
          map.addLayer({
              id: layerId,
              type: 'raster',
              source: sourceId,
              paint: { 'raster-fade-duration': 0, 'raster-opacity': 0.95 }
          });
        }
      }
    } catch (e) {
      console.error("Failed to load posts in view:", e);
    }
  }

  onMount(() => {
    window.addEventListener('pagehide', finalSave);
    if (browser) {
      isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);
    }
    const startFresh = isNewDay();
    async function initializeUser() {
      deviceId = localStorage.getItem(C.LS_DEV) || crypto.randomUUID();
      localStorage.setItem(C.LS_DEV, deviceId);
      if (browser) {
          document.cookie = `deviceId=${deviceId}; path=/; max-age=${365 * 24 * 60 * 60}; samesite=Lax`;
      }
      if (startFresh) return;
      try {
        const response = await fetch('/api/items/me');
        if (!response.ok) throw new Error('Failed to fetch user post');
        const { post } = await response.json();
        if (post) restoreState(post);
      } catch (e) {
        console.error("Could not initialize user state:", e);
      }
    }

    initializeUser();
    
    map = new maplibregl.Map({
      container: mapContainer,
      center: anchor ? [anchor.lng, anchor.lat] : C.START,
      zoom: anchor ? 14 : 11,
      style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    });

    map.doubleClickZoom.disable();
    map.on('click', placeOnClick);
    map.on('mousemove', (e) => { if (step === 2 && !isMobile) { ghostCoords = e.lngLat; } });
    map.on('mouseout', () => { ghostCoords = null; });
    map.on('zoomend', () => { mapZoom = map.getZoom(); });
    
    let liveFeedInterval;
    map.on('load', () => {
      if (anchor && imgURL) {
        const im = new Image();
        im.onload = () => {
            natSize = { w: im.naturalWidth, h: im.naturalHeight }; 
            applyMedia(); 
            map.easeTo({ center: [anchor.lng, anchor.lat], zoom: 14, duration: 400 }); 
        };
        im.onerror = () => {
            console.error("Failed to load restored image from URL:", imgURL);
        };
        im.src = imgURL;
      }

      loadPostsInView();
      map.on('moveend', loadPostsInView);
      liveFeedInterval = setInterval(loadPostsInView, 10000);
    });

    timer = setInterval(() => {
        if (tAct < C.GOAL) { 
            tAct += 1000 * C.SPEED; 
            if (savedId) maybeSaveSize(curPx); 
        }
    }, 1000);
    
    return () => {
      window.removeEventListener('pagehide', finalSave);
      clearInterval(timer);
      clearInterval(liveFeedInterval);
      map.remove();
    };
  });
  
  $: if (browser && map && anchor) {
    const t = (commentText || "").slice(0, C.MAX_CMT).trim();
    if (!t) {
        if (domCmt) domCmt.remove();
        domCmt = null;
        if (!youMarker) showYou();
    } else {
        hideYou();
        const { lng, lat } = anchor;
        fit(curPx);
        lockM();
        const latUp = lat + ((geoSize.h / 2) + 6) / C.E111;
        if (!domCmt) {
            const el = document.createElement("div");
            el.style.cssText = "font:700 12px/1.25 Inter;color:#111;background:rgba(255,255,255,.98);padding:4px 8px;border-radius:10px;border:1px solid rgba(0,0,0,.12);box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none;";
            el.textContent = t;
            domCmt = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, latUp]).addTo(map);
        } else {
            domCmt.setLngLat([lng, latUp]);
            domCmt.getElement().textContent = t;
        }
        saveComment(); 
    }
  }
  
  $: if (browser && map) {
    if (userCenter) {
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
    
    if (anchor) {
      fit(curPx);
      lockM();
      if (mediaReady) {
        const source = map.getSource('s');
        if (source) source.setCoordinates(Geo.quad(anchor.lng, anchor.lat, geoSize.w, geoSize.h));
      }
    }
  }
  
  $: if (browser && map && step === 2 && !isMobile) {
    if (ghostCoords && Geo.inside(ghostCoords.lng, ghostCoords.lat)) {
      fit(curPx);
      lockM();
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
    } else {
        const source = map.getSource('gb');
        if (source) {
            if (map.getLayer('gbl')) map.removeLayer('gbl');
            if (map.getLayer('gbf')) map.removeLayer('gbf');
            if (map.getSource('gb')) map.removeSource('gb');
        }
    }
    map.getCanvas().style.cursor = ghostCoords && Geo.inside(ghostCoords.lng, ghostCoords.lat) ? 'crosshair' : 'none';
  } else if (browser && map && (step !== 2 || isMobile)) {
      const source = map.getSource('gb');
      if (source) {
          if (map.getLayer('gbl')) map.removeLayer('gbl');
          if (map.getLayer('gbf')) map.removeLayer('gbf');
          if (map.getSource('gb')) map.removeSource('gb');
      }
      map.getCanvas().style.cursor = '';
  }

  $: if (browser) {
    localStorage.setItem(C.LS_CMT, commentText);
  }
</script>

{#if step === 2 && isMobile}
  <div class="mobile-crosshair">+</div>
{/if}

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
        {#if isMobile}
          <span class="help">Pan the map to position</span>
          <button class="btn" on:click={placeAtCenter}>📍 Place Here</button>
        {:else}
          <span class="help">Click on the map to place</span>
        {/if}
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
  
  .mobile-crosshair {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1000;
    font-size: 32px;
    font-weight: 500;
    color: #1e90ff;
    pointer-events: none;
    text-shadow: 0 0 5px rgba(255, 255, 255, 0.8);
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