"""Create a connected, watertight CFD proxy from the audited display surfaces.

Only exterior-connected voids survive; no generic filling of the vehicle hull.
The voxel pitch and the cabin closure are explicit modelling approximations.
"""
import argparse, hashlib, json, pathlib, sys, time
ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / '.artifacts/cfd-python'))
import numpy as np
import trimesh
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage.measure import marching_cubes

parser = argparse.ArgumentParser()
parser.add_argument('--pitch', type=float, default=.02)
args = parser.parse_args()
start = time.time()
folder = ROOT / '.artifacts/cfd/geometry'
pitch = args.pitch
low = np.array([-3., -.06, -1.5])
shape = np.ceil((np.array([3., 1.4, 1.5]) - low) / pitch).astype(int) + 1
surface = np.zeros(shape, dtype=bool)
vertices, labels = [], []
names = ['body', 'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']
for label, name in enumerate(names):
    mesh = trimesh.load(folder / (name + '.stl'), process=True)
    cloud = mesh.voxelized(pitch, method='subdivide').points
    index = np.rint((cloud - low) / pitch).astype(int)
    surface[tuple(index.T)] = True
    vertices.append(mesh.vertices)
    labels.append(np.full(len(mesh.vertices), label, dtype=np.int8))
    print(json.dumps({'part': name, 'surfaceVoxels': len(cloud)}), flush=True)
solid = ndimage.binary_fill_holes(surface)
# A half-cell isosurface rounds voxel corners without a morphological closing
# that would silently bridge open aerodynamic passages.
distance = ndimage.distance_transform_edt(~solid) - ndimage.distance_transform_edt(solid)
v, f, _, _ = marching_cubes(distance.astype('f4'), 0, spacing=(pitch,) * 3)
v += low
proxy = trimesh.Trimesh(v, f, process=True)
proxy.fix_normals()
tree = cKDTree(np.concatenate(vertices))
surface_labels = np.concatenate(labels)[tree.query(proxy.triangles_center, workers=-1)[1]]
lines = []
for label, name in enumerate(names):
    lines.append('solid ' + name)
    for tri, normal in zip(proxy.triangles[surface_labels == label], proxy.face_normals[surface_labels == label]):
        lines.append(' facet normal ' + ' '.join(f'{x:.8g}' for x in normal))
        lines.append('  outer loop')
        lines.extend('   vertex ' + ' '.join(f'{x:.8g}' for x in p) for p in tri)
        lines.extend(['  endloop', ' endfacet'])
    lines.append('endsolid ' + name)
target = folder / 'car.stl'
target.write_text('\n'.join(lines) + '\n')
np.savez_compressed(folder / 'proxy.npz', solid=solid, low=low, pitch=pitch)
report = {'pitchMetres': pitch, 'shape': shape.tolist(), 'watertight': bool(proxy.is_watertight),
          'windingConsistent': bool(proxy.is_winding_consistent), 'volume': float(proxy.volume),
          'faces': len(proxy.faces), 'surfaceVoxels': int(surface.sum()), 'solidVoxels': int(solid.sum()),
          'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'seconds': time.time()-start,
          'limitations': ['Display mesh, not engineering CAD', 'Open cabin closed by glazing/upholstery convex envelope',
                         'Features near or below the voxel pitch are unresolved', 'No boundary-layer surface detail or tire deformation']}
(folder / 'proxy-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report), flush=True)
assert proxy.is_watertight and proxy.volume > 0
