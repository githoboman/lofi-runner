import * as THREE from 'three';
import type { SceneId } from './types';

function configureColorTexture(
  tex: THREE.Texture,
  maxAniso: number,
  repeatX = 1,
  repeatY = 1,
): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, Math.max(1, maxAniso));
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  tex.needsUpdate = true;
  return tex;
}

export function createSuiCoinTexture(maxAniso: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;

  // Gold metallic base
  const grad = ctx.createRadialGradient(cx - 28, cy - 28, 12, cx, cy, size * 0.5);
  grad.addColorStop(0, '#fff4b8');
  grad.addColorStop(0.55, '#f5c034');
  grad.addColorStop(0.85, '#c98812');
  grad.addColorStop(1, '#8a5808');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Outer milled gold rim
  ctx.beginPath();
  ctx.arc(cx, cy, 114, 0, Math.PI * 2);
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffdf78';
  ctx.stroke();

  // Blue SUI inner medallion
  const blueGrad = ctx.createLinearGradient(0, 26, 0, 230);
  blueGrad.addColorStop(0, '#38bdf8');
  blueGrad.addColorStop(0.5, '#1d8cf8');
  blueGrad.addColorStop(1, '#1e40af');
  ctx.beginPath();
  ctx.arc(cx, cy, 94, 0, Math.PI * 2);
  ctx.fillStyle = blueGrad;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#fde68a';
  ctx.stroke();

  // SUI droplet mark at upper center
  ctx.save();
  ctx.translate(cx, cy - 24);
  ctx.beginPath();
  ctx.moveTo(0, -34);
  ctx.bezierCurveTo(22, -4, 28, 14, 24, 28);
  ctx.arc(0, 24, 24, 0.15, Math.PI - 0.15);
  ctx.bezierCurveTo(-28, 14, -22, -4, 0, -34);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();

  // Inner wave cutout
  ctx.beginPath();
  ctx.moveTo(-16, 18);
  ctx.quadraticCurveTo(-4, 6, 4, 18);
  ctx.quadraticCurveTo(11, 28, 18, 22);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1d8cf8';
  ctx.stroke();
  ctx.restore();

  // Bold "SUI" caption
  ctx.font = '800 44px "Bricolage Grotesque", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fef9c3';
  ctx.fillText('SUI', cx, cy + 48);

  const tex = new THREE.CanvasTexture(canvas);
  return configureColorTexture(tex, maxAniso) as THREE.CanvasTexture;
}

