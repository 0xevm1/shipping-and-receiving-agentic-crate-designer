/* Crate rules: packing, construction, dunnage, cut list. Units: mm, kg. Frame: Z up, X = crate long axis. */
const Domain = (() => {
  const CW = 89, CT = 19, FLOOR = 19, MAX_CLEAT_SPACING = 600, MIN_BLOCKING_GAP = 19;
  const STABLE_HEIGHT_RATIO = 1.5, VOLUME_TOLERANCE = 0.03;
  const DENSITY = { plywood: 600, lumber: 480 }, RATE = { plywood: 1100, lumber: 650 };
  const DOOR = 2440, OVERSIZE_L = 3000;

  const ORIENTATIONS = [
    { id: 'as-modeled', label: 'As modeled', e: [0, 0, 0], upright: true },
    { id: 'turned', label: 'Turned 90°', e: [0, 0, 1], upright: true },
    { id: 'on-side-x', label: 'On its side', e: [1, 0, 0], upright: false },
    { id: 'on-side-x-turned', label: 'On its side, turned 90°', e: [1, 0, 1], upright: false },
    { id: 'on-end-y', label: 'On end', e: [0, 1, 0], upright: false },
    { id: 'on-end-y-turned', label: 'On end, turned 90°', e: [0, 1, 1], upright: false },
  ];
  const RX = [1, 0, 0, 0, 0, -1, 0, 1, 0], RY = [0, 0, 1, 0, 1, 0, -1, 0, 0], RZ = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul3 = (a, b) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]); return o; };
  /* row-major 3x3, XYZ Euler order: R = Rx · Ry · Rz */
  const rotation = (o) => mul3(mul3(o.e[0] ? RX : I3, o.e[1] ? RY : I3), o.e[2] ? RZ : I3);
  const rotatedSize = (s, o) => { const m = rotation(o); return [0, 1, 2].map(r => Math.abs(m[r * 3]) * s[0] + Math.abs(m[r * 3 + 1]) * s[1] + Math.abs(m[r * 3 + 2]) * s[2]); };

  function resolveConstruction(payloadKg, panelSetting) {
    const panelMm = panelSetting === 'auto' ? (payloadKg <= 150 ? 12 : payloadKg <= 500 ? 15 : 19) : +panelSetting;
    const skid = payloadKg <= 700 ? { wide: 89, tall: 89 } : { wide: 89, tall: 140 };
    return { panelMm, floorMm: FLOOR, skid, auto: panelSetting === 'auto' };
  }
  const structureAllowance = (c) => [2 * (c.panelMm + CT), 2 * (c.panelMm + CT), c.skid.tall + c.floorMm + c.panelMm + CT];

  function enumerateLayouts(partSize, n, opt) {
    const { keepUpright, maxLayers, g, c, s, allow } = opt;
    const out = [], seen = new Set();
    for (const o of ORIENTATIONS) {
      if (keepUpright && !o.upright) continue;
      const [a, b, h] = rotatedSize(partSize, o);
      for (let nz = 1; nz <= Math.min(maxLayers, n); nz++) {
        const perLayer = Math.ceil(n / nz);
        if (perLayer * (nz - 1) >= n) continue;
        for (let nx = 1; nx <= perLayer; nx++) {
          const ny = Math.ceil(perLayer / nx);
          if ((nx - 1) * ny >= perLayer) continue;
          const interior = [2 * c + nx * a + (nx - 1) * g, 2 * c + ny * b + (ny - 1) * g, 2 * c + nz * h + (nz - 1) * (g + s)];
          if (interior[0] < interior[1]) continue;
          const dk = interior.map(Math.round).join('x') + ':' + nx + '.' + ny + '.' + nz;
          if (seen.has(dk)) continue; seen.add(dk);
          const external = interior.map((v, i) => v + allow[i]);
          const slots = [];
          fill: for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            if (slots.length >= n) break fill;
            slots.push({ index: [i, j, k], min: [c + i * (a + g), c + j * (b + g), c + k * (h + g + s)] });
          }
          out.push({
            key: (o.upright ? 'u' : 's') + ':' + o.id + ':' + dk, orientation: o, cellSize: [a, b, h], counts: [nx, ny, nz],
            interior, external, externalVolumeM3: external[0] * external[1] * external[2] / 1e9,
            utilization: n * a * b * h / (interior[0] * interior[1] * interior[2]),
            stable: external[2] <= STABLE_HEIGHT_RATIO * Math.min(external[0], external[1]), slots,
          });
        }
      }
    }
    return out.sort(compareLayouts);
  }
  function compareLayouts(p, q) {
    if (p.stable !== q.stable) return p.stable ? -1 : 1;
    const va = p.externalVolumeM3, vb = q.externalVolumeM3;
    if (Math.abs(va - vb) / Math.min(va, vb) > VOLUME_TOLERANCE) return va - vb;
    if (p.external[2] !== q.external[2]) return p.external[2] - q.external[2];
    return va - vb;
  }

  const spread = (from, to, count) => count <= 1 ? [from] : Array.from({ length: count }, (_, i) => from + (to - from) * i / (count - 1));

  function designCrate(part, quantity, layout, cons, settings) {
    const [L, W, H] = layout.interior, t = cons.panelMm, ct = CT, cw = CW;
    const g = settings.partGapMm, c = settings.wallClearanceMm;
    const [a, b, h] = layout.cellSize, [nx, ny, nz] = layout.counts;
    const members = [];
    const add = (kind, material, asm, face, label, min, size) => members.push({ kind, material, asm, face, label, min, size });

    // Base
    const x0 = -t - ct, y0 = -t - ct, EL = L + 2 * (t + ct), EW = W + 2 * (t + ct);
    add('floor', 'plywood', 'base', 'base', 'Floor', [x0, y0, -cons.floorMm], [EL, EW, cons.floorMm]);
    const skidCount = Math.max(2, Math.ceil(EW / 800) + 1);
    for (const y of spread(y0, y0 + EW - cons.skid.wide, skidCount))
      add('skid', 'lumber', 'base', 'base', 'Skid', [x0, y, -cons.floorMm - cons.skid.tall], [EL, cons.skid.wide, cons.skid.tall]);

    // Walls
    const uprights = (len) => Math.ceil((len - cw) / MAX_CLEAT_SPACING) + 1;
    const vh = H - 2 * cw;
    for (const sgn of [-1, 1]) {
      const face = sgn < 0 ? 'side-' : 'side+';
      const py = sgn < 0 ? -t : W, cy = sgn < 0 ? -t - ct : W + t;
      add('side', 'plywood', 'sides', face, 'Side panel', [-t, py, 0], [L + 2 * t, t, H]);
      add('cleat', 'lumber', 'sides', face, 'Side rail', [-t, cy, 0], [L + 2 * t, ct, cw]);
      add('cleat', 'lumber', 'sides', face, 'Side rail', [-t, cy, H - cw], [L + 2 * t, ct, cw]);
      if (vh > 0) for (const x of spread(-t, L + t - cw, uprights(L + 2 * t)))
        add('cleat', 'lumber', 'sides', face, 'Side upright', [x, cy, cw], [cw, ct, vh]);
    }
    for (const sgn of [-1, 1]) {
      const face = sgn < 0 ? 'end-' : 'end+';
      const px = sgn < 0 ? -t : L, cx = sgn < 0 ? -t - ct : L + t;
      add('end', 'plywood', 'ends', face, 'End panel', [px, 0, 0], [t, W, H]);
      add('cleat', 'lumber', 'ends', face, 'End rail', [cx, y0, 0], [ct, EW, cw]);
      add('cleat', 'lumber', 'ends', face, 'End rail', [cx, y0, H - cw], [ct, EW, cw]);
      if (vh > 0) for (const y of spread(y0, y0 + EW - cw, uprights(EW)))
        add('cleat', 'lumber', 'ends', face, 'End upright', [cx, y, cw], [ct, cw, vh]);
    }

    // Lid
    add('lid', 'plywood', 'lid', 'lid', 'Lid panel', [-t, -t, H], [L + 2 * t, W + 2 * t, t]);
    add('lid-cleat', 'lumber', 'lid', 'lid', 'Lid edge cleat', [-t, -t, H + t], [L + 2 * t, cw, ct]);
    add('lid-cleat', 'lumber', 'lid', 'lid', 'Lid edge cleat', [-t, W + t - cw, H + t], [L + 2 * t, cw, ct]);
    const crossLen = W + 2 * t - 2 * cw;
    if (crossLen > 0) for (const x of spread(-t, L + t - cw, uprights(L + 2 * t)))
      add('lid-cleat', 'lumber', 'lid', 'lid', 'Lid cross cleat', [x, -t + cw, H + t], [cw, crossLen, ct]);

    // Dunnage
    for (let k = 1; k < nz; k++)
      add('separator', 'plywood', 'inside', 'inside', 'Layer separator', [0, 0, c + k * (h + g + t) - t], [L, W, t]);
    const posts = new Map();
    for (const sl of layout.slots) {
      const [i, j, k] = sl.index, [mx, my, mz] = sl.min;
      if (k === 0 && c > 0) {
        const bw = Math.min(cw, b * 0.35);
        for (const f of [0.2, 0.8]) add('bearer', 'lumber', 'inside', 'inside', 'Bearer', [mx, my + b * f - bw / 2, 0], [a, bw, c]);
      }
      const zb = k === 0 ? 0 : mz, zt = k < nz - 1 ? mz + h + g : mz + h;
      const wx = Math.min(cw, b), wy = Math.min(cw, a);
      const cand = [
        [[mx - (i > 0 ? g : c), my + b / 2 - wx / 2, zb], [i > 0 ? g : c, wx, zt - zb]],
        [[mx + a, my + b / 2 - wx / 2, zb], [i < nx - 1 ? g : c, wx, zt - zb]],
        [[mx + a / 2 - wy / 2, my - (j > 0 ? g : c), zb], [wy, j > 0 ? g : c, zt - zb]],
        [[mx + a / 2 - wy / 2, my + b, zb], [wy, j < ny - 1 ? g : c, zt - zb]],
      ];
      cand.forEach(([min, size], idx) => {
        const thick = idx < 2 ? size[0] : size[1];
        if (thick < MIN_BLOCKING_GAP) return;
        const key = min.concat(size).map(Math.round).join(',');
        if (!posts.has(key)) posts.set(key, [min, size]);
      });
    }
    for (const [min, size] of posts.values()) add('blocking', 'lumber', 'inside', 'inside', 'Blocking post', min, size);

    // Totals
    let tareKg = 0, cost = 0, plywoodM2 = 0, lumberM = 0, screws = 0;
    const bomMap = new Map();
    for (const m of members) {
      const vol = m.size[0] * m.size[1] * m.size[2] / 1e9;
      tareKg += vol * DENSITY[m.material]; cost += vol * RATE[m.material];
      const d = m.size.map(Math.round).sort((p, q) => q - p);
      let stock, cut;
      if (m.material === 'plywood') { plywoodM2 += d[0] * d[1] / 1e6; stock = d[2] + ' mm plywood'; cut = [d[0], d[1]]; m.thick = d[2]; }
      else { lumberM += d[0] / 1000; stock = d[2] + ' × ' + d[1] + ' lumber'; cut = [d[0]]; m.section = [d[2], d[1]]; }
      if (m.kind === 'cleat' || m.kind === 'lid-cleat') screws += Math.ceil(d[0] / 150) + 1;
      else if (m.kind === 'skid') screws += Math.ceil(d[0] / 300) + 1;
      else if (m.kind === 'bearer' || m.kind === 'blocking') screws += 2;
      m.bomKey = [m.asm, m.label, stock, cut.join('x')].join('|');
      const row = bomMap.get(m.bomKey);
      if (row) row.qty++; else bomMap.set(m.bomKey, { key: m.bomKey, asm: m.asm, label: m.label, material: m.material, stock, cut, qty: 1, thick: m.thick, section: m.section });
    }
    screws += 2 * Math.ceil(2 * (L + W) / 200) + 4 * Math.ceil(H / 200);
    const payloadKg = part.mass_kg * quantity, grossKg = payloadKg + tareKg;
    const ext = layout.external, minGap = Math.min(g, c);
    const stackKg = part.mass_kg * (nz - 1);

    const checks = [
      ext[1] > DOOR || ext[2] > DOOR
        ? { level: 'caution', title: 'Too big for a standard trailer door', detail: `Width or height is over ${DOOR} mm. Confirm door clearance with the carrier.` }
        : { level: 'ok', title: 'Fits a standard trailer door', detail: `Width and height are under ${DOOR} mm.` },
      layout.stable
        ? { level: 'ok', title: 'Stable footprint', detail: `Height is ${(ext[2] / Math.min(ext[0], ext[1])).toFixed(2)}× the short side. The limit is ${STABLE_HEIGHT_RATIO}×.` }
        : { level: 'caution', title: 'Tip-over risk', detail: `Height is ${(ext[2] / Math.min(ext[0], ext[1])).toFixed(2)}× the short side, over the ${STABLE_HEIGHT_RATIO}× limit. Strap it down or pick a lower layout.` },
      minGap < MIN_BLOCKING_GAP
        ? { level: 'caution', title: 'Parts are not restrained', detail: `Gaps under ${MIN_BLOCKING_GAP} mm leave no room for blocking. Widen the gap or the wall clearance.` }
        : { level: 'ok', title: 'Every part is blocked in', detail: `${posts.size} blocking posts hold the parts on all four sides.` },
      stackKg > 100
        ? { level: 'caution', title: 'Heavy stack on the bottom layer', detail: `Each bottom position carries ${Math.round(stackKg)} kg from above. Consider fewer layers.` }
        : nz > 1 ? { level: 'ok', title: 'Stack load is light', detail: `Each bottom position carries ${Math.round(stackKg)} kg from above. The limit is 100 kg.` } : null,
      grossKg > 1000
        ? { level: 'caution', title: 'Over 1,000 kg gross', detail: 'Needs heavier skids and floor joists than this design includes.' }
        : { level: 'ok', title: 'Within the standard base rating', detail: `Gross weight is under 1,000 kg, so ${cons.skid.tall === 89 ? '4×4' : '4×6'} skids and a 19 mm floor are enough.` },
      ext[0] > OVERSIZE_L ? { level: 'info', title: 'Oversize freight', detail: `Length is over ${OVERSIZE_L} mm. Expect an oversize surcharge.` } : null,
      layout.utilization < 0.25 ? { level: 'info', title: 'Mostly empty space', detail: 'Parts are packed by their bounding box, so irregular shapes leave air. A nested layout could be smaller.' } : null,
      { level: 'info', title: 'Export shipments', detail: 'Use ISPM-15 heat-treated, stamped lumber.' },
    ].filter(Boolean);

    return {
      layout, construction: { ...cons, skidCount }, members, bom: [...bomMap.values()],
      payloadKg, tareKg, grossKg, plywoodM2, lumberM, screws, materialCostUsd: cost, checks, postCount: posts.size,
    };
  }

  function computeDesign(part, settings, layoutKey) {
    const payload = part.mass_kg * settings.quantity;
    const cons = resolveConstruction(payload, settings.panelThickness);
    const layouts = enumerateLayouts(part.dimensions_mm, settings.quantity, {
      keepUpright: settings.keepUpright, maxLayers: settings.maxLayers, g: settings.partGapMm, c: settings.wallClearanceMm,
      s: cons.panelMm, allow: structureAllowance(cons),
    });
    const layout = layouts.find(l => l.key === layoutKey) || layouts[0];
    return { layouts, design: designCrate(part, settings.quantity, layout, cons, settings), isBest: layout === layouts[0] };
  }

  return { ORIENTATIONS, rotation, rotatedSize, computeDesign, enumerateLayouts, CW, CT };
})();
if (typeof module !== 'undefined') module.exports = Domain;
