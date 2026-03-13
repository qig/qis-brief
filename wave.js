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
    { yOff: 0.10, ampScale: 0.20, speed: 0.3, xShift: 0.62, color: [61,75,122],  alpha: 0.10, fontSize: 10, count: 55 },
    { yOff: 0.18, ampScale: 0.30, speed: 0.45, xShift: 0.38, color: [55,100,125], alpha: 0.14, fontSize: 11, count: 65 },
    { yOff: 0.30, ampScale: 0.40, speed: 0.6,  xShift: 0.15, color: [45,122,138], alpha: 0.20, fontSize: 13, count: 75 },
    { yOff: 0.44, ampScale: 0.55, speed: 0.8,  xShift: 0.78, color: [35,110,130], alpha: 0.26, fontSize: 15, count: 85 },
    { yOff: 0.58, ampScale: 0.70, speed: 1.0,  xShift: 0.0,  color: [30,95,115],  alpha: 0.32, fontSize: 17, count: 95 },
  ];

  let W, H, time = 0;
  let heightCache = new Float32Array(FFT_SIZE);
  let layerParticles = [];

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

  // ── Lighthouse + Island ──
  // Fixed position — does NOT bob with waves
  const LH_X_NORM = 0.72;

  function drawIslandAndLighthouse() {
    const lhX = W * LH_X_NORM;
    // Fixed base — roughly at layer 2's average position
    const baseY = H * 0.42;
    const lhHeight = H * 0.20;
    const lhWidthBot = 14;
    const lhWidthTop = 8;

    // ── Island / rocky outcrop ──
    const islandW = 48;
    const islandH = 16;
    const rockTop = baseY - islandH;

    ctx.beginPath();
    ctx.moveTo(lhX - islandW, baseY + 4);
    ctx.quadraticCurveTo(lhX - islandW*0.6, baseY - islandH*0.3, lhX - islandW*0.35, baseY - islandH*0.6);
    ctx.quadraticCurveTo(lhX - islandW*0.15, baseY - islandH*0.9, lhX - 6, rockTop);
    ctx.lineTo(lhX + 6, rockTop);
    ctx.quadraticCurveTo(lhX + islandW*0.2, baseY - islandH*0.75, lhX + islandW*0.4, baseY - islandH*0.35);
    ctx.quadraticCurveTo(lhX + islandW*0.7, baseY - islandH*0.1, lhX + islandW, baseY + 4);
    ctx.lineTo(lhX + islandW, baseY + 40);
    ctx.lineTo(lhX - islandW, baseY + 40);
    ctx.closePath();
    ctx.fillStyle = "rgba(45, 65, 85, 0.30)";
    ctx.fill();

    // Rock detail — darker indigo accent
    ctx.beginPath();
    ctx.moveTo(lhX - 12, rockTop + 1);
    ctx.quadraticCurveTo(lhX, rockTop - 4, lhX + 10, rockTop + 2);
    ctx.lineTo(lhX + 7, rockTop + 7);
    ctx.lineTo(lhX - 9, rockTop + 7);
    ctx.closePath();
    ctx.fillStyle = "rgba(50, 58, 90, 0.24)";
    ctx.fill();

    // ── Tower body — warm terracotta ──
    const topY = rockTop - lhHeight + islandH;

    ctx.beginPath();
    ctx.moveTo(lhX - lhWidthBot/2, rockTop);
    ctx.lineTo(lhX - lhWidthTop/2, topY + 12);
    ctx.lineTo(lhX + lhWidthTop/2, topY + 12);
    ctx.lineTo(lhX + lhWidthBot/2, rockTop);
    ctx.closePath();
    ctx.fillStyle = "rgba(180, 88, 55, 0.32)";
    ctx.fill();

    // Stripe — cream with a warm tint
    const towerH = rockTop - topY;
    const stripeY = topY + towerH * 0.5;
    const stripeW = lhWidthBot * 0.72;
    ctx.fillStyle = "rgba(245, 238, 228, 0.26)";
    ctx.fillRect(lhX - stripeW/2, stripeY, stripeW, towerH * 0.10);

    // Lantern room — deeper terracotta
    ctx.fillStyle = "rgba(170, 80, 48, 0.38)";
    ctx.fillRect(lhX - lhWidthTop/2 - 1, topY + 6, lhWidthTop + 2, 8);

    // Dome — indigo
    ctx.beginPath();
    ctx.arc(lhX, topY + 6, lhWidthTop/2 + 1, Math.PI, 0);
    ctx.fillStyle = "rgba(55, 65, 110, 0.35)";
    ctx.fill();

    // ── Sweeping light beam ──
    const lanternY = topY + 8;
    // Sweep: oscillates ±0.8 rad around vertical-up (-PI/2)
    const sweep = Math.sin(time * 0.5) * 0.8;
    const beamAngle = -Math.PI / 2 + sweep;
    const beamLen = Math.max(W, H) * 0.45;
    const beamHalf = 0.06;

    ctx.save();
    ctx.translate(lhX, lanternY);

    // Soft glow around lantern
    const glowGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 40);
    glowGrad.addColorStop(0, "rgba(255, 220, 160, 0.12)");
    glowGrad.addColorStop(1, "rgba(255, 220, 160, 0)");
    ctx.beginPath();
    ctx.arc(0, 0, 40, 0, Math.PI * 2);
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

    const beamGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, beamLen);
    beamGrad.addColorStop(0, "rgba(255, 220, 160, 0.16)");
    beamGrad.addColorStop(0.25, "rgba(255, 210, 140, 0.05)");
    beamGrad.addColorStop(1, "rgba(255, 200, 120, 0)");
    ctx.fillStyle = beamGrad;
    ctx.fill();

    // Bright core
    const coreHalf = beamHalf * 0.35;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(beamAngle - coreHalf) * beamLen * 0.55, Math.sin(beamAngle - coreHalf) * beamLen * 0.55);
    ctx.arc(0, 0, beamLen * 0.55, beamAngle - coreHalf, beamAngle + coreHalf);
    ctx.closePath();
    const coreGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, beamLen * 0.55);
    coreGrad.addColorStop(0, "rgba(255, 240, 200, 0.10)");
    coreGrad.addColorStop(1, "rgba(255, 220, 160, 0)");
    ctx.fillStyle = coreGrad;
    ctx.fill();

    ctx.restore();

    // Lantern bright point
    ctx.beginPath();
    ctx.arc(lhX, lanternY, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 230, 180, 0.45)";
    ctx.fill();
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
    ctx.clearRect(0, 0, W, H);

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.3);
    skyGrad.addColorStop(0, "rgba(250, 247, 242, 0)");
    skyGrad.addColorStop(1, "rgba(220, 235, 240, 0.15)");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H * 0.3);

    // Draw layers back to front
    for (let li = 0; li < LAYERS.length; li++) {
      const layer = LAYERS[li];
      const particles = layerParticles[li];
      const [cr, cg, cb] = layer.color;

      // Water fill
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 3) {
        ctx.lineTo(x, getSurfaceY(layer, x / W));
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${layer.alpha * 0.4})`;
      ctx.fill();

      // Island + lighthouse after layer 1, clipped by front wave surfaces
      // so waves dynamically occlude the island/tower base
      if (li === 1) {
        ctx.save();
        // Build clip: visible region = above the highest wave among layers 2-4
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(W, 0);
        // Walk right-to-left along the composite wave ceiling
        for (let cx = W; cx >= 0; cx -= 3) {
          let minY = H;
          for (let fli = 2; fli < LAYERS.length; fli++) {
            const sy = getSurfaceY(LAYERS[fli], cx / W);
            if (sy < minY) minY = sy;
          }
          ctx.lineTo(cx, minY);
        }
        ctx.closePath();
        ctx.clip();
        drawIslandAndLighthouse();
        ctx.restore();
      }

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
