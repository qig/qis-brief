// ── Multi-layer ocean with lighthouse on island ──────
// FFT ocean (Tessendorf) rendered as layered terminal particles.
// Each layer samples from a shifted phase of the heightfield for
// distinct wave shapes. Periodic swell modulates all layers together.
// Lighthouse sits on a rocky island; front layers occlude its base.
//
// Triadic palette:
//   Terracotta #C45D35 (lighthouse, warm accent)
//   Teal       #2D7A8A (near ocean)
//   Indigo     #3D4B7A (far ocean, sky)

(function () {
  const canvas = document.getElementById("wave-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // ── FFT ──
  function fft(data, inverse) {
    const n = data.length >> 1;
    if (n <= 1) return;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) {
        let t;
        t = data[2*i]; data[2*i] = data[2*j]; data[2*j] = t;
        t = data[2*i+1]; data[2*i+1] = data[2*j+1]; data[2*j+1] = t;
      }
    }
    const dir = inverse ? -1 : 1;
    for (let len = 2; len <= n; len <<= 1) {
      const ang = dir * 2 * Math.PI / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cRe = 1, cIm = 0;
        for (let j = 0; j < (len >> 1); j++) {
          const a = 2*(i+j), b = 2*(i+j+(len>>1));
          const tRe = cRe*data[b] - cIm*data[b+1];
          const tIm = cRe*data[b+1] + cIm*data[b];
          data[b] = data[a]-tRe; data[b+1] = data[a+1]-tIm;
          data[a] += tRe; data[a+1] += tIm;
          const tmp = cRe*wRe - cIm*wIm;
          cIm = cRe*wIm + cIm*wRe; cRe = tmp;
        }
      }
    }
    if (inverse) for (let i = 0; i < data.length; i++) data[i] /= n;
  }

  // ── Ocean spectrum ──
  const FFT_SIZE = 512;
  const G = 9.81;
  const WIND = 8.0;
  const Lp = WIND*WIND/G;
  const AMP = 0.005;
  const WORLD_LEN = 60;
  const TIME_SCALE = 0.7;
  const H_SCALE = 80;

  function gaussPair() {
    let u,v,s;
    do { u=Math.random()*2-1; v=Math.random()*2-1; s=u*u+v*v; } while(s>=1||s===0);
    const f=Math.sqrt(-2*Math.log(s)/s); return [u*f,v*f];
  }

  const h0Re=new Float64Array(FFT_SIZE), h0Im=new Float64Array(FFT_SIZE), omg=new Float64Array(FFT_SIZE);
  (function(){
    const dk=2*Math.PI/WORLD_LEN;
    for(let n=0;n<FFT_SIZE;n++){
      const kn=(n<FFT_SIZE/2?n:n-FFT_SIZE)*dk, kA=Math.abs(kn);
      const k2=kA*kA; const P = k2<1e-8?0:AMP*Math.exp(-1/(kA*Lp)**2)/(k2*k2);
      const sp=Math.sqrt(P); const [gr,gi]=gaussPair();
      h0Re[n]=gr*sp/Math.SQRT2; h0Im[n]=gi*sp/Math.SQRT2;
      omg[n]=Math.sqrt(G*kA);
    }
  })();

  function computeH(t) {
    const d=new Float64Array(FFT_SIZE*2);
    for(let n=0;n<FFT_SIZE;n++){
      const wt=omg[n]*t, c=Math.cos(wt), s=Math.sin(wt);
      const mn=(FFT_SIZE-n)%FFT_SIZE;
      d[2*n]  =(h0Re[n]*c-h0Im[n]*s)+(h0Re[mn]*c+h0Im[mn]*s);
      d[2*n+1]=(h0Re[n]*s+h0Im[n]*c)+(-h0Re[mn]*s+h0Im[mn]*c);
    }
    fft(d,true);
    const h=new Float32Array(FFT_SIZE);
    for(let i=0;i<FFT_SIZE;i++) h[i]=d[2*i]*H_SCALE;
    return h;
  }

  // ── Perturbation ──
  let pert=new Float32Array(FFT_SIZE), pertPrev=new Float32Array(FFT_SIZE);
  function stepPert(){
    const c2=0.35*0.35, next=new Float32Array(FFT_SIZE);
    for(let i=1;i<FFT_SIZE-1;i++)
      next[i]=(2*pert[i]-pertPrev[i]+c2*(pert[i-1]+pert[i+1]-2*pert[i]))*0.993;
    next[0]=pert[1]*0.5; next[FFT_SIZE-1]=pert[FFT_SIZE-2]*0.5;
    pertPrev=pert; pert=next;
  }

  // ── Layer config ──
  // xShift: each layer samples from a different phase of the heightfield
  const CHARS = ["0", "1"];

  const LAYERS = [
    { yOff: 0.42, ampScale: 0.40, speed: 0.6,  xShift: 0.15, color: [45,122,138], alpha: 0.20, fontSize: 13, count: 75 },
    { yOff: 0.54, ampScale: 0.55, speed: 0.8,  xShift: 0.78, color: [35,110,130], alpha: 0.26, fontSize: 15, count: 85 },
    { yOff: 0.66, ampScale: 0.70, speed: 1.0,  xShift: 0.0,  color: [30,95,115],  alpha: 0.32, fontSize: 17, count: 95 },
  ];

  let W, H, time = 0;
  let heightCache = new Float32Array(FFT_SIZE);
  let layerParticles = [];

  // ── Day/night cycle ──
  // Full cycle ~120s. Phases: dawn(0-0.15) day(0.15-0.45) dusk(0.45-0.6) night(0.6-1.0)
  const CYCLE_DURATION = 120;

  // Pre-generate stars
  const STARS = [];
  for (let i = 0; i < 80; i++) {
    STARS.push({
      x: Math.random(),
      y: Math.random() * 0.7,
      size: 0.5 + Math.random() * 1.5,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.5 + Math.random() * 1.5,
    });
  }

  // Pre-generate clouds
  const CLOUDS = [];
  for (let i = 0; i < 5; i++) {
    CLOUDS.push({
      x: Math.random(),
      y: 0.05 + Math.random() * 0.25,
      w: 60 + Math.random() * 80,
      h: 15 + Math.random() * 15,
      speed: 0.002 + Math.random() * 0.003,
      puffs: Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => ({
        dx: (Math.random() - 0.5) * 0.8,
        dy: (Math.random() - 0.5) * 0.5,
        r: 0.5 + Math.random() * 0.5,
      })),
    });
  }

  function getCyclePhase() {
    const t = ((time / CYCLE_DURATION) % 1 + 1) % 1;
    return t;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpColor(c1, c2, t) {
    return [lerp(c1[0],c2[0],t), lerp(c1[1],c2[1],t), lerp(c1[2],c2[2],t)];
  }

  // Returns { skyTop, skyBot, waterTint, bgColor, beamMult, nightAmount, dawnGlow }
  function getAtmosphere() {
    const phase = getCyclePhase();

    // Color palettes for each phase
    const dawn =  { skyTop: [250,200,160], skyBot: [250,170,120], waterTint: [0.15,0.08,0.0], bg: [250,240,235], beam: 0.7, night: 0, dawnGlow: 1 };
    const day =   { skyTop: [250,247,242], skyBot: [220,235,240], waterTint: [0,0,0],         bg: [250,247,242], beam: 0.4, night: 0, dawnGlow: 0 };
    const dusk =  { skyTop: [200,140,120], skyBot: [230,150,100], waterTint: [0.12,0.04,0.0], bg: [240,230,225], beam: 0.8, night: 0, dawnGlow: 0.6 };
    const night = { skyTop: [25,30,55],    skyBot: [35,45,75],    waterTint: [-0.3,-0.2,-0.1], bg: [30,35,60],   beam: 1.0, night: 1, dawnGlow: 0 };

    let a, b, t;
    if (phase < 0.12) {
      // night → dawn
      t = phase / 0.12;
      a = night; b = dawn;
    } else if (phase < 0.22) {
      // dawn → day
      t = (phase - 0.12) / 0.10;
      a = dawn; b = day;
    } else if (phase < 0.48) {
      // day
      t = 0; a = day; b = day;
    } else if (phase < 0.58) {
      // day → dusk
      t = (phase - 0.48) / 0.10;
      a = day; b = dusk;
    } else if (phase < 0.68) {
      // dusk → night
      t = (phase - 0.58) / 0.10;
      a = dusk; b = night;
    } else {
      // night
      t = 0; a = night; b = night;
    }

    const smooth = t * t * (3 - 2 * t); // smoothstep
    return {
      skyTop: lerpColor(a.skyTop, b.skyTop, smooth),
      skyBot: lerpColor(a.skyBot, b.skyBot, smooth),
      waterTint: [lerp(a.waterTint[0],b.waterTint[0],smooth), lerp(a.waterTint[1],b.waterTint[1],smooth), lerp(a.waterTint[2],b.waterTint[2],smooth)],
      bgColor: lerpColor(a.bg, b.bg, smooth),
      beamMult: lerp(a.beam, b.beam, smooth),
      nightAmount: lerp(a.night, b.night, smooth),
      dawnGlow: lerp(a.dawnGlow, b.dawnGlow, smooth),
    };
  }

  // ── Swell — periodic big waves across all layers ──
  function getSwellMult() {
    const phase = time * 0.08;
    return 1 + 0.35 * Math.pow(Math.max(0, Math.sin(phase)), 3);
  }

  function getSurfaceY(layer, xNorm) {
    // Shift sampling + slow drift per layer for distinct wave shapes
    const shifted = ((xNorm + layer.xShift + time * layer.speed * 0.008) % 1 + 1) % 1;
    const fi = shifted * (FFT_SIZE - 1);
    const i = Math.floor(fi), frac = fi - i;
    const i2 = Math.min(i + 1, FFT_SIZE - 1);
    const h = heightCache[i]*(1-frac) + heightCache[i2]*frac;
    const p = (layer.speed >= 0.9) ? (pert[i]*(1-frac) + pert[i2]*frac) : 0;
    const swell = getSwellMult();
    return H * layer.yOff + H * 0.12 - (h * layer.ampScale * swell + p) * H * 0.06;
  }

  function createParticle(layer) {
    const xNorm = Math.random();
    const surfY = getSurfaceY(layer, xNorm);
    const above = Math.random() < 0.5;
    return {
      xNorm,
      x: xNorm * W,
      y: above ? surfY - Math.random() * 40 - 5 : surfY,
      vy: above ? 0.2 + Math.random() * 0.5 : 0,
      settled: !above,
      char: CHARS[Math.floor(Math.random() * CHARS.length)],
      alphaBase: 0.6 + Math.random() * 0.4,
      life: 150 + Math.floor(Math.random() * 350),
      age: 0,
    };
  }

  // ── Lighthouse + Shore ──
  // Fixed position on an asymmetric rocky shore
  const LH_X_NORM = 0.75;
  let beamGlowIntensity = 0; // exported for button glow

  function drawShoreAndLighthouse(atm) {
    const lhX = W * LH_X_NORM;
    const baseY = H * 0.50;
    const lhHeight = H * 0.30;
    const lhWidthBot = 20;
    const lhWidthTop = 11;

    // ── Asymmetric rocky shore / headland ──
    // Single shape — no overlapping semi-transparent pieces
    // Blend colors with background (#FAF7F2) for solid look
    ctx.save();

    // Main shore mass — all curves, no straight edges
    ctx.beginPath();
    // Start below water on the far left so left edge is submerged
    ctx.moveTo(lhX - 160, baseY + 120);
    // Rise gently from underwater into the shore
    ctx.bezierCurveTo(lhX - 155, baseY + 60, lhX - 140, baseY + 30, lhX - 115, baseY + 12);
    ctx.bezierCurveTo(lhX - 90, baseY - 2, lhX - 60, baseY - 14, lhX - 30, baseY - 18);
    ctx.bezierCurveTo(lhX - 18, baseY - 21, lhX - 5, baseY - 22, lhX + 18, baseY - 19);
    ctx.bezierCurveTo(lhX + 35, baseY - 15, lhX + 55, baseY - 10, lhX + 80, baseY - 5);
    ctx.bezierCurveTo(lhX + 110, baseY + 1, lhX + 140, baseY + 5, lhX + 170, baseY + 7);
    ctx.bezierCurveTo(lhX + 200, baseY + 9, W - 20, baseY + 10, W + 10, baseY + 11);
    ctx.lineTo(W + 10, baseY + 120);
    ctx.lineTo(lhX - 160, baseY + 120);
    ctx.closePath();
    // Warm stone — distinct from cool ocean blues
    ctx.fillStyle = "rgb(165, 150, 140)";
    ctx.fill();

    // Clip to shore shape for rock details (no overflow)
    ctx.clip();

    // Top ridge — darker, only shows within shore
    ctx.beginPath();
    ctx.moveTo(lhX - 40, baseY - 8);
    ctx.bezierCurveTo(lhX - 15, baseY - 20, lhX + 10, baseY - 22, lhX + 40, baseY - 12);
    ctx.quadraticCurveTo(lhX + 70, baseY - 4, lhX + 100, baseY);
    ctx.lineTo(lhX + 100, baseY - 2);
    ctx.bezierCurveTo(lhX + 60, baseY - 10, lhX + 10, baseY - 18, lhX - 15, baseY - 16);
    ctx.quadraticCurveTo(lhX - 30, baseY - 12, lhX - 40, baseY - 4);
    ctx.closePath();
    ctx.fillStyle = "rgb(145, 130, 122)";
    ctx.fill();

    // Right outcrop accent
    ctx.beginPath();
    ctx.moveTo(lhX + 55, baseY - 6);
    ctx.quadraticCurveTo(lhX + 72, baseY - 12, lhX + 95, baseY - 4);
    ctx.lineTo(lhX + 90, baseY + 2);
    ctx.quadraticCurveTo(lhX + 68, baseY - 4, lhX + 55, baseY);
    ctx.closePath();
    ctx.fillStyle = "rgb(155, 140, 132)";
    ctx.fill();

    ctx.restore();

    // ── Palm trees on the right side of the shore ──
    const rockTop = baseY - 20;
    if (!drawShoreAndLighthouse._palms) {
      // Pre-compute random properties once
      const defs = [
        { xOff: 40, gOff: -14, h: 52, lean: -0.12, fronds: 7, phase: 0 },
        { xOff: 72, gOff: -7,  h: 46, lean: 0.22,  fronds: 7, phase: 2.1 },
      ];
      drawShoreAndLighthouse._palms = defs.map(d => {
        const frondData = [];
        for (let fi = 0; fi < d.fronds; fi++) {
          frondData.push({
            lenMult: 0.4 + Math.random() * 0.15,
            droop: 0.5 + Math.random() * 0.3,
            phaseOff: Math.random() * Math.PI * 2,
          });
        }
        return { ...d, frondData };
      });
    }
    const palmDefs = drawShoreAndLighthouse._palms;

    for (const p of palmDefs) {
      const px = lhX + p.xOff;
      const ground = baseY + p.gOff;

      // Gentle breeze sway on trunk top
      const sway = Math.sin(time * 0.3 + p.phase) * 3;

      const topX = px + p.h * p.lean + sway;
      const topYp = ground - p.h;
      const midX = px + p.h * p.lean * 0.6 + sway * 0.4;
      const midY = ground - p.h * 0.5;

      // Curved trunk
      ctx.strokeStyle = "rgb(125, 105, 80)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, ground);
      ctx.quadraticCurveTo(midX, midY, topX, topYp);
      ctx.stroke();

      // Trunk highlight
      ctx.strokeStyle = "rgb(145, 125, 100)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 1, ground);
      ctx.quadraticCurveTo(midX + 1, midY, topX + 1, topYp);
      ctx.stroke();

      // Coconuts
      ctx.fillStyle = "rgb(110, 90, 65)";
      for (let ci = 0; ci < 3; ci++) {
        const ca = (ci / 3) * Math.PI * 2 + 0.5;
        ctx.beginPath();
        ctx.arc(topX + Math.cos(ca) * 3, topYp + 2 + Math.sin(ca) * 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fronds with gentle breeze
      for (let fi = 0; fi < p.fronds; fi++) {
        const fd = p.frondData[fi];
        const baseAngle = (fi / p.fronds) * Math.PI * 1.6 - Math.PI * 0.8 + p.lean;
        // Slow sway per frond
        const frondSway = Math.sin(time * 0.25 + fd.phaseOff + p.phase) * 0.06;
        const angle = baseAngle + frondSway;
        const frondLen = p.h * fd.lenMult;
        const endX = topX + Math.cos(angle) * frondLen;
        const endY = topYp + Math.sin(angle) * frondLen * 0.3 + frondLen * fd.droop * 0.4;
        const cpX = topX + Math.cos(angle) * frondLen * 0.5;
        const cpY = topYp + Math.sin(angle) * frondLen * 0.15 - frondLen * 0.1;

        // Frond spine
        ctx.strokeStyle = "rgb(75, 110, 65)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(topX, topYp);
        ctx.quadraticCurveTo(cpX, cpY, endX, endY);
        ctx.stroke();

        // Leaflets
        const steps = 6;
        for (let si = 1; si <= steps; si++) {
          const t = si / steps;
          const qx = (1-t)*(1-t)*topX + 2*(1-t)*t*cpX + t*t*endX;
          const qy = (1-t)*(1-t)*topYp + 2*(1-t)*t*cpY + t*t*endY;
          const tx2 = 2*(1-t)*(cpX-topX) + 2*t*(endX-cpX);
          const ty2 = 2*(1-t)*(cpY-topYp) + 2*t*(endY-cpY);
          const tLen = Math.sqrt(tx2*tx2 + ty2*ty2) || 1;
          const nx = -ty2/tLen, ny = tx2/tLen;
          const leafLen = (5 + (1-t) * 8) * (p.h / 50);

          ctx.strokeStyle = si % 2 === 0 ? "rgb(85, 125, 70)" : "rgb(70, 108, 60)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(qx, qy);
          ctx.lineTo(qx + nx * leafLen, qy + ny * leafLen + leafLen * 0.3);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(qx, qy);
          ctx.lineTo(qx - nx * leafLen, qy - ny * leafLen + leafLen * 0.3);
          ctx.stroke();
        }
      }
    }

    // ── Tower body — warm terracotta ──
    const topY = rockTop - lhHeight + 20;

    ctx.beginPath();
    ctx.moveTo(lhX - lhWidthBot/2, rockTop);
    ctx.lineTo(lhX - lhWidthTop/2, topY + 14);
    ctx.lineTo(lhX + lhWidthTop/2, topY + 14);
    ctx.lineTo(lhX + lhWidthBot/2, rockTop);
    ctx.closePath();
    ctx.fillStyle = "rgb(210, 150, 120)";
    ctx.fill();

    // Stripe bands
    const towerH = rockTop - topY;
    for (let si = 0; si < 2; si++) {
      const sy = topY + towerH * (0.4 + si * 0.25);
      const frac = (sy - topY) / towerH;
      const sw = lhWidthTop + (lhWidthBot - lhWidthTop) * frac;
      ctx.fillStyle = "rgb(235, 228, 218)";
      ctx.fillRect(lhX - sw * 0.36, sy, sw * 0.72, towerH * 0.06);
    }

    // Gallery/balcony
    ctx.fillStyle = "rgb(195, 135, 105)";
    ctx.fillRect(lhX - lhWidthTop/2 - 3, topY + 10, lhWidthTop + 6, 4);

    // Lantern room
    ctx.fillStyle = "rgb(200, 140, 110)";
    ctx.fillRect(lhX - lhWidthTop/2, topY + 2, lhWidthTop, 10);

    // Glass panes in lantern
    ctx.fillStyle = "rgb(245, 230, 200)";
    ctx.fillRect(lhX - lhWidthTop/2 + 2, topY + 4, lhWidthTop - 4, 6);

    // Dome — indigo
    ctx.beginPath();
    ctx.arc(lhX, topY + 2, lhWidthTop/2 + 1, Math.PI, 0);
    ctx.fillStyle = "rgb(130, 140, 170)";
    ctx.fill();

    // Dome tip
    ctx.beginPath();
    ctx.moveTo(lhX - 2, topY - 1);
    ctx.lineTo(lhX, topY - 6);
    ctx.lineTo(lhX + 2, topY - 1);
    ctx.closePath();
    ctx.fillStyle = "rgb(130, 140, 170)";
    ctx.fill();

    // ── Sweeping light beam ──
    const lanternY = topY + 6;
    const sweep = Math.sin(time * 0.4) * 1.1;
    const beamAngle = -Math.PI / 2 + sweep;
    const beamLen = Math.max(W, H) * 0.6;
    const beamHalf = 0.10;

    ctx.save();
    ctx.translate(lhX, lanternY);

    // Beam intensity scales with time of day
    const bm = atm ? atm.beamMult : 0.5;

    // Large ambient glow around lantern
    const glowGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, 100);
    glowGrad.addColorStop(0, `rgba(255, 220, 120, ${(0.55 * bm).toFixed(3)})`);
    glowGrad.addColorStop(0.3, `rgba(255, 200, 100, ${(0.18 * bm).toFixed(3)})`);
    glowGrad.addColorStop(0.7, `rgba(255, 190, 80, ${(0.05 * bm).toFixed(3)})`);
    glowGrad.addColorStop(1, "rgba(255, 190, 80, 0)");
    ctx.beginPath();
    ctx.arc(0, 0, 100, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();

    // Main beam cone
    const a1 = beamAngle - beamHalf;
    const a2 = beamAngle + beamHalf;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a1) * beamLen, Math.sin(a1) * beamLen);
    ctx.arc(0, 0, beamLen, a1, a2);
    ctx.closePath();

    const beamGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, beamLen);
    beamGrad.addColorStop(0, `rgba(255, 225, 120, ${(0.50 * bm).toFixed(3)})`);
    beamGrad.addColorStop(0.08, `rgba(255, 215, 110, ${(0.30 * bm).toFixed(3)})`);
    beamGrad.addColorStop(0.25, `rgba(255, 205, 100, ${(0.12 * bm).toFixed(3)})`);
    beamGrad.addColorStop(0.6, `rgba(255, 195, 90, ${(0.03 * bm).toFixed(3)})`);
    beamGrad.addColorStop(1, "rgba(255, 190, 80, 0)");
    ctx.fillStyle = beamGrad;
    ctx.fill();

    // Bright core beam
    const coreHalf = beamHalf * 0.35;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(beamAngle - coreHalf) * beamLen * 0.8, Math.sin(beamAngle - coreHalf) * beamLen * 0.8);
    ctx.arc(0, 0, beamLen * 0.8, beamAngle - coreHalf, beamAngle + coreHalf);
    ctx.closePath();
    const coreGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, beamLen * 0.8);
    coreGrad.addColorStop(0, `rgba(255, 240, 180, ${(0.40 * bm).toFixed(3)})`);
    coreGrad.addColorStop(0.15, `rgba(255, 230, 150, ${(0.15 * bm).toFixed(3)})`);
    coreGrad.addColorStop(0.5, `rgba(255, 220, 130, ${(0.04 * bm).toFixed(3)})`);
    coreGrad.addColorStop(1, "rgba(255, 210, 120, 0)");
    ctx.fillStyle = coreGrad;
    ctx.fill();

    ctx.restore();

    // Lantern bright point
    ctx.beginPath();
    ctx.arc(lhX, lanternY, 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 225, 130, ${(0.6 * bm).toFixed(3)})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lhX, lanternY, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 245, 200, ${(0.85 * bm).toFixed(3)})`;
    ctx.fill();

    // ── Beam glow on subscribe button ──
    const btn = document.querySelector(".subscribe-form button");
    if (btn) {
      const btnRect = btn.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      // Button position in canvas-relative coords
      const btnCx = btnRect.left + btnRect.width / 2 - canvasRect.left;
      const btnCy = btnRect.top + btnRect.height / 2 - canvasRect.top;
      const dx = btnCx - lhX, dy = btnCy - lanternY;
      const angleToBtn = Math.atan2(dy, dx);
      // Normalize angle difference to [-PI, PI]
      let diff = beamAngle - angleToBtn;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      diff = Math.abs(diff);
      // Wider detection zone for a softer glow ramp
      const glowZone = beamHalf * 3.5;
      beamGlowIntensity = Math.max(0, 1 - diff / glowZone);
      beamGlowIntensity = Math.pow(beamGlowIntensity, 1.5);
      const glow = beamGlowIntensity;
      if (glow > 0.01) {
        const spread = 4 + glow * 12;
        const blur = 10 + glow * 30;
        btn.style.boxShadow = `0 0 ${blur}px ${spread}px rgba(255, 210, 140, ${(glow * 0.5).toFixed(3)}), inset 0 0 ${glow * 15}px rgba(255, 225, 180, ${(glow * 0.25).toFixed(3)})`;
      } else {
        btn.style.boxShadow = "";
      }
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    pert = new Float32Array(FFT_SIZE);
    pertPrev = new Float32Array(FFT_SIZE);

    layerParticles = LAYERS.map(layer => {
      const particles = [];
      for (let i = 0; i < layer.count; i++) particles.push(createParticle(layer));
      return particles;
    });
  }

  function render() {
    const atm = getAtmosphere();
    const [bgR, bgG, bgB] = atm.bgColor;

    // Dynamic background
    ctx.fillStyle = `rgb(${bgR|0},${bgG|0},${bgB|0})`;
    ctx.fillRect(0, 0, W, H);

    // Sky gradient — extends down to meet the water
    const [stR, stG, stB] = atm.skyTop;
    const [sbR, sbG, sbB] = atm.skyBot;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.7);
    skyGrad.addColorStop(0, `rgba(${stR|0},${stG|0},${stB|0},0.9)`);
    skyGrad.addColorStop(0.4, `rgba(${sbR|0},${sbG|0},${sbB|0},0.5)`);
    skyGrad.addColorStop(0.7, `rgba(${sbR|0},${sbG|0},${sbB|0},0.2)`);
    skyGrad.addColorStop(1, `rgba(${sbR|0},${sbG|0},${sbB|0},0)`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H * 0.7);

    // Dawn/dusk horizon glow
    if (atm.dawnGlow > 0.01) {
      const glowGrad = ctx.createRadialGradient(W * 0.3, H * 0.25, 0, W * 0.3, H * 0.25, W * 0.7);
      glowGrad.addColorStop(0, `rgba(255, 180, 100, ${(atm.dawnGlow * 0.3).toFixed(3)})`);
      glowGrad.addColorStop(0.4, `rgba(255, 150, 80, ${(atm.dawnGlow * 0.12).toFixed(3)})`);
      glowGrad.addColorStop(1, "rgba(255, 150, 80, 0)");
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, W, H * 0.7);
    }

    // Stars (visible at night) — occluded by water surface and shore/lighthouse
    if (atm.nightAmount > 0.05) {
      // Compute the highest wave surface at sampled x positions for occlusion
      const shoreBaseY = H * 0.50;
      const shoreLhX = W * LH_X_NORM;
      const lhTopY = shoreBaseY - 20 - H * 0.30 + 20 - 6; // dome tip

      for (const star of STARS) {
        const sx = star.x * W;
        const sy = star.y * H;

        // Check if star is below the topmost wave surface at this x
        let occluded = false;
        for (let fli = 0; fli < LAYERS.length; fli++) {
          if (sy > getSurfaceY(LAYERS[fli], star.x) - 5) {
            occluded = true;
            break;
          }
        }
        if (occluded) continue;

        // Check if star is behind the shore/lighthouse silhouette
        const dxShore = sx - shoreLhX;
        if (dxShore > -90 && dxShore < 180 && sy > shoreBaseY - 25) { occluded = true; }
        if (dxShore > -12 && dxShore < 12 && sy > lhTopY) { occluded = true; }
        if (occluded) continue;

        const twinkle = 0.5 + 0.5 * Math.sin(time * star.twinkleSpeed + star.twinklePhase);
        const alpha = atm.nightAmount * twinkle * 0.8;
        if (alpha > 0.02) {
          ctx.beginPath();
          ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(240, 240, 255, ${alpha.toFixed(3)})`;
          ctx.fill();
        }
      }
    }

    // Clouds
    for (const cloud of CLOUDS) {
      const cx = ((cloud.x + time * cloud.speed) % 1.3 - 0.15) * W;
      const cy = cloud.y * H;
      // Clouds are bright during day, dim at night
      const cloudBright = lerp(240, 80, atm.nightAmount);
      const cloudAlpha = lerp(0.25, 0.12, atm.nightAmount);
      for (const puff of cloud.puffs) {
        ctx.beginPath();
        ctx.ellipse(cx + puff.dx * cloud.w, cy + puff.dy * cloud.h, cloud.w * puff.r * 0.5, cloud.h * puff.r * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cloudBright|0},${cloudBright|0},${(cloudBright+10)|0},${cloudAlpha.toFixed(3)})`;
        ctx.fill();
      }
    }

    // Draw shore/lighthouse BEFORE all water, clipped by ALL wave surfaces
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    // Walk right-to-left along the composite wave ceiling of ALL layers
    for (let cx = W; cx >= 0; cx -= 3) {
      let minY = H;
      for (let fli = 0; fli < LAYERS.length; fli++) {
        const sy = getSurfaceY(LAYERS[fli], cx / W);
        if (sy < minY) minY = sy;
      }
      ctx.lineTo(cx, minY);
    }
    ctx.closePath();
    ctx.clip();
    drawShoreAndLighthouse(atm);
    ctx.restore();

    // Draw water layers back to front
    const [wtR, wtG, wtB] = atm.waterTint;
    for (let li = 0; li < LAYERS.length; li++) {
      const layer = LAYERS[li];
      const particles = layerParticles[li];
      // Tint water color by atmosphere
      const cr = Math.max(0, Math.min(255, layer.color[0] + wtR * 255));
      const cg = Math.max(0, Math.min(255, layer.color[1] + wtG * 255));
      const cb = Math.max(0, Math.min(255, layer.color[2] + wtB * 255));

      // Water fill — vertical gradient: transparent at surface, opaque deeper
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 3) {
        ctx.lineTo(x, getSurfaceY(layer, x / W));
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      const surfMin = getSurfaceY(layer, 0.5);
      const waterGrad = ctx.createLinearGradient(0, surfMin, 0, surfMin + H * 0.25);
      const surfAlpha = layer.alpha * 0.3;
      const deepAlpha = Math.min(0.95, layer.alpha * 3.2);
      waterGrad.addColorStop(0, `rgba(${cr|0},${cg|0},${cb|0},${surfAlpha.toFixed(3)})`);
      waterGrad.addColorStop(0.4, `rgba(${cr|0},${cg|0},${cb|0},${(deepAlpha * 0.6).toFixed(3)})`);
      waterGrad.addColorStop(1, `rgba(${cr|0},${cg|0},${cb|0},${deepAlpha.toFixed(3)})`);
      ctx.fillStyle = waterGrad;
      ctx.fill();

      // Particles
      ctx.font = `${layer.fontSize}px 'Courier New', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let pi = 0; pi < particles.length; pi++) {
        const p = particles[pi];
        const surfY = getSurfaceY(layer, p.xNorm);

        if (!p.settled) {
          p.y += p.vy;
          if (p.y >= surfY) { p.y = surfY; p.settled = true; }
        } else {
          p.y = surfY;
        }

        p.age++;
        let alpha = layer.alpha * p.alphaBase;
        if (p.age < 15) alpha *= p.age / 15;
        if (p.age > p.life - 30) alpha *= (p.life - p.age) / 30;

        const vFade = Math.max(0, Math.min(1, (p.y) / (H * 0.15)));
        alpha *= vFade;

        if (alpha > 0.01) {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
          ctx.fillText(p.char, p.x, p.y);
        }

        if (p.age >= p.life) {
          particles[pi] = createParticle(layer);
        }
      }
    }

    // Top fade — dissolves into dynamic background
    const fadeH = H * 0.38;
    const fadeMask = ctx.createLinearGradient(0, 0, 0, fadeH);
    fadeMask.addColorStop(0, `rgba(${bgR|0},${bgG|0},${bgB|0},1)`);
    fadeMask.addColorStop(0.3, `rgba(${bgR|0},${bgG|0},${bgB|0},0.7)`);
    fadeMask.addColorStop(0.6, `rgba(${bgR|0},${bgG|0},${bgB|0},0.25)`);
    fadeMask.addColorStop(1, `rgba(${bgR|0},${bgG|0},${bgB|0},0)`);
    ctx.fillStyle = fadeMask;
    ctx.fillRect(0, 0, W, fadeH);

    // Sync page background with cycle
    document.body.style.background = `rgb(${bgR|0},${bgG|0},${bgB|0})`;

    // Smoothly adjust text color for day/night readability
    const title = document.querySelector(".title");
    const tagline = document.querySelector(".tagline");
    const n = atm.nightAmount;
    if (title) {
      const r = lerp(44, 230, n) | 0;   // day #2C2825 → night light
      const g = lerp(40, 225, n) | 0;
      const b = lerp(37, 220, n) | 0;
      title.style.color = `rgb(${r},${g},${b})`;
    }
    if (tagline) {
      const r = lerp(138, 180, n) | 0;  // day #8A8480 → night lighter
      const g = lerp(132, 175, n) | 0;
      const b = lerp(128, 170, n) | 0;
      tagline.style.color = `rgb(${r},${g},${b})`;
    }
  }

  // ── Mouse ──
  function disturb(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    const rx = (cx - rect.left) / W;
    const gi = Math.floor(rx * FFT_SIZE);
    const ry = (cy - rect.top) / H;
    const str = (0.5 - ry) * 0.6;
    for (let d = -20; d <= 20; d++) {
      const i = gi + d;
      if (i >= 0 && i < FFT_SIZE) pert[i] += str * Math.cos((d/20)*Math.PI*0.5) * 0.08;
    }
  }

  let isDown = false;
  canvas.addEventListener("mousedown", e => { isDown=true; disturb(e.clientX,e.clientY); });
  canvas.addEventListener("mousemove", e => { if(isDown) disturb(e.clientX,e.clientY); });
  window.addEventListener("mouseup", () => { isDown=false; });
  canvas.addEventListener("touchstart", e => {
    e.preventDefault(); for(const t of e.touches) disturb(t.clientX,t.clientY);
  }, {passive:false});
  canvas.addEventListener("touchmove", e => {
    e.preventDefault(); for(const t of e.touches) disturb(t.clientX,t.clientY);
  }, {passive:false});

  // ── Loop ──
  let raf;
  function loop() {
    time += 0.016 * TIME_SCALE;
    stepPert();
    heightCache = computeH(time);
    render();
    raf = requestAnimationFrame(loop);
  }

  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt=setTimeout(resize,200); });

  resize();
  loop();

  document.addEventListener("visibilitychange", () => {
    if(document.hidden) cancelAnimationFrame(raf); else raf=requestAnimationFrame(loop);
  });
})();
