<script>
  // TargetBankCanvas (TOOLING_SPEC.md Phase 4a) - Wrapper um das
  // bestehende Canvas-Rendering (renderFrame() + Helfer) aus sqrt2.html.
  // Die Zeichen-Logik wurde 1:1 portiert (NICHT neu designt), nur die
  // Datenquelle wechselt: statt Modul-Scope-Variablen in sqrt2.html
  // hält DIESE Komponente ihren eigenen Render-State als lokale Variablen
  // (gleiche Namen wie zuvor, damit renderFrame() weitgehend unverändert
  // bleibt) und füllt ihn aus configStore/compiledStore/playbackStore.
  //
  // playbackStore bleibt die Schnittstelle nach außen: <PlaybackBar>/
  // <ControlPanel> schreiben isPlaying/time, applyPlayback() (unten)
  // spiegelt es in die lokalen Variablen zurück, und die rAF-Loop
  // schreibt die fortschreitende Zeit zurück in playbackStore - genau
  // wie zuvor in sqrt2.html, nur in der Komponente gekapselt.
  //
  // Cross-Komponenten-DOM (bankZoomLabel/bankAreaLabel/autoZoomMarker/
  // autoZoomNote werden in <ControlPanel> gerendert, #bankPanel für
  // renderAreaWidth) wird per getElementById geholt - dieselben globalen
  // Elemente wie vorher, nur dass die Komponente sie liest statt
  // sqrt2.html.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { applyCompactionFit } from '../../bank-core.js';
  import { configStore, playbackStore, compiledStore } from '../lib/stores.js';

  const COLORS = ["#cbd5e1", "#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#8338ec", "#f78c6b", "#ff006e", "#3a86ff", "#fb5607", "#ffbe0b"];

  // === Render-State (war in sqrt2.html Modul-Scope) ===
  let N_MAX = 16; let BASE = 10;
  let TOTAL_STEPS = 0; let MAX_TIME = 0; let P_FINAL = 0;
  let render_pipeline = []; let bank_pieces = []; let axes = [];

  let GLOBAL_N_ARR = [];
  let GLOBAL_SHELL_START = [];
  let GLOBAL_BANK_ZOOM = [];
  let GLOBAL_BANK_ZOOM_TIMES = [];
  let GLOBAL_BANK_ZOOM_SPLINE = null;
  let BANK_ZOOM_THRESHOLD_POWERS = 0;
  let GLOBAL_AUTO_ZOOM_CHECKPOINTS = [];
  let GLOBAL_AUTO_ZOOM_SPLINE = null;
  let COMPACTION_ENABLED = false;
  let GLOBAL_COMPACTION_WAYPOINTS = [];
  let GLOBAL_COMPACTION_LOGICAL_LOOKUP = null;
  let GLOBAL_COMPACTION_FIT_SPLINE = null;

  // === Dynamic Layout & HUD-State ===
  let DYN_TARGET_W = 1.0; let dyn_prefA = []; let dyn_axes_w = [];
  let _lastLayoutT_AB = null;

  // === Playback/Laufzeit-State ===
  let isPlaying = false; let animDirection = 1; let animPause = 0;
  let u_time = 0.0; let u_mode_AB = 0.0;
  let AUTO_ZOOM_MIN_PX = 0;
  let RENDER_SCALE = 1;
  let EDGE_BLUR_PX = 0;
  let LINE_WIDTH_PX = 0.3;
  let ANIM_PAUSE_DURATION = 1.5;
  let ANIM_SPEED = 2.0;

  // === Canvas ===
  let canvasEl = $state();
  let ctx = null;
  let bankZoomLabel, bankAreaLabel, autoZoomMarker, autoZoomNote, bankPanel;

  let lastTime = performance.now();
  let _lastCompileKey;
  let _suppressPlaybackRender = false;

  function compileRelevantKey(c) {
    return JSON.stringify([c.base, c.depth, c.transformMode, c.bankZoomThresholdPowers, c.zoomSpeedCoef, c.compactionEnabled, c.compactionTransitionTicks]);
  }
  function applyConfig(c) {
    try {
      N_MAX = c.depth;
      BASE = c.base;
      BANK_ZOOM_THRESHOLD_POWERS = c.bankZoomThresholdPowers;
      u_mode_AB = c.modeAB;
      AUTO_ZOOM_MIN_PX = c.autoZoomMinPx;
      LINE_WIDTH_PX = c.lineWidth;
      ANIM_PAUSE_DURATION = c.pauseDuration;
      ANIM_SPEED = c.playSpeed;

      let compiled = get(compiledStore);
      axes = compiled.axes;
      TOTAL_STEPS = compiled.TOTAL_STEPS;
      bank_pieces = compiled.bank_pieces;
      render_pipeline = compiled.render_pipeline;
      GLOBAL_N_ARR = compiled.GLOBAL_N_ARR;
      P_FINAL = compiled.P_FINAL;
      GLOBAL_SHELL_START = compiled.GLOBAL_SHELL_START;
      GLOBAL_AUTO_ZOOM_CHECKPOINTS = compiled.GLOBAL_AUTO_ZOOM_CHECKPOINTS;
      GLOBAL_AUTO_ZOOM_SPLINE = compiled.GLOBAL_AUTO_ZOOM_SPLINE;
      GLOBAL_BANK_ZOOM_TIMES = compiled.GLOBAL_BANK_ZOOM_TIMES;
      GLOBAL_BANK_ZOOM = compiled.GLOBAL_BANK_ZOOM;
      GLOBAL_BANK_ZOOM_SPLINE = compiled.GLOBAL_BANK_ZOOM_SPLINE;
      COMPACTION_ENABLED = compiled.COMPACTION_ENABLED;
      GLOBAL_COMPACTION_WAYPOINTS = compiled.GLOBAL_COMPACTION_WAYPOINTS;
      GLOBAL_COMPACTION_LOGICAL_LOOKUP = compiled.GLOBAL_COMPACTION_LOGICAL_LOOKUP;
      GLOBAL_COMPACTION_FIT_SPLINE = compiled.GLOBAL_COMPACTION_FIT_SPLINE;
      MAX_TIME = compiled.MAX_TIME;

      let key = compileRelevantKey(c);
      if (_lastCompileKey !== undefined && key !== _lastCompileKey) {
        _suppressPlaybackRender = true;
        playbackStore.update((p) => ({ ...p, time: 0 }));
        _suppressPlaybackRender = false;
      }
      _lastCompileKey = key;
      updateOutputs();
    } catch (e) {
      let errorMsg = document.getElementById('errorMsg');
      if (errorMsg) { errorMsg.style.display = 'block'; errorMsg.innerText = `Compiler-Absturz: ${e}`; }
      playbackStore.update((p) => ({ ...p, isPlaying: false }));
    }
  }

  function updateDynamicLayout(t_AB) {
    if (t_AB === _lastLayoutT_AB) return;
    _lastLayoutT_AB = t_AB;
    let b_eff = Math.pow(BASE, 1.0 - t_AB);
    if (b_eff < 1.000001) b_eff = 1.000001;
    dyn_prefA = [0]; dyn_axes_w = [1.0];
    let sumA = 1.0;
    for (let i = 1; i < TOTAL_STEPS; i++) {
      let val = Math.pow(b_eff, -axes[i].exp);
      dyn_prefA.push(sumA); dyn_axes_w.push(val);
      sumA += val;
    }
    let nextDigitMargin = Math.pow(b_eff, -(N_MAX + 1));
    DYN_TARGET_W = sumA + nextDigitMargin;
  }

  function getBankTransform(time) {
    if (GLOBAL_BANK_ZOOM.length === 0) return { z: 1, offsetX: 0, offsetY: 0, area: 1 };
    return GLOBAL_BANK_ZOOM_SPLINE.at(time);
  }

  function getSmoothedAutoZoomExp(time) {
    if (GLOBAL_AUTO_ZOOM_CHECKPOINTS.length === 0) return 0;
    return GLOBAL_AUTO_ZOOM_SPLINE(time);
  }

  function computeAutoZoomTAB(thresholdPx, scale, targetExp) {
    if (thresholdPx <= 0 || TOTAL_STEPS <= 1) return 0;
    function widthAt(t_AB) {
      let b_eff = Math.pow(BASE, 1.0 - t_AB);
      if (b_eff < 1.000001) b_eff = 1.000001;
      let sumA = 1.0;
      for (let i = 1; i < TOTAL_STEPS; i++) sumA += Math.pow(b_eff, -axes[i].exp);
      let DYN_W = sumA + Math.pow(b_eff, -(N_MAX + 1));
      let V_SCALE_TARGET = P_FINAL / DYN_W;
      return Math.pow(b_eff, -targetExp) * V_SCALE_TARGET * scale;
    }
    const STEPS = 200;
    let prevT = 0, prevWidth = widthAt(0);
    if (prevWidth >= thresholdPx) return 0;
    let bestT = 0, bestWidth = prevWidth;
    for (let i = 1; i <= STEPS; i++) {
      let t = i / STEPS;
      let w = widthAt(t);
      if (w > bestWidth) { bestWidth = w; bestT = t; }
      if (w >= thresholdPx) {
        let frac = (thresholdPx - prevWidth) / (w - prevWidth);
        return prevT + frac * (t - prevT);
      }
      prevT = t; prevWidth = w;
    }
    return bestT;
  }

  function renderFrame() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if (render_pipeline.length === 0) return;

    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    const W = canvasEl.width / RENDER_SCALE;
    const H = canvasEl.height / RENDER_SCALE;

    const SQRT2 = Math.SQRT2;
    const LOGICAL_MAX_W = SQRT2 + 0.1 + 1.0;
    const LOGICAL_MAX_H = SQRT2;
    const rightEdgeStart = bankPanel.getBoundingClientRect().left;
    const renderAreaWidth = rightEdgeStart - 40;
    const scale = Math.min(renderAreaWidth / LOGICAL_MAX_W, (H - 100) / LOGICAL_MAX_H);

    let autoZoomTargetExp = getSmoothedAutoZoomExp(u_time);
    let autoZoomTAB = computeAutoZoomTAB(AUTO_ZOOM_MIN_PX, scale, autoZoomTargetExp);

    let effective_t_AB = Math.max(u_mode_AB, autoZoomTAB);
    updateAutoZoomIndicator(autoZoomTAB, effective_t_AB > u_mode_AB + 1e-9);

    updateDynamicLayout(effective_t_AB);

    const V_SCALE_TARGET = P_FINAL / DYN_TARGET_W;
    const V_SCALE_BANK = 1.0;

    const BANK_X_OFFSET = SQRT2 + 0.1;
    const bankT = getBankTransform(u_time);
    const compactionFit = (COMPACTION_ENABLED && GLOBAL_COMPACTION_FIT_SPLINE) ? GLOBAL_COMPACTION_FIT_SPLINE.at(u_time) : null;
    let displayBankZoom = compactionFit ? compactionFit.z : bankT.z;
    bankZoomLabel.innerText = formatZoomFactor(displayBankZoom);
    bankAreaLabel.innerText = (bankT.area * 100).toLocaleString('de-DE', { maximumFractionDigits: bankT.area < 0.01 ? 4 : 1 }) + '%';

    ctx.save();
    ctx.translate(50, H - 50);
    ctx.scale(1, -1);

    function project(x, y, w, h, isTarget, piece) {
      if (isTarget) {
        let final_x = x * V_SCALE_TARGET;
        let final_y = y * V_SCALE_TARGET;
        let final_w = w * V_SCALE_TARGET;
        let final_h = h * V_SCALE_TARGET;
        return [final_x * scale, final_y * scale, final_w * scale, final_h * scale];
      }
      if (COMPACTION_ENABLED && piece && GLOBAL_COMPACTION_LOGICAL_LOOKUP && compactionFit) {
        let logical = GLOBAL_COMPACTION_LOGICAL_LOOKUP(piece, u_time);
        let r = applyCompactionFit(logical, compactionFit);
        let final_x = BANK_X_OFFSET + r.x * V_SCALE_BANK;
        let final_y = r.y * V_SCALE_BANK;
        let final_w = r.w * V_SCALE_BANK;
        let final_h = r.h * V_SCALE_BANK;
        return [final_x * scale, final_y * scale, final_w * scale, final_h * scale];
      }
      let zx = x * bankT.z + bankT.offsetX;
      let zy = y * bankT.z + bankT.offsetY;
      let zw = w * bankT.z;
      let zh = h * bankT.z;
      let final_x = BANK_X_OFFSET + zx * V_SCALE_BANK;
      let final_y = zy * V_SCALE_BANK;
      let final_w = zw * V_SCALE_BANK;
      let final_h = zh * V_SCALE_BANK;
      return [final_x * scale, final_y * scale, final_w * scale, final_h * scale];
    }

    let [t_x, t_y, t_w, t_h] = project(0, 0, SQRT2 / V_SCALE_TARGET, SQRT2 / V_SCALE_TARGET, true);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.strokeRect(t_x, t_y, t_w, t_h);

    if (!COMPACTION_ENABLED) {
      let [b_x, b_y, b_w, b_h] = project(0, 0, 1.0, 1.0, false);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.strokeRect(b_x, b_y, b_w, b_h);
    }

    let [base_x, base_y, base_w, base_h] = project(dyn_prefA[0], dyn_prefA[0], dyn_axes_w[0], dyn_axes_w[0], true);
    ctx.fillStyle = COLORS[0];
    ctx.fillRect(base_x, base_y, base_w, base_h);

    const gridPath = new Path2D();
    const edgeFilter = EDGE_BLUR_PX > 0 ? `blur(${EDGE_BLUR_PX}px)` : 'none';
    gridPath.rect(base_x, base_y, base_w, base_h);

    for (let p of bank_pieces) {
      if (u_time >= p.born_time && u_time < p.cut_time && u_time < p.taken_time) {
        let [px, py, pw, ph] = project(p.x, p.y, p.w, p.h, false, p);
        if (pw < 0.2 && ph < 0.2) continue;
        ctx.fillStyle = COLORS[p.k % COLORS.length];
        ctx.fillRect(px, py, pw, ph);
        gridPath.rect(px, py, pw, ph);
      }
    }

    for (let p of render_pipeline) {
      let alpha = 1.0; let is_visible = false;
      if (p.type === 'Z_direct' || p.type === 'S_macro' || p.type === 'R_macro') {
        if (u_time >= p.time_fly) is_visible = true;
      } else if (p.type === 'Z_source') {
        if (u_time >= p.bp.cut_time && u_time < p.time_cut) is_visible = true;
      } else if (p.type === 'Z_ghost') {
        if (u_time >= p.time_fuse) { is_visible = true; alpha = Math.min(1, (u_time - p.time_fuse) / 0.2); }
      } else if (p.type === 'Z_micro') {
        if (u_time >= p.time_cut && u_time < p.time_fuse) {
          is_visible = true; if (u_time > p.time_fuse - 0.2) alpha = Math.max(0, (p.time_fuse - u_time) / 0.2);
        }
      }

      if (!is_visible) continue;

      ctx.fillStyle = COLORS[p.bp.k % COLORS.length];
      ctx.globalAlpha = alpha;

      let fly_t = Math.max(0, Math.min(1, (u_time - p.time_fly) / 0.8));
      if (p.type === 'Z_source' || p.type === 'Z_ghost') fly_t = p.type === 'Z_ghost' ? 1 : 0;
      fly_t = fly_t * fly_t * (3.0 - 2.0 * fly_t);

      let tx = dyn_prefA[p.u]; let ty = dyn_prefA[p.v];
      let tw = dyn_axes_w[p.u]; let th = dyn_axes_w[p.v];
      let target_w = tw; let target_h = th;

      let b_eff = Math.pow(BASE, 1.0 - effective_t_AB);
      if (b_eff < 1.000001) b_eff = 1.000001;

      if (p.type === 'Z_micro') {
        target_w = tw > th ? tw / b_eff : tw; target_h = tw > th ? th : th / b_eff;
        tx = tx + (tw > th ? p.i * target_w : 0);
        ty = ty + (tw > th ? 0 : p.i * target_h);
      }

      let [start_x, start_y, start_w, start_h] = project(p.bp.x, p.bp.y, p.bp.w, p.bp.h, false, p.bp);
      let [end_x, end_y, end_w, end_h] = project(tx, ty, target_w, target_h, true);

      let px = start_x * (1 - fly_t) + end_x * fly_t;
      let py = start_y * (1 - fly_t) + end_y * fly_t;
      let pw = start_w * (1 - fly_t) + end_w * fly_t;
      let ph = start_h * (1 - fly_t) + end_h * fly_t;

      if (p.type === 'R_macro') {
        let center_x = px + pw / 2; let center_y = py + ph / 2;
        ctx.save();
        ctx.translate(center_x, center_y);
        ctx.rotate(p.rot * fly_t);
        ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
        if (LINE_WIDTH_PX > 0) {
          ctx.filter = edgeFilter;
          ctx.strokeStyle = `rgba(0,0,0, ${alpha * 0.9})`; ctx.lineWidth = LINE_WIDTH_PX; ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
          ctx.filter = 'none';
        }
        ctx.restore();
      } else {
        if (pw > 0.2 && ph > 0.2) {
          ctx.fillRect(px, py, pw, ph);
          if (alpha >= 0.999) {
            gridPath.rect(px, py, pw, ph);
          } else if (LINE_WIDTH_PX > 0 && (alpha > 0.8 || p.type === 'Z_ghost')) {
            ctx.filter = edgeFilter;
            ctx.strokeStyle = `rgba(0,0,0, ${alpha * 0.9})`; ctx.lineWidth = LINE_WIDTH_PX; ctx.strokeRect(px, py, pw, ph);
            ctx.filter = 'none';
          }
        }
      }
      ctx.globalAlpha = 1.0;
    }

    if (LINE_WIDTH_PX > 0) {
      ctx.save();
      ctx.filter = edgeFilter;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = LINE_WIDTH_PX;
      ctx.stroke(gridPath);
      ctx.restore();
    }

    ctx.restore();
  }

  function updateAutoZoomIndicator(autoZoomTAB, isActive) {
    if (AUTO_ZOOM_MIN_PX <= 0) {
      autoZoomMarker.style.display = 'none';
      autoZoomNote.style.display = 'none';
      return;
    }
    autoZoomMarker.style.display = 'block';
    autoZoomMarker.style.left = (autoZoomTAB * 100) + '%';
    autoZoomNote.style.display = isActive ? 'block' : 'none';
  }

  function formatZoomFactor(f) {
    if (f < 10) return f.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '×';
    if (f < 1000) return Math.round(f).toLocaleString('de-DE') + '×';
    return f.toExponential(1).replace('.', ',').replace('e+', ' × 10^') + '×';
  }

  function resizeCanvas() {
    canvasEl.width = window.innerWidth * RENDER_SCALE;
    canvasEl.height = window.innerHeight * RENDER_SCALE;
    canvasEl.style.width = window.innerWidth + 'px';
    canvasEl.style.height = window.innerHeight + 'px';
    renderFrame();
  }

  function updateOutputs() {
    renderFrame();
  }

  function applyPlayback(p) {
    u_time = p.time;
    animDirection = p.direction;
    let wasPlaying = isPlaying;
    isPlaying = p.isPlaying;
    if (isPlaying && !wasPlaying) {
      lastTime = performance.now();
      requestAnimationFrame(loop);
    }
    if (_suppressPlaybackRender) return;
    updateOutputs();
  }

  function loop(now) {
    if (!isPlaying) return;
    let dt = (now - lastTime) / 1000.0; lastTime = now;

    if (animPause > 0) {
      animPause -= dt;
    } else {
      u_time += dt * ANIM_SPEED * animDirection;
      if (u_time >= MAX_TIME) {
        u_time = MAX_TIME; animDirection = -1; animPause = ANIM_PAUSE_DURATION;
      } else if (u_time <= 0) {
        u_time = 0; animDirection = 1; animPause = ANIM_PAUSE_DURATION;
      }
      _suppressPlaybackRender = true;
      playbackStore.set({ time: u_time, isPlaying, direction: animDirection });
      _suppressPlaybackRender = false;
      updateOutputs();
    }
    requestAnimationFrame(loop);
  }

  onMount(() => {
    ctx = canvasEl.getContext('2d');
    bankZoomLabel = document.getElementById('bankZoomLabel');
    bankAreaLabel = document.getElementById('bankAreaLabel');
    autoZoomMarker = document.getElementById('autoZoomMarker');
    autoZoomNote = document.getElementById('autoZoomNote');
    bankPanel = document.getElementById('bankPanel');
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    const unsubC = configStore.subscribe(applyConfig);
    const unsubP = playbackStore.subscribe(applyPlayback);
    return () => {
      unsubC(); unsubP();
      window.removeEventListener('resize', resizeCanvas);
    };
  });
</script>

<canvas bind:this={canvasEl}></canvas>
