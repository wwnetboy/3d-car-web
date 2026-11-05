"""Trace visual material coordinates through the accepted frozen CFD velocity.

This does not re-solve or change the conservative concentration. Traced inlet
labels retain material detail that the diffusive mean-coordinate solve removes.
Closed/slow trajectories retain the mean coordinates instead of forcing a path.
Uses the host NumPy/Numba environment; no CFD runtime is needed.
"""
import argparse, gzip, hashlib, json, pathlib, struct, sys, time
ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'.artifacts/trace-python'))
import numpy as np
from numba import njit, prange
from scipy import ndimage

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=pathlib.Path, default=ROOT/'.artifacts/cfd/accepted')
parser.add_argument('--output', type=pathlib.Path, default=ROOT/'.artifacts/cfd/traced')
parser.add_argument('--step', type=float, default=.032)
args = parser.parse_args()
assert .008 <= args.step <= .05
TRACE_STEP = args.step
MAX_STEPS = int(51.2/TRACE_STEP)
args.output.mkdir(parents=True, exist_ok=True)
binary = (args.source/'vision-gt.bin').read_bytes()
assert struct.unpack_from('<I', binary, 4)[0] == 3
shape = np.array(struct.unpack_from('<3I', binary, 8))
low = np.array(struct.unpack_from('<3f', binary, 20), dtype=np.float64)
high = np.array(struct.unpack_from('<3f', binary, 32), dtype=np.float64)
step = (high-low)/shape
count = int(np.prod(shape))
packed = np.frombuffer(binary, dtype=np.uint8, count=count*5, offset=64).reshape(-1,5)
mean = np.empty((count,4), dtype=np.float32)
mean[:,0] = packed[:,:2].copy().view('<f2').ravel()
mean[:,1] = low[1]+packed[:,2]/255*(high[1]-low[1])
mean[:,2] = low[2]+packed[:,3]/255*(high[2]-low[2])
mean[:,3] = -.08+packed[:,4]/255*1.28
sample = np.load(args.source/'sampled-fields.npz')
velocity = np.zeros((count,3), dtype=np.float32)
velocity[sample['indices']] = sample['velocity']/(120/3.6)
velocity = velocity.reshape((*shape[::-1],3))
distance = mean[:,3].reshape(tuple(shape[::-1]))

@njit(inline='always')
def sample3(grid,x,y,z):
    xx=(x-low[0])/step[0]-.5; yy=(y-low[1])/step[1]-.5; zz=(z-low[2])/step[2]-.5
    ix=max(0,min(int(xx),shape[0]-2)); iy=max(0,min(int(yy),shape[1]-2)); iz=max(0,min(int(zz),shape[2]-2))
    fx=max(0.,min(1.,xx-ix)); fy=max(0.,min(1.,yy-iy)); fz=max(0.,min(1.,zz-iz))
    a=np.zeros(3,np.float64)
    for dz in range(2):
        for dy in range(2):
            for dx in range(2):
                w=(fx if dx else 1-fx)*(fy if dy else 1-fy)*(fz if dz else 1-fz)
                for c in range(3): a[c]+=grid[iz+dz,iy+dy,ix+dx,c]*w
    return a

@njit(parallel=True)
def trace(grid, original):
    output=original.copy(); status=np.zeros(count,np.uint8)
    inlet=high[0]-step[0]*.6
    for i in prange(count):
        if original[i,3]<.003: continue
        ix=i%shape[0]; iy=(i//shape[0])%shape[1]; iz=i//(shape[0]*shape[1])
        x=low[0]+(ix+.5)*step[0]; y=low[1]+(iy+.5)*step[1]; z=low[2]+(iz+.5)*step[2]
        age=0.; reached=False
        for k in range(MAX_STEPS):
            if x>=inlet:
                reached=True; break
            if y<.015 or y>high[1]-.03 or abs(z)>high[2]-.03:
                # Flow enters the cropped visualization through a lateral face.
                # Continue the upstream material coordinates in the free stream.
                age+=max(0.,inlet-x); x=inlet; reached=True; break
            v=sample3(grid,x,y,z)
            speed=np.sqrt(v[0]**2+v[1]**2+v[2]**2)
            if speed<.002 or age>45.: break
            dt=min(.075,TRACE_STEP/speed)
            m=sample3(grid,x-v[0]*dt*.5,y-v[1]*dt*.5,z-v[2]*dt*.5)
            nx=x-m[0]*dt; ny=y-m[1]*dt; nz=z-m[2]*dt
            # Zero solid-cell velocities stop wall-crossing trajectories. Do not
            # invent a tangential direction or clamp downstream velocity.
            cx=max(0,min(shape[0]-1,int((nx-low[0])/step[0])))
            cy=max(0,min(shape[1]-1,int((ny-low[1])/step[1])))
            cz=max(0,min(shape[2]-1,int((nz-low[2])/step[2])))
            if distance[cz,cy,cx]<0: break
            x=nx; y=ny; z=nz; age+=dt
        if reached:
            output[i,0]=max(0.,age+(high[0]-x))
            output[i,1]=y; output[i,2]=z; status[i]=1
    return output,status

start=time.monotonic()
flow,status=trace(velocity,mean)
solid=distance<.003
nearest=ndimage.distance_transform_edt(solid,return_distances=False,return_indices=True)
nearest_flat=nearest[2]+shape[0]*(nearest[1]+shape[1]*nearest[0])
flow[solid.ravel(),:3]=flow[nearest_flat.ravel()[solid.ravel()],:3]
assert np.isfinite(flow).all() and flow[:,0].min()>=0
header=bytearray(binary[:64])
struct.pack_into('<I',header,4,4)
struct.pack_into('<I',header,60,8)
# Native RGBA16F avoids 1–2 cm inlet-label quantization visible as striations.
payload=header+flow.astype('<f2').tobytes()+binary[64+count*5:]
(args.output/'vision-gt.bin').write_bytes(payload)
(args.output/'vision-gt.bin.gz').write_bytes(gzip.compress(payload,compresslevel=9,mtime=0))
audit=json.loads((args.source/'audit.json').read_text())
audit.update(formatVersion=4,fieldSha256=hashlib.sha256(payload).hexdigest(),bytes=len(payload),
             gzipBytes=(args.output/'vision-gt.bin.gz').stat().st_size,
             timeOfFlightMetresPercentiles=np.percentile(flow[sample['indices'],0],[50,95,99]).tolist(),
             channels=['traced travel time in freestream metres','traced inlet Y','traced inlet Z','body signed distance','smoke concentration','relative turbulence intensity / 0.3'],
             visualCoordinates={'method':'RK2 upstream tracing in the frozen CFD velocity; diffusive mean fallback for closed/slow paths',
                                'tracedFluidVoxels':int(status.sum()),'stepMetres':TRACE_STEP,'maxFreestreamMetres':45.,
                                'concentrationUnchanged':True,'sourceFieldSha256':hashlib.sha256(binary).hexdigest()})
(args.output/'audit.json').write_text(json.dumps(audit,indent=2)+'\n')
np.savez_compressed(args.output/'trace-audit.npz',status=status,coordinates=flow)
print(json.dumps({'seconds':time.monotonic()-start,'traced':int(status.sum()),'fluid':int((mean[:,3]>=.003).sum()),'bytes':len(payload)}),flush=True)
