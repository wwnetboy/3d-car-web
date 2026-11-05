// Offline MAC pressure projection, initialized on a coarser grid to avoid
// spending fine-grid iterations removing long-wavelength pressure error.
export function projectFlow(shape, step, solid, level = 0) {
  const [nx, ny, nz] = shape, plane = nx * ny, count = solid.length;
  const strides = [1, nx, plane], weights = step.map(h => 1 / (h * h));
  const pressure = new Float32Array(count), rhs = new Float32Array(count);
  const diagonal = new Float32Array(count), lists = [[], []];
  const index = (x, y, z) => x + nx * y + plane * z;
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const i = index(x, y, z);
    if (solid[i]) continue;
    rhs[i] = ((solid[i + 1] ? 0 : -1) - (solid[i - 1] ? 0 : -1)) / step[0];
    diagonal[i] = (!solid[i - 1] + !solid[i + 1]) * weights[0]
      + (!solid[i - nx] + !solid[i + nx]) * weights[1]
      + (!solid[i - plane] + !solid[i + plane]) * weights[2];
    if (diagonal[i]) lists[(x + y + z) & 1].push(i);
  }
  const parity = lists.map(list => Int32Array.from(list));
  if (nx > 128 && shape.every(n => n % 2 === 0)) {
    const half = shape.map(n => n / 2), [hx, hy, hz] = half, hp = hx * hy;
    const coarseSolid = new Uint8Array(hp * hz);
    for (let z = 0; z < hz; z++) for (let y = 0; y < hy; y++) for (let x = 0; x < hx; x++) {
      let n = 0;
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
        n += solid[index(x * 2 + dx, y * 2 + dy, z * 2 + dz)];
      coarseSolid[x + hx * y + hp * z] = Number(n >= 4);
    }
    const coarse = projectFlow(half, step.map(h => h * 2), coarseSolid, level + 1);
    for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
      const i = index(x, y, z);
      if (solid[i]) continue;
      const p = [x, y, z].map(v => v * .5 - .25), base = p.map(Math.floor);
      let sum = 0, weight = 0;
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const j = base[0] + dx + hx * (base[1] + dy) + hp * (base[2] + dz);
        if (coarseSolid[j]) continue;
        const w = (dx ? p[0] - base[0] : 1 - p[0] + base[0])
          * (dy ? p[1] - base[1] : 1 - p[1] + base[1])
          * (dz ? p[2] - base[2] : 1 - p[2] + base[2]);
        sum += w * coarse.pressure[j]; weight += w;
      }
      if (weight) pressure[i] = sum / weight;
    }
  }
  let initialSquared = 0;
  for (const list of parity) for (const i of list) initialSquared += rhs[i] * rhs[i];
  let iterations = 0, residualRatio = Infinity, correction = 0;
  for (; iterations < 3600; iterations++) {
    correction = 0;
    for (const list of parity) for (let c = 0; c < list.length; c++) {
      const i = list[c];
      let sum = 0;
      if (!solid[i - 1]) sum += pressure[i - 1] * weights[0];
      if (!solid[i + 1]) sum += pressure[i + 1] * weights[0];
      if (!solid[i - nx]) sum += pressure[i - nx] * weights[1];
      if (!solid[i + nx]) sum += pressure[i + nx] * weights[1];
      if (!solid[i - plane]) sum += pressure[i - plane] * weights[2];
      if (!solid[i + plane]) sum += pressure[i + plane] * weights[2];
      const delta = 1.84 * ((sum - rhs[i]) / diagonal[i] - pressure[i]);
      pressure[i] += delta;
      correction = Math.max(correction, Math.abs(delta));
    }
    if ((iterations + 1) % 300 === 0) {
      let errorSquared = 0;
      for (const list of parity) for (const i of list) {
        let laplacian = -diagonal[i] * pressure[i];
        for (let a = 0; a < 3; a++) {
          if (!solid[i - strides[a]]) laplacian += pressure[i - strides[a]] * weights[a];
          if (!solid[i + strides[a]]) laplacian += pressure[i + strides[a]] * weights[a];
        }
        errorSquared += (laplacian - rhs[i]) ** 2;
      }
      residualRatio = Math.sqrt(errorSquared / initialSquared);
      console.log(JSON.stringify({ phase: 'pressure', level, iterations: iterations + 1, residualRatio }));
      if (residualRatio < (level ? .0015 : .003)) { iterations++; break; }
    }
  }
  const faces = step.map(() => new Float32Array(count));
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = index(x, y, z);
    if (solid[i]) continue;
    for (let a = 0; a < 3; a++) {
      if ([x, y, z][a] === shape[a] - 1) { faces[a][i] = a ? 0 : -1; continue; }
      const next = i + strides[a];
      if (!solid[next]) faces[a][i] = (a ? 0 : -1) - (pressure[next] - pressure[i]) / step[a];
    }
  }
  let maxSpeed = 0;
  const velocity = step.map(() => new Float32Array(count));
  for (const list of parity) for (const i of list) {
    for (let a = 0; a < 3; a++) velocity[a][i] = .5 * (faces[a][i] + faces[a][i - strides[a]]);
    maxSpeed = Math.max(maxSpeed, Math.hypot(velocity[0][i], velocity[1][i], velocity[2][i]));
  }
  return { pressure, velocity, iterations, correction, residualRatio, maxSpeed };
}
