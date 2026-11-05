"""Encode sampled CFD fields for WebGL. Publishing is a separate explicit step."""
import argparse, gzip, hashlib, json, pathlib, re, struct
from foam_io import ROOT, np, latest, field_values
from scipy import ndimage
parser=argparse.ArgumentParser();parser.add_argument('case');parser.add_argument('output')
args=parser.parse_args();case=pathlib.Path(args.case);out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
log=(case/'log.solve').read_text(errors='replace')
assert re.search(r'\nEnd\s*\n',log) and 'ended prematurely' not in log, 'Refusing to export an incomplete or failed solve'
assert float(latest(case).name)>0, 'Refusing to export the initial state'
transport=json.loads((case/'transport.json').read_text())
volume_smoke=field_values(latest(case)/'smoke')
inlet_text=(case/'0/smoke').read_text()
inlet_match=re.search(r'\binlet\s*\{.*?value\s+nonuniform\s+List<scalar>\s+\d+\s*\((.*?)\)',inlet_text,re.S)
assert inlet_match, 'Missing inlet concentration boundary'
inlet_max=float(np.fromstring(inlet_match[1],sep=' ').max())
assert np.isfinite(volume_smoke).all() and volume_smoke.min()>-1e-7 and volume_smoke.max()<=inlet_max*1.001, 'Volume concentration exceeds the inlet bound'
residuals={}
for name,value in re.findall(r'Solving for (smoke|age|inletY|inletZ), Initial residual = ([\deE+.-]+)',log): residuals[name]=float(value)
assert len(residuals)==4 and max(residuals.values())<1e-6, 'Transport fields are not converged'
sample_dir=latest(case/'postProcessing/sampled')
csv=next(sample_dir.glob('volume_*.csv'))
with csv.open() as f: names=f.readline().strip().split(',')
values=np.loadtxt(csv,delimiter=',',skiprows=1)
col={name:values[:,i] for i,name in enumerate(names)}
shape=np.array([256,96,128]);low=np.array([-5.4,-.08,-2.5]);high=np.array([4.7,2.55,2.5]);step=(high-low)/shape
indices=np.rint((values[:,:3]-low)/step-.5).astype(int)
assert np.all(indices>=0) and np.all(indices<shape)
flat=indices[:,0]+shape[0]*(indices[:,1]+shape[1]*indices[:,2]);count=int(np.prod(shape));grid_shape=tuple(shape[::-1])
assert len(np.unique(flat))==len(flat)
valid=np.zeros(count,dtype=bool);valid[flat]=True
solid=(~valid).reshape(grid_shape)
# The floor controls the flow, but is not a smoke-darkening surface.
y=low[1]+(np.arange(shape[1])+.5)*step[1]
solid[:,y<0,:]=False
distance=ndimage.distance_transform_edt(~solid,sampling=step[::-1]).ravel()-.5*min(step)
distance[solid.ravel()]=-.5*min(step)
distance=np.clip(distance,-.08,1.2)
reference=120/3.6
flow=np.zeros((count,4),dtype=np.float32)
flow[flat,0]=np.maximum(0,col['age']*reference-(12-high[0]))
flow[flat,1]=col['inletY'];flow[flat,2]=col['inletZ'];flow[:,3]=distance
if 'inletZEncoding' in transport:
    flow[flat,2]=flow[flat,2]*transport['inletZEncoding']['scale']+transport['inletZEncoding']['bias']