export function createRoadTexture(sceneId: SceneId, maxAniso: number): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  if (sceneId === 'frost_sanctuary') {
    // Restored OG Lofi's Glacier Summit: crisp alpine ice & snow highway
    const bgGrad = ctx.createLinearGradient(0, 0, w, 0);
    bgGrad.addColorStop(0, '#dbeafe');
    bgGrad.addColorStop(0.16, '#93c5fd');
    bgGrad.addColorStop(0.5, '#bfdbfe');
    bgGrad.addColorStop(0.84, '#93c5fd');
    bgGrad.addColorStop(1, '#dbeafe');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.fillRect(40, 0, 108, h);
    ctx.fillRect(202, 0, 108, h);
    ctx.fillRect(364, 0, 108, h);

    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.45)' : 'rgba(56,189,248,0.22)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }

    ctx.fillStyle = '#0284c7';
    ctx.fillRect(10, 0, 12, h);
    ctx.fillRect(w - 22, 0, 12, h);
    for (let y = 12; y < h; y += 56) {
      ctx.fillRect(172, y, 7, 30);
      ctx.fillRect(333, y, 7, 30);
    }
  } else if (sceneId === 'inferno_caldera') {
    // Inferno Blaze's Volcanic Temple Causeway: dark roasted basalt flagstones with subtle deep amber seams
    ctx.fillStyle = '#1c120e';
    ctx.fillRect(0, 0, w, h);

    for (let y = 0; y < h; y += 64) {
      ctx.fillStyle = y % 128 === 0 ? '#271913' : '#20140f';
      ctx.fillRect(0, y, w, 60);
      ctx.fillStyle = 'rgba(154, 52, 18, 0.34)';
      ctx.fillRect(0, y + 60, w, 4);
    }

    // Grounded dark terracotta & warm amber temple curbs
    ctx.fillStyle = '#7c2d12';
    ctx.fillRect(8, 0, 16, h);
    ctx.fillRect(w - 24, 0, 16, h);
    ctx.fillStyle = '#c2410c';
    ctx.fillRect(12, 0, 6, h);
    ctx.fillRect(w - 18, 0, 6, h);

    // Subtle ember-amber lane chevrons
    ctx.fillStyle = '#b45309';
    for (let y = 14; y < h; y += 58) {
      ctx.fillRect(172, y, 8, 32);
      ctx.fillRect(332, y, 8, 32);
    }
  } else if (sceneId === 'slime_catacombs') {
    // Neon Slime's Sewer Tunnels: riveted steel catwalk grating over glowing toxic runoff
    ctx.fillStyle = '#0e1916';
    ctx.fillRect(0, 0, w, h);

    for (let y = 0; y < h; y += 24) {
      ctx.fillStyle = y % 48 === 0 ? '#182b24' : '#13221c';
      ctx.fillRect(24, y, w - 48, 20);
      ctx.fillStyle = 'rgba(74, 222, 128, 0.22)';
      ctx.fillRect(24, y + 20, w - 48, 4);
    }

    // Glowing neon-green sewer runoff gutters along both outer edges
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(0, 0, 24, h);
    ctx.fillRect(w - 24, 0, 24, h);
    ctx.fillStyle = '#bef264';
    ctx.fillRect(8, 0, 8, h);
    ctx.fillRect(w - 16, 0, 8, h);

    ctx.fillStyle = '#4ade80';
    for (let y = 10; y < h; y += 48) {
      ctx.fillRect(172, y, 8, 28);
      ctx.fillRect(332, y, 8, 28);
    }
  } else if (sceneId === 'cyber_foundry') {
    // Half-Cyborg's Pure Cyberpunk City: wet rain-slick dark asphalt with glowing cyan & magenta circuit strips
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, w, h);

    // Subtle glossy wet asphalt reflection streaks
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = i % 3 === 0 ? 'rgba(56,189,248,0.08)' : 'rgba(168,85,247,0.07)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 4, 18);
    }

    // Neon cyan & magenta curb rails
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(8, 0, 10, h);
    ctx.fillStyle = '#e879f9';
    ctx.fillRect(w - 18, 0, 10, h);

    // Sleek cyber lane dashes
    for (let y = 10; y < h; y += 54) {
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(172, y, 7, 32);
      ctx.fillStyle = '#c084fc';
      ctx.fillRect(333, y, 7, 32);
    }
  } else {
    // Void Shadow's Astral Gallery: dark polished obsidian marble with violet-gold inlays
    ctx.fillStyle = '#12101e';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(167, 139, 250, 0.22)';
    ctx.lineWidth = 2;
    for (let y = 0; y <= h; y += 128) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = 0; x <= w; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 16; i++) {
      ctx.beginPath();
      const sx = Math.random() * w;
      const sy = Math.random() * h;
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx + 40, sy + 20, sx - 30, sy + 70, sx + 70, sy + 95);
      ctx.stroke();
    }

    ctx.fillStyle = '#a78bfa';
    ctx.fillRect(12, 0, 10, h);
    ctx.fillRect(w - 22, 0, 10, h);
    ctx.fillStyle = 'rgba(212, 175, 55, 0.65)';
    ctx.fillRect(174, 0, 5, h);
    ctx.fillRect(333, 0, 5, h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  return configureColorTexture(tex, maxAniso, 1, 4) as THREE.CanvasTexture;
}

export function createCrateTexture(maxAniso: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#a16207';
  ctx.fillRect(0, 0, size, size);

  // Horizontal planks
  for (let y = 0; y < size; y += 32) {
    ctx.fillStyle = y % 64 === 0 ? '#b47412' : '#955a07';
    ctx.fillRect(0, y, size, 30);
    ctx.fillStyle = '#5c3404';
    ctx.fillRect(0, y + 30, size, 2);
  }

  // Diagonal brace
  ctx.strokeStyle = '#784606';
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.moveTo(22, 22);
  ctx.lineTo(size - 22, size - 22);
  ctx.stroke();

  // Outer timber frame
  ctx.strokeStyle = '#6b3c05';
  ctx.lineWidth = 26;
  ctx.strokeRect(13, 13, size - 26, size - 26);

  // Corner bolts
  ctx.fillStyle = '#334155';
  const corners = [
    [24, 24],
    [size - 24, 24],
    [24, size - 24],
    [size - 24, size - 24],
  ];
  for (const [x, y] of corners) {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  return configureColorTexture(tex, maxAniso) as THREE.CanvasTexture;
}

export function createHazardStripeTexture(maxAniso: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#111827';
  for (let i = -size; i < size * 2; i += 48) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 24, 0);
    ctx.lineTo(i - size + 24, size);
    ctx.lineTo(i - size, size);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  return configureColorTexture(tex, maxAniso, 3, 1) as THREE.CanvasTexture;
}

