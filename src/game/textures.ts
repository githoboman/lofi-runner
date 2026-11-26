import * as THREE from 'three';
import type { CharacterId, SceneId } from './types';

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
    // Neon Slime's Industrial Lab: dark slate steel deck with restrained deep emerald accents
    ctx.fillStyle = '#0f161b';
    ctx.fillRect(0, 0, w, h);

    for (let y = 0; y < h; y += 24) {
      ctx.fillStyle = y % 48 === 0 ? '#18222a' : '#131b22';
      ctx.fillRect(24, y, w - 48, 20);
      ctx.fillStyle = 'rgba(20, 83, 65, 0.22)';
      ctx.fillRect(24, y + 20, w - 48, 4);
    }

    // Muted dark industrial containment gutters along outer edges (no harsh lime glare)
    ctx.fillStyle = '#14382c';
    ctx.fillRect(0, 0, 24, h);
    ctx.fillRect(w - 24, 0, 24, h);
    ctx.fillStyle = '#1f6f52';
    ctx.fillRect(9, 0, 6, h);
    ctx.fillRect(w - 15, 0, 6, h);

    // Subtle deep-emerald lane dashes for clean readability without eye strain
    ctx.fillStyle = '#2a8563';
    for (let y = 10; y < h; y += 48) {
      ctx.fillRect(172, y, 7, 28);
      ctx.fillRect(333, y, 7, 28);
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
      // Towering subterranean industrial slate silos & containment pipes
      const count = 16;
      const step = w / count;
      for (let i = 0; i < count; i++) {
        const x = i * step;
        const bw = step * 0.72;
        const bh = 95 + ((i * 47) % 105);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(13, 22, 28, 0.94)' : 'rgba(19, 30, 38, 0.9)';
        ctx.fillRect(x, h - bh, bw, bh);

        // Restrained deep-teal/emerald gauge strips
        ctx.fillStyle = 'rgba(31, 111, 82, 0.55)';
        ctx.fillRect(x + bw * 0.25, h - bh + 18, bw * 0.5, 6);
        ctx.fillStyle = 'rgba(42, 133, 99, 0.34)';
        ctx.fillRect(x + bw * 0.45, h - bh + 34, 3, bh - 48);
      }
    } else {
      // Soft dark-slate subterranean steam mist (no bright neon-green wash)
      drawCloudBand('rgba(30, 56, 52, 0.28)', 'rgba(15, 29, 34, 0.16)', 130, 16, 44, 84);
      drawCloudBand('rgba(24, 68, 56, 0.18)', 'rgba(12, 24, 28, 0.08)', 90, 12, 30, 60);
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

  // Deep forest-emerald industrial liquid base (comfortable on eyes)
  ctx.fillStyle = '#092b20';
  ctx.fillRect(0, 0, size, size);

  // Seamless sinusoidal flowing viscous slime ribbons in restrained dark-emerald tones
  const bands = [
    { color: 'rgba(15, 76, 54, 0.82)', width: 58, amp: 24, freq: 2, phase: 0.2 },
    { color: 'rgba(22, 105, 74, 0.62)', width: 30, amp: 34, freq: 3, phase: 1.4 },
    { color: 'rgba(34, 134, 96, 0.45)', width: 14, amp: 28, freq: 2, phase: 2.7 },
    { color: 'rgba(74, 168, 132, 0.32)', width: 6, amp: 22, freq: 4, phase: 0.9 },
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

  // Subtle darker liquid ripples baked into the surface
  for (let i = 0; i < 32; i++) {
    const cx = ((i * 113 + 37) % size);
    const cy = ((i * 197 + 53) % size);
    const r = 6 + (i % 5) * 4;
    const grad = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, 1, cx, cy, r);
    grad.addColorStop(0, 'rgba(94, 185, 148, 0.38)');
    grad.addColorStop(0.55, 'rgba(24, 102, 74, 0.22)');
    grad.addColorStop(1, 'rgba(10, 48, 34, 0)');
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

/**
 * Tileable half-pipe slide chute textures for each world's signature mid-run Slide / Blackhole zone!
 */
export function createSlideSurfaceTexture(sceneId: SceneId, maxAniso: number): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  if (sceneId === 'frost_sanctuary') {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#f8fafc');
    grad.addColorStop(0.18, '#bae6fd');
    grad.addColorStop(0.5, '#e0f2fe');
    grad.addColorStop(0.82, '#bae6fd');
    grad.addColorStop(1, '#f8fafc');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 18; i++) {
      const x = ((i + 0.5) / 18) * w;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.68)' : 'rgba(56,189,248,0.28)';
      ctx.fillRect(x - 6, 0, 12, h);
    }
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.45)';
    ctx.lineWidth = 8;
    for (let y = 40; y < h; y += 128) {
      ctx.beginPath();
      ctx.moveTo(w * 0.24, y + 36);
      ctx.lineTo(w * 0.5, y);
      ctx.lineTo(w * 0.76, y + 36);
      ctx.stroke();
    }
  } else if (sceneId === 'inferno_caldera') {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#2a1811');
    grad.addColorStop(0.2, '#3d2216');
    grad.addColorStop(0.5, '#572d18');
    grad.addColorStop(0.8, '#3d2216');
    grad.addColorStop(1, '#2a1811');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const streaks = [
      { x: 0.2, c: 'rgba(180, 83, 9, 0.58)', w: 22 },
      { x: 0.38, c: 'rgba(217, 119, 6, 0.55)', w: 14 },
      { x: 0.5, c: 'rgba(234, 88, 12, 0.72)', w: 28 },
      { x: 0.62, c: 'rgba(217, 119, 6, 0.55)', w: 14 },
      { x: 0.8, c: 'rgba(180, 83, 9, 0.58)', w: 22 },
    ];
    for (const s of streaks) {
      ctx.strokeStyle = s.c;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      for (let y = 0; y <= h; y += 16) {
        const t = (y / h) * Math.PI * 2;
        const px = s.x * w + Math.sin(t * 2 + s.x * 10) * 14;
        if (y === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
  } else if (sceneId === 'slime_catacombs') {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#0a221b');
    grad.addColorStop(0.2, '#113a2d');
    grad.addColorStop(0.5, '#17523f');
    grad.addColorStop(0.8, '#113a2d');
    grad.addColorStop(1, '#0a221b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 6; i++) {
      const x = ((i + 0.5) / 6) * w;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(52, 152, 114, 0.42)' : 'rgba(12, 46, 36, 0.55)';
      ctx.lineWidth = 16;
      ctx.beginPath();
      for (let y = 0; y <= h; y += 16) {
        const t = (y / h) * Math.PI * 2;
        const px = x + Math.sin(t * 2 + i) * 18;
        if (y === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
  } else if (sceneId === 'void_gallery') {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#090516');
    grad.addColorStop(0.22, '#1e1042');
    grad.addColorStop(0.5, '#070411');
    grad.addColorStop(0.78, '#1e1042');
    grad.addColorStop(1, '#090516');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(167, 139, 250, 0.55)';
    ctx.lineWidth = 5;
    for (let y = 0; y < h; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(w * 0.5, y + 36, w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
    ctx.lineWidth = 4;
    for (const fx of [0.16, 0.34, 0.66, 0.84]) {
      ctx.beginPath();
      ctx.moveTo(fx * w, 0);
      ctx.lineTo(fx * w, h);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#050816';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 4;
    for (let y = 0; y < h; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  return configureColorTexture(tex, maxAniso, 1, 16) as THREE.CanvasTexture;
}

/**
 * Faithfully hand-crafted high-resolution 512x512 face plate textures matching the exact
 * Lofi & Mystic Yetis original reference artworks (expressions, linework, eyes, teeth & splits).
 */
export function createYetiFaceTexture(charId: CharacterId, maxAniso: number): THREE.CanvasTexture {
  const s = 512;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawLofiEye = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    outline: string,
    sclera: string,
    pupilColor: string,
    sleepy = true,
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy + 4);
    ctx.quadraticCurveTo(cx, cy - ry * 1.35, cx + rx, cy + 4);
    ctx.quadraticCurveTo(cx, cy + ry * 1.15, cx - rx, cy + 4);
    ctx.closePath();
    ctx.fillStyle = sclera;
    ctx.fill();
    ctx.save();
    ctx.clip();

    if (pupilColor) {
      ctx.fillStyle = pupilColor;
      ctx.beginPath();
      ctx.arc(cx, cy + 2, ry * 0.92, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx - ry * 0.34, cy - ry * 0.28, ry * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.lineWidth = 10;
    ctx.strokeStyle = outline;
    ctx.stroke();

    if (sleepy) {
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(cx - rx * 1.02, cy - ry * 0.62);
      ctx.quadraticCurveTo(cx, cy - ry * 1.62, cx + rx * 1.02, cy - ry * 0.56);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx - rx * 0.96, cy - ry * 1.18);
      ctx.quadraticCurveTo(cx, cy - ry * 2.08, cx + rx * 0.96, cy - ry * 1.1);
      ctx.stroke();

      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - rx * 0.85, cy + ry * 1.12);
      ctx.quadraticCurveTo(cx, cy + ry * 1.56, cx + rx * 0.85, cy + ry * 1.08);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawWavyLips = (
    yCenter: number,
    fillColor: string,
    outlineColor: string,
    xLeft = 74,
    xRight = 438,
  ) => {
    const mid = (xLeft + xRight) * 0.5;
    ctx.beginPath();
    ctx.moveTo(xLeft, yCenter + 4);
    ctx.bezierCurveTo(xLeft + 26, yCenter - 36, mid - 72, yCenter - 16, mid - 28, yCenter - 26);
    ctx.quadraticCurveTo(mid, yCenter - 36, mid + 28, yCenter - 26);
    ctx.bezierCurveTo(mid + 72, yCenter - 16, xRight - 26, yCenter - 36, xRight, yCenter + 4);
    ctx.bezierCurveTo(xRight - 24, yCenter + 48, mid + 64, yCenter + 38, mid, yCenter + 42);
    ctx.bezierCurveTo(mid - 64, yCenter + 38, xLeft + 24, yCenter + 48, xLeft, yCenter + 4);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = outlineColor;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(xLeft + 14, yCenter + 6);
    ctx.bezierCurveTo(xLeft + 80, yCenter - 6, mid - 40, yCenter + 18, mid, yCenter + 4);
    ctx.bezierCurveTo(mid + 40, yCenter + 18, xRight - 80, yCenter - 6, xRight - 14, yCenter + 6);
    ctx.lineWidth = 9;
    ctx.strokeStyle = outlineColor;
    ctx.stroke();
  };

  if (charId === 'og_lofi') {
    ctx.fillStyle = '#d7dde6';
    ctx.fillRect(0, 0, s, s);

    ctx.fillStyle = '#5c9ce6';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s, 0);
    ctx.lineTo(s, 276);
    ctx.quadraticCurveTo(380, 294, 256, 286);
    ctx.quadraticCurveTo(132, 294, 0, 276);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#0b0f19';
    ctx.stroke();

    drawLofiEye(162, 186, 86, 56, '#0b0f19', '#ffffff', '#0b0f19', true);
    drawLofiEye(350, 186, 86, 56, '#0b0f19', '#ffffff', '#0b0f19', true);

    ctx.fillStyle = '#5c9ce6';
    ctx.beginPath();
    ctx.moveTo(212, 256);
    ctx.quadraticCurveTo(256, 224, 300, 256);
    ctx.quadraticCurveTo(324, 296, 286, 306);
    ctx.quadraticCurveTo(256, 314, 226, 306);
    ctx.quadraticCurveTo(188, 296, 212, 256);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#0b0f19';
    ctx.stroke();

    ctx.fillStyle = '#0b0f19';
    ctx.beginPath();
    ctx.ellipse(234, 282, 11, 14, -0.18, 0, Math.PI * 2);
    ctx.ellipse(278, 282, 11, 14, 0.18, 0, Math.PI * 2);
    ctx.fill();

    drawWavyLips(368, '#5c9ce6', '#0b0f19', 70, 442);
  } else if (charId === 'inferno_blaze') {
    const bg = ctx.createLinearGradient(0, 0, 0, s);
    bg.addColorStop(0, '#f97316');
    bg.addColorStop(0.55, '#fb923c');
    bg.addColorStop(1, '#ea580c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);

    const crimson = '#b91c1c';

    const drawFlameBrow = (dir: number) => {
      ctx.save();
      ctx.translate(256, 174);
      ctx.scale(dir, 1);
      ctx.beginPath();
      ctx.moveTo(8, 12);
      ctx.quadraticCurveTo(68, -32, 146, -12);
      ctx.quadraticCurveTo(184, 2, 198, 34);
      ctx.quadraticCurveTo(156, 18, 126, 32);
      ctx.quadraticCurveTo(80, 12, 12, 24);
      ctx.closePath();
      ctx.fillStyle = '#fde047';
      ctx.fill();
      ctx.lineWidth = 9;
      ctx.strokeStyle = crimson;
      ctx.stroke();

      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.ellipse(84, -4, 48, 13, 0.08, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(34, 42);
      ctx.quadraticCurveTo(100, 28, 162, 46);
      ctx.lineWidth = 9;
      ctx.strokeStyle = crimson;
      ctx.stroke();
      ctx.restore();
    };
    drawFlameBrow(-1);
    drawFlameBrow(1);

    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.moveTo(214, 248);
    ctx.quadraticCurveTo(256, 224, 298, 248);
    ctx.quadraticCurveTo(316, 282, 256, 288);
    ctx.quadraticCurveTo(196, 282, 214, 248);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = crimson;
    ctx.stroke();

    ctx.fillStyle = crimson;
    ctx.beginPath();
    ctx.ellipse(234, 266, 10, 13, -0.2, 0, Math.PI * 2);
    ctx.ellipse(278, 266, 10, 13, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.roundRect(62, 314, 388, 108, 52);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = crimson;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(86, 336, 340, 64, 30);
    ctx.fillStyle = '#fef9c3';
    ctx.fill();
    ctx.clip();

    ctx.strokeStyle = crimson;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(80, 368);
    ctx.lineTo(432, 368);
    ctx.stroke();
    for (let tx = 128; tx <= 388; tx += 36) {
      ctx.beginPath();
      ctx.moveTo(tx, 332);
      ctx.lineTo(tx, 404);
      ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.roundRect(86, 336, 340, 64, 30);
    ctx.lineWidth = 8;
    ctx.strokeStyle = crimson;
    ctx.stroke();
  } else if (charId === 'neon_slime') {
    const darkGreen = '#14532d';
    const bg = ctx.createLinearGradient(0, 0, 0, s);
    bg.addColorStop(0, '#4ade80');
    bg.addColorStop(0.55, '#86efac');
    bg.addColorStop(1, '#4ade80');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);

    drawLofiEye(162, 178, 84, 52, '#166534', '#bbf7d0', '#15803d', true);
    drawLofiEye(350, 178, 84, 52, '#166534', '#bbf7d0', '#15803d', true);

    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.moveTo(0, 240);
    ctx.quadraticCurveTo(64, 286, 118, 250);
    ctx.quadraticCurveTo(174, 294, 214, 256);
    ctx.quadraticCurveTo(256, 298, 298, 256);
    ctx.quadraticCurveTo(338, 294, 394, 250);
    ctx.quadraticCurveTo(448, 286, s, 240);
    ctx.lineTo(s, 224);
    ctx.lineTo(0, 224);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = darkGreen;
    ctx.stroke();

    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.ellipse(256, 258, 42, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = darkGreen;
    ctx.stroke();
    ctx.fillStyle = darkGreen;
    ctx.beginPath();
    ctx.arc(238, 256, 9, 0, Math.PI * 2);
    ctx.arc(274, 256, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(74, 310, 364, 116, 40);
    ctx.fillStyle = '#a3e635';
    ctx.fill();
    ctx.clip();

    ctx.strokeStyle = darkGreen;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(68, 368);
    ctx.lineTo(444, 368);
    ctx.stroke();
    for (let tx = 114; tx <= 398; tx += 36) {
      ctx.beginPath();
      ctx.moveTo(tx, 304);
      ctx.lineTo(tx, 432);
      ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.roundRect(74, 310, 364, 116, 40);
    ctx.lineWidth = 9;
    ctx.strokeStyle = darkGreen;
    ctx.stroke();

    ctx.fillStyle = 'rgba(236, 252, 203, 0.72)';
    ctx.beginPath();
    ctx.ellipse(98, 92, 34, 14, -0.3, 0, Math.PI * 2);
    ctx.ellipse(422, 108, 22, 10, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (charId === 'half_cyborg') {
    // RIGHT HALF (Organic OG Lofi)
    ctx.save();
    ctx.beginPath();
    ctx.rect(256, 0, 256, s);
    ctx.clip();
    ctx.fillStyle = '#d7dde6';
    ctx.fillRect(256, 0, 256, s);
    ctx.fillStyle = '#5c9ce6';
    ctx.fillRect(256, 0, 256, 284);
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#0b0f19';
    ctx.beginPath();
    ctx.moveTo(256, 284);
    ctx.lineTo(s, 276);
    ctx.stroke();
    drawLofiEye(352, 186, 86, 56, '#0b0f19', '#ffffff', '#0b0f19', true);
    ctx.fillStyle = '#5c9ce6';
    ctx.beginPath();
    ctx.moveTo(256, 232);
    ctx.quadraticCurveTo(314, 248, 304, 292);
    ctx.quadraticCurveTo(286, 312, 256, 310);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = '#0b0f19';
    ctx.beginPath();
    ctx.ellipse(278, 282, 11, 14, 0.16, 0, Math.PI * 2);
    ctx.fill();
    drawWavyLips(368, '#5c9ce6', '#0b0f19', 70, 442);
    ctx.restore();

    // LEFT HALF (White & Chrome Clockwork Cyborg)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 256, s);
    ctx.clip();
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 256, s);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(36, 48, 220, 420);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 5;
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      ctx.moveTo(64 + k * 24, 390);
      ctx.lineTo(130 + k * 22, 476);
      ctx.stroke();
    }
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(198, 434, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(198, 434, 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(166, 186, 84, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    for (const r of [64, 44, 24]) {
      ctx.beginPath();
      ctx.arc(166, 186, r, 0, Math.PI * 2);
      ctx.lineWidth = r === 24 ? 10 : 5;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();
    }
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(166, 186, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(166, 186, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(86, 166);
    ctx.quadraticCurveTo(166, 134, 246, 166);
    ctx.moveTo(86, 206);
    ctx.quadraticCurveTo(166, 238, 246, 206);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(228, 282, 13, 0, Math.PI * 2);
    ctx.fill();

    drawWavyLips(368, '#f1f5f9', '#0f172a', 70, 442);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#0f172a';
    for (const sx of [136, 196]) {
      ctx.beginPath();
      ctx.moveTo(sx, 338);
      ctx.lineTo(sx, 404);
      ctx.stroke();
    }
    ctx.fillStyle = '#0f172a';
    for (const [rx, ry] of [
      [106, 356],
      [166, 354],
      [226, 356],
      [106, 386],
      [166, 388],
      [226, 386],
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 4;
    for (const ty of [78, 128, 260, 320]) {
      ctx.beginPath();
      ctx.moveTo(10, ty);
      ctx.lineTo(42, ty);
      ctx.lineTo(54, ty + 14);
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(54, ty + 14, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = '#0b0f19';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, s);
    ctx.stroke();
  } else {
    // 5. VOID SHADOW — 50/50 split dark obsidian teeth left + midnight stitched shadow right + glowing pale-white almond eyes
    ctx.fillStyle = '#2d3348';
    ctx.fillRect(0, 0, 256, s);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(180, 120);
    ctx.lineTo(0, 290);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#16132b';
    ctx.fillRect(256, 0, 256, s);

    ctx.strokeStyle = '#070610';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, s);
    ctx.stroke();

    for (const ex of [162, 350]) {
      ctx.save();
      ctx.shadowColor = '#c4b5fd';
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.moveTo(ex - 82, 186);
      ctx.quadraticCurveTo(ex, 134, ex + 82, 186);
      ctx.quadraticCurveTo(ex, 234, ex - 82, 186);
      ctx.closePath();
      ctx.fillStyle = '#f5f3ff';
      ctx.fill();
      ctx.restore();

      ctx.lineWidth = 9;
      ctx.strokeStyle = '#070610';
      ctx.stroke();

      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(ex - 76, 134);
      ctx.quadraticCurveTo(ex, 110, ex + 76, 134);
      ctx.stroke();
    }

    ctx.fillStyle = '#070610';
    ctx.beginPath();
    ctx.ellipse(234, 274, 11, 14, -0.18, 0, Math.PI * 2);
    ctx.ellipse(278, 274, 11, 14, 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 290, 256, 222);
    ctx.clip();
    ctx.fillStyle = '#3c4257';
    ctx.beginPath();
    ctx.roundRect(64, 326, 224, 96, 40);
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#070610';
    ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.roundRect(84, 344, 186, 58, 22);
    ctx.fill();
    ctx.stroke();

    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(84, 373);
    ctx.lineTo(256, 373);
    for (const tx of [126, 168, 212]) {
      ctx.moveTo(tx, 344);
      ctx.lineTo(tx, 402);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = '#4c466b';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(256, 376);
    ctx.quadraticCurveTo(340, 368, 418, 342);
    ctx.stroke();

    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      const sx = 276 + t * 136;
      const sy = 374 - t * 28;
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy - 22);
      ctx.lineTo(sx + 6, sy + 22);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  return configureColorTexture(tex, maxAniso) as THREE.CanvasTexture;
}

/**
 * Crisp white-and-chrome skeletal truss, circuit traces & exposed gear texture
 * for Half-Cyborg's mechanical right torso & armor plates.
 */
export function createCyborgBodyTexture(maxAniso: number): THREE.CanvasTexture {
  const s = 256;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, s, s);

  ctx.fillStyle = '#334155';
  const tris: [number, number, number, number, number, number][] = [
    [28, 36, 114, 36, 70, 118],
    [138, 36, 224, 36, 182, 118],
    [76, 140, 178, 140, 128, 224],
  ];
  for (const [x1, y1, x2, y2, x3, y3] of tris) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();
  }

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const y = 20 + i * 42;
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(248, y);
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(16 + (i % 2) * 224, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  return configureColorTexture(tex, maxAniso) as THREE.CanvasTexture;
}