# Extrapolate only the animated coordinates across solid texels. Density is zero
# inside; interpolation then follows the exterior field without artificial seams.
nearest=ndimage.distance_transform_edt(~valid.reshape(grid_shape),return_distances=False,return_indices=True)
nearest_flat=nearest[2]+shape[0]*(nearest[1]+shape[1]*nearest[0])
flow[~valid,:3]=flow[nearest_flat.ravel()[~valid],:3]
concentration=col['smoke']
assert np.isfinite(values).all()
assert concentration.min()>-1e-5 and concentration.max()<1.001, 'Smoke must remain bounded without body sources'
assert concentration.max()>.2 and np.percentile(flow[flat,0],50)>1, 'No transported inlet smoke detected'
medium=np.zeros((count,2),dtype=np.uint8)
medium[flat,0]=np.rint(np.clip(concentration,0,1)*255).astype(np.uint8)
intensity=np.sqrt(np.maximum(0,2*col['k']/3))/reference
medium[flat,1]=np.rint(np.clip(intensity/.3,0,1)*255).astype(np.uint8)
header=bytearray(64)
struct.pack_into('<5I',header,0,0x57464c57,3,*shape)
struct.pack_into('<6f',header,20,*low,*high)
struct.pack_into('<3f2I',header,44,1,-.08,1.28,2,5)
# Half-float age preserves smooth motion and long residence times. The other
# channels retain the previous centimetre/millimetre visual precision on wire.
# The browser expands these five bytes to RGBA16F once, at load time.
encoded=np.zeros((count,5),dtype=np.uint8)
encoded[:,:2]=np.clip(flow[:,0],0,65504).astype('<f2').view(np.uint8).reshape(-1,2)
for channel,bias,scale in [(1,low[1],high[1]-low[1]),(2,low[2],high[2]-low[2]),(3,-.08,1.28)]:
    encoded[:,channel+1]=np.rint(np.clip((flow[:,channel]-bias)/scale,0,1)*255).astype(np.uint8)
binary=header+encoded.tobytes()+medium.tobytes()
(out/'vision-gt.bin').write_bytes(binary)
(out/'vision-gt.bin.gz').write_bytes(gzip.compress(binary,compresslevel=9,mtime=0))
audit={'formatVersion':3,'method':'OpenFOAM kOmegaSST mean flow and conservative passive scalar transport',
       'referenceKmh':120,'otherSpeeds':'Advection-time scaling of the 120 km/h field, not independent CFD solutions',
       'shape':shape.tolist(),'min':low.tolist(),'max':high.tolist(),'step':step.tolist(),
       'channels':['mean age in freestream metres','inlet Y','inlet Z','body signed distance','smoke concentration','relative turbulence intensity / 0.3'],
       'sourceSha256':hashlib.sha256((ROOT/'public/models/vision-gt.glb').read_bytes()).hexdigest(),
       'geometryProxySha256':json.loads((ROOT/'.artifacts/cfd/geometry/proxy-audit.json').read_text())['sha256'],
       'velocitySha256':hashlib.sha256((case/'0/U').read_bytes()).hexdigest(),
       'faceFluxSha256':hashlib.sha256((case/'0/phi').read_bytes()).hexdigest(),
       'fieldSha256':hashlib.sha256(binary).hexdigest(),'bytes':len(binary),'gzipBytes':(out/'vision-gt.bin.gz').stat().st_size,
       'sampledFluidCells':int(valid.sum()),'concentrationRange':[float(concentration.min()),float(concentration.max())],
       'volumeConcentrationRange':[float(volume_smoke.min()),float(volume_smoke.max())],'inletMaxConcentration':inlet_max,
       'transportResiduals':residuals,
       'timeOfFlightMetresPercentiles':np.percentile(flow[flat,0],[50,95,99]).tolist(),
       'smokeSource':'Inlet only; no surface/contact/duct concentration multiplier',
       'geometry':'20 mm watertight display-mesh proxy with explicit cabin closure; unresolved slits excluded',
       'dragPredictionValidated':False,'animation':'Mean CFD concentration; procedural sub-grid texture and waves are illustrative'}
(out/'audit.json').write_text(json.dumps(audit,indent=2)+'\n')
np.savez_compressed(out/'sampled-fields.npz',indices=flat,velocity=values[:,[names.index('U_0'),names.index('U_1'),names.index('U_2')]].astype('f4'),
                    pressure=col['p'].astype('f4'),intensity=intensity.astype('f4'),smoke=concentration.astype('f4'),age=col['age'].astype('f4'))
print(json.dumps(audit),flush=True)