export function createContainerTexture(baseHex: string, maxAniso: number): THREE.CanvasTexture {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, w, h);

  // Corrugated vertical ribs
  for (let x = 0; x < w; x += 16) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, 14, 5, h - 28);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + 8, 14, 5, h - 28);
  }

  // Top/bottom steel beams
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, w, 14);
  ctx.fillRect(0, h - 14, w, 14);

  // Stencil mark
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '700 32px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SUI PORT', w / 2, h / 2 + 10);

  const tex = new THREE.CanvasTexture(canvas);
  return configureColorTexture(tex, maxAniso) as THREE.CanvasTexture;
}

export function createArtFallbackTexture(index: number, maxAniso: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const palettes: [string, string, string][] = [
    ['#0f172a', '#38bdf8', '#f8fafc'],
    ['#1e1b4b', '#818cf8', '#f472b6'],
    ['#064e3b', '#34d399', '#fef08a'],
    ['#431407', '#fb923c', '#fde68a'],
    ['#172554', '#60a5fa', '#e0f2fe'],
    ['#3b0764', '#c084fc', '#38bdf8'],
  ];
  const [bg, accent, hi] = palettes[index % palettes.length];

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Stylized geometric Lofi Yeti silhouette
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.arc(128, 128, 66, 0, Math.PI * 2);
  ctx.fill();

  // Blue mask
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.ellipse(128, 122, 44, 24, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(110, 122, 14, 9, 0, 0, Math.PI * 2);
  ctx.ellipse(146, 122, 14, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.arc(112, 122, 6, 0, Math.PI * 2);
  ctx.arc(144, 122, 6, 0, Math.PI * 2);
  ctx.fill();

  // Label
  ctx.fillStyle = accent;
  ctx.font = '700 18px "Bricolage Grotesque", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`LOFI #0${index + 1}`, 128, 226);

  const tex = new THREE.CanvasTexture(canvas);
  return configureColorTexture(tex, maxAniso) as THREE.CanvasTexture;
}

export function createRadialShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
  grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.28)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createSkyGradientTexture(
  topHex: string,
  midHex: string,
  bottomHex: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, topHex);
  grad.addColorStop(0.52, midHex);
  grad.addColorStop(1, bottomHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Loads art URLs into an array of textures, starting with procedural fallbacks
 * and upgrading each slot once its image loads.
 */
export function loadArtTextures(
  urls: string[],
  maxAniso: number,
  onUpdate?: (index: number, tex: THREE.Texture) => void,
): THREE.Texture[] {
  const loader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = urls.map((_, idx) => createArtFallbackTexture(idx, maxAniso));

  urls.forEach((url, idx) => {
    loader.load(
      url,
      (loadedTex) => {
        loadedTex.colorSpace = THREE.SRGBColorSpace;
        loadedTex.anisotropy = Math.min(8, Math.max(1, maxAniso));
        loadedTex.needsUpdate = true;
        textures[idx].dispose();
        textures[idx] = loadedTex;
        onUpdate?.(idx, loadedTex);
      },
      undefined,
      () => {
        // Keep generated fallback silently
      },
    );
  });

  return textures;
}

/**
 * Generates seamless horizontally-wrapping panoramic parallax backdrop textures
 * for each of the 5 Yeti Home Worlds ('far' skyline/mountains & 'mid' clouds/mist/bridges).
 */
export function createParallaxHorizonTexture(
  sceneId: SceneId,
  layer: 'far' | 'mid',
  maxAniso: number,
): THREE.CanvasTexture {
  const w = 1024;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  const drawCloudBand = (
    colorA: string,
    colorB: string,
    baseY: number,
    puffCount: number,
    minR: number,
    maxR: number,
  ) => {
    for (let i = 0; i < puffCount; i++) {
      const t = i / puffCount;
      const cx = t * w;
      const cy = baseY + Math.sin(t * Math.PI * 6) * 20;
      const r = minR + ((i * 37) % 100) * 0.01 * (maxR - minR);
      for (const ox of [0, -w, w]) {
        const g = ctx.createRadialGradient(cx + ox, cy, r * 0.12, cx + ox, cy, r);
        g.addColorStop(0, colorA);
        g.addColorStop(0.55, colorB);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx + ox, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  if (sceneId === 'frost_sanctuary') {
    if (layer === 'far') {
      // Towering snow-covered alpine range silhouette
      ctx.beginPath();
      ctx.moveTo(0, h);
      const peaks = 16;
      for (let i = 0; i <= peaks; i++) {
        const x = (i / peaks) * w;
        const peakY = i % 2 === 0 ? 48 + ((i * 23) % 52) : 138 + ((i * 17) % 36);
        ctx.lineTo(x, peakY);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 40, 0, h);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
      grad.addColorStop(0.42, 'rgba(224, 242, 254, 0.92)');
      grad.addColorStop(1, 'rgba(186, 230, 253, 0.65)');
      ctx.fillStyle = grad;
      ctx.fill();

      // Glinting ice ridge highlights
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      // Crisp sunlit alpine mountain cloud ribbons (clear blue winter sky)
      drawCloudBand('rgba(255, 255, 255, 0.45)', 'rgba(219, 234, 254, 0.18)', 118, 14, 34, 72);
    }
  } else if (sceneId === 'inferno_caldera') {
    if (layer === 'far') {
      // Grounded dark volcanic brown caldera peaks with subtle terracotta crust veins
      ctx.beginPath();
      ctx.moveTo(0, h);
      const peaks = 18;
      for (let i = 0; i <= peaks; i++) {
        const x = (i / peaks) * w;
        const py = i % 2 === 0 ? 52 + ((i * 31) % 60) : 155 + ((i * 19) % 30);
        ctx.lineTo(x, py);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 50, 0, h);
      g.addColorStop(0, '#2e1b13');
      g.addColorStop(0.65, '#1d110c');
      g.addColorStop(1, '#4a2818');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.5)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Subtle smoldering fissures along caldera slopes
      ctx.strokeStyle = 'rgba(194, 65, 12, 0.55)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 10; i++) {
        const fx = (i + 0.4) * (w / 10);
        ctx.beginPath();
        ctx.moveTo(fx, 114 + (i % 3) * 18);
        ctx.lineTo(fx + 14, 174);
        ctx.lineTo(fx - 8, 242);
        ctx.stroke();
      }
    } else {
      // Subtle cool-grey & warm-umber volcanic ash clouds
      drawCloudBand('rgba(120, 102, 92, 0.34)', 'rgba(66, 44, 34, 0.18)', 118, 18, 42, 88);
      drawCloudBand('rgba(156, 134, 122, 0.2)', 'rgba(84, 52, 36, 0.1)', 165, 14, 34, 66);
    }
  } else if (sceneId === 'slime_catacombs') {
    if (layer === 'far') {
      // Towering subterranean bio-containment silos & mega-pipes
      const count = 16;
      const step = w / count;
      for (let i = 0; i < count; i++) {
        const x = i * step;
        const bw = step * 0.72;
        const bh = 95 + ((i * 47) % 105);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(6, 36, 23, 0.92)' : 'rgba(10, 48, 30, 0.88)';
        ctx.fillRect(x, h - bh, bw, bh);

        // Glowing neon slime gauge strips
        ctx.fillStyle = 'rgba(74, 222, 128, 0.65)';
        ctx.fillRect(x + bw * 0.25, h - bh + 18, bw * 0.5, 8);
        ctx.fillStyle = 'rgba(190, 242, 100, 0.42)';
        ctx.fillRect(x + bw * 0.44, h - bh + 34, 4, bh - 48);
      }
    } else {
      // Swirling bioluminescent ectoplasm mist bands
      drawCloudBand('rgba(74, 222, 128, 0.36)', 'rgba(22, 163, 74, 0.18)', 130, 18, 44, 88);
      drawCloudBand('rgba(190, 242, 100, 0.28)', 'rgba(34, 197, 94, 0.1)', 88, 14, 30, 62);
    }
  } else if (sceneId === 'cyber_foundry') {
    if (layer === 'far') {
      // Dense cyberpunk megacity skyline with neon cyan/magenta/amber window grids
      const count = 28;
      const step = w / count;
      const neonColors = ['#38bdf8', '#a855f7', '#22d3ee', '#f59e0b'];
      for (let i = 0; i < count; i++) {
        const x = i * step;
        const bw = step * 0.86;
        const bh = 78 + ((i * 53) % 148);
        ctx.fillStyle = i % 2 === 0 ? '#0c1328' : '#111b36';
        ctx.fillRect(x, h - bh, bw, bh);

        // Rooftop antenna spire
        if (i % 3 === 0) {
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(x + bw * 0.46, h - bh - 26, 2, 26);
        }

        // Lit neon windows
        ctx.fillStyle = neonColors[i % neonColors.length];
        for (let wy = h - bh + 12; wy < h - 16; wy += 16) {
          for (let wx = x + 5; wx < x + bw - 8; wx += 9) {
            if ((Math.floor(wx + wy) + i) % 3 !== 0) {
              ctx.globalAlpha = 0.55;
              ctx.fillRect(wx, wy, 4, 6);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
    } else {
      // Illuminated sky-bridge beams & atmospheric cyberpunk cyan-violet haze
      drawCloudBand('rgba(56, 189, 248, 0.25)', 'rgba(168, 85, 247, 0.12)', 115, 16, 40, 86);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.fillRect(0, 178, w, 4);
      ctx.fillStyle = 'rgba(168, 85, 247, 0.32)';
      ctx.fillRect(0, 206, w, 3);
    }
  } else {
    // void_gallery: Astral cosmic nebula & floating celestial rings
    if (layer === 'far') {
      drawCloudBand('rgba(167, 139, 250, 0.45)', 'rgba(109, 40, 217, 0.2)', 125, 18, 56, 112);
      drawCloudBand('rgba(253, 224, 71, 0.24)', 'rgba(139, 92, 246, 0.12)', 95, 12, 34, 72);
      // Distant eclipse rings & star specks
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.55)';
      ctx.lineWidth = 2.5;
      for (const rx of [210, 680]) {
        ctx.beginPath();
        ctx.ellipse(rx, 86, 52, 16, -0.25, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#fef9c3';
      for (let i = 0; i < 120; i++) {
        ctx.fillRect((i * 89) % w, (i * 53) % (h - 20), 2, 2);
      }
    } else {
      drawCloudBand('rgba(196, 181, 253, 0.32)', 'rgba(91, 33, 182, 0.14)', 142, 16, 38, 80);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(2, 1);
  tex.anisotropy = Math.min(8, Math.max(1, maxAniso));
  tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable viscous toxic slime liquid texture with layered swirling emerald/lime currents
 * and glossy highlight bands for continuous UV-scrolled slime rivers and pouring outfall streams.
 */
export function createFlowingSlimeTexture(maxAniso: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Rich toxic emerald base
  ctx.fillStyle = '#0d5c2b';
  ctx.fillRect(0, 0, size, size);

  // Seamless sinusoidal flowing viscous slime ribbons (tileable vertically & horizontally)
  const bands = [
    { color: 'rgba(22, 163, 74, 0.85)', width: 58, amp: 24, freq: 2, phase: 0.2 },
    { color: 'rgba(74, 222, 128, 0.72)', width: 32, amp: 34, freq: 3, phase: 1.4 },
    { color: 'rgba(163, 230, 53, 0.65)', width: 16, amp: 28, freq: 2, phase: 2.7 },
    { color: 'rgba(217, 249, 157, 0.55)', width: 7, amp: 22, freq: 4, phase: 0.9 },
  ];

  for (let b = 0; b < bands.length; b++) {
    const band = bands[b];
    ctx.strokeStyle = band.color;
    ctx.lineWidth = band.width;
    ctx.lineCap = 'round';

    for (let lane = 0; lane < 4; lane++) {
      const baseX = (lane + 0.5) * (size / 4) + b * 17;
      for (const wrapOffset of [-size, 0, size]) {
        ctx.beginPath();
        for (let y = -16; y <= size + 16; y += 8) {
          const t = (y / size) * Math.PI * 2;
          const x =
            baseX +
            wrapOffset +
            Math.sin(t * band.freq + band.phase + lane * 1.6) * band.amp +
            Math.cos(t * (band.freq + 1) + lane) * (band.amp * 0.35);
          if (y === -16) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }

  // Glossy floating toxic foam bubbles & glowing ripples baked cleanly into the flow
  for (let i = 0; i < 42; i++) {
    const cx = ((i * 113 + 37) % size);
    const cy = ((i * 197 + 53) % size);
    const r = 6 + (i % 5) * 4.5;
    const grad = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, 1, cx, cy, r);
    grad.addColorStop(0, 'rgba(236, 252, 203, 0.85)');
    grad.addColorStop(0.55, 'rgba(134, 239, 172, 0.35)');
    grad.addColorStop(1, 'rgba(22, 163, 74, 0)');
    ctx.fillStyle = grad;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, Math.max(1, maxAniso));
  tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable grounded brown volcanic magma crust texture:
 * cooled roasted-umber rock plates interlaced with subtle smoldering terracotta & deep amber veins.
 */
export function createBrownMagmaTexture(maxAniso: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Deep roasted volcanic brown crust base
  ctx.fillStyle = '#2b1911';
  ctx.fillRect(0, 0, size, size);

  // Subtle textured basalt crust patches (seamless wrapping)
  const plateColors = ['#3a2317', '#24140d', '#472b1c', '#311d13', '#523322'];
  for (let i = 0; i < 72; i++) {
    const cx = (i * 131 + 29) % size;
    const cy = (i * 193 + 47) % size;
    const rx = 24 + (i % 5) * 13;
    const ry = 20 + ((i * 3) % 5) * 11;
    const rot = ((i * 41) % 314) * 0.01;
    ctx.fillStyle = plateColors[i % plateColors.length];
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.save();
        ctx.translate(cx + ox, cy + oy);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // Slow-flowing smoldering magma veins beneath the cooled brown crust (tileable sine ribbons)
  const veins = [
    { color: 'rgba(124, 45, 18, 0.72)', width: 14, amp: 28, freq: 2, phase: 0.4 },
    { color: 'rgba(180, 83, 9, 0.56)', width: 6.5, amp: 28, freq: 2, phase: 0.4 },
    { color: 'rgba(217, 119, 6, 0.42)', width: 2.4, amp: 28, freq: 2, phase: 0.4 },
  ];

  for (let v = 0; v < veins.length; v++) {
    const vein = veins[v];
    ctx.strokeStyle = vein.color;
    ctx.lineWidth = vein.width;
    ctx.lineCap = 'round';
    for (let lane = 0; lane < 3; lane++) {
      const baseX = (lane + 0.5) * (size / 3);
      for (const wrapX of [-size, 0, size]) {
        ctx.beginPath();
        for (let y = -16; y <= size + 16; y += 8) {
          const t = (y / size) * Math.PI * 2;
          const x =
            baseX +
            wrapX +
            Math.sin(t * vein.freq + vein.phase + lane * 2.1) * vein.amp +
            Math.cos(t * 3 + lane) * 10;
          if (y === -16) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }

  // Cross-fissure glowing brown-amber crust cracks
  for (let i = 0; i < 18; i++) {
    const x0 = (i * 157 + 19) % size;
    const y0 = (i * 97 + 41) % size;
    const dx = 44 + (i % 4) * 18;
    const dy = (i % 2 === 0 ? 1 : -1) * (22 + (i % 3) * 14);
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.strokeStyle = 'rgba(154, 52, 18, 0.45)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x0 + ox, y0 + oy);
        ctx.lineTo(x0 + ox + dx * 0.5, y0 + oy + dy * 0.65);
        ctx.lineTo(x0 + ox + dx, y0 + oy + dy);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(217, 119, 6, 0.32)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  // Fine volcanic grain & ash speckles
  for (let i = 0; i < 900; i++) {
    const px = (i * 73 + 11) % size;
    const py = (i * 149 + 37) % size;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(20, 10, 6, 0.35)' : 'rgba(120, 88, 70, 0.16)';
    ctx.fillRect(px, py, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, Math.max(1, maxAniso));
  tex.needsUpdate = true;
  return tex;
}


