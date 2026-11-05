"""Export checked local-URANS scalar frames to a candidate playback volume."""
import argparse, gzip, hashlib, json, pathlib, struct
from foam_io import ROOT, np
parser = argparse.ArgumentParser()
parser.add_argument('case'); parser.add_argument('output')
parser.add_argument('--start', type=float, default=.8)
args = parser.parse_args()
case = (ROOT/args.case).resolve(); output = (ROOT/args.output).resolve()
assert output.is_relative_to(ROOT/'.artifacts'), 'Export a candidate first; publishing is separate'
recording = json.loads((case/'recording.json').read_text())
audit = json.loads((case/'transient-audit.json').read_text())
domain = json.loads((case/'wake-domain.json').read_text())
time_step = json.loads((case/'time-step-check.json').read_text())
assert all(time_step['checks'].values()), 'A passed time-step comparison is required'
assert all(audit['checks'].values())
# OpenFOAM's run loop can finish within half a final step of endTime.
assert audit['duration'] + .5*audit['timeStepRange'][1] >= recording['end']-1e-7
assert '\nEnd\n' in (case/'log.solve-record').read_text(errors='replace')
shape = np.array(recording['shape']); low=np.array(recording['min']); high=np.array(recording['max'])
step=(high-low)/shape; count=int(np.prod(shape))
folders = sorted([p for p in (case/'postProcessing/wakeFrames').iterdir() if p.is_dir() and float(p.name)>=args.start-1e-6],key=lambda p:float(p.name))
assert len(folders)>=20, 'Too few recorded samples for playback'
frames=[]; times=[]; previous_indices=None; ranges=[]
for folder in folders:
    path=next(folder.glob('volume_*.csv'))
    with path.open() as f: names=f.readline().strip().split(',')
    data=np.loadtxt(path,delimiter=',',skiprows=1)
    xyz=np.rint((data[:,:3]-low)/step-.5).astype(int)
    assert np.all(xyz>=0) and np.all(xyz<shape)
    indices=xyz[:,0]+shape[0]*(xyz[:,1]+shape[1]*xyz[:,2])
    assert len(np.unique(indices))==len(indices)
    if previous_indices is not None: assert np.array_equal(indices,previous_indices)
    previous_indices=indices
    values=data[:,names.index('smoke')]
    assert np.isfinite(values).all() and values.min()>=0 and values.max()<=1, 'Reject unbounded frames without clipping'
    frame=np.zeros(count,dtype='<f2');frame[indices]=values
    frames.append(frame); times.append(float(folder.name)); ranges.append([float(values.min()),float(values.max())])
absolute_times=np.array(times); times=(absolute_times-absolute_times[0]).astype('<f4')
assert np.all(np.diff(times)>0) and times[-1]>.35
sampled=np.stack(frames).astype(np.float32)[:,previous_indices]
centres=data[:,:3]
centroids=(sampled@centres)/sampled.sum(axis=1,keepdims=True)
variation={'sampleMeanRange':[float(sampled.mean(axis=1).min()),float(sampled.mean(axis=1).max())],
           'temporalConcentrationRms':float(np.sqrt(np.mean(np.var(sampled,axis=0)))),
           'centroidSpanMetres':np.ptp(centroids,axis=0).tolist(),
           'note':'Short-record variation includes residual settling; not a measured vortex amplitude or a shedding-frequency prediction'}
overlap=min(.16,float(times[-1])*.2)
header=bytearray(64)
struct.pack_into('<6I',header,0,0x4b415757,1,*shape,len(frames))
struct.pack_into('<8f2I',header,24,*low,*high,120,overlap,1,2)
binary=header+times.tobytes()+b''.join(f.tobytes() for f in frames)
output.mkdir(parents=True,exist_ok=True)
(output/'wake.bin').write_bytes(binary)
compressed=gzip.compress(binary,compresslevel=9,mtime=0)
(output/'wake.bin.gz').write_bytes(compressed)
report={'formatVersion':1,'method':'Sampled transient local-URANS passive-smoke concentration',
        'shape':shape.tolist(),'min':low.tolist(),'max':high.tolist(),'frames':len(frames),
        'sampleTimes':absolute_times.tolist(),'frameRanges':ranges,'referenceKmh':120,
        'loopOverlapSeconds':overlap,'loopNote':'Adjacent-frame interpolation; a bounded crossfade joins non-periodic recording ends',
        'sourceVelocitySha256':domain['precursorVelocitySha256'],
        'sourceModelSha256':json.loads((ROOT/'public/flow/audit.json').read_text())['sourceSha256'],
        'fieldSha256':hashlib.sha256(binary).hexdigest(),'bytes':len(binary),'gzipBytes':len(compressed),
        'scope':domain['scope'],'numericalChecks':audit['checks'],'engineeringValidated':False,
        'recordVariation':variation,'initialAndInletConcentrationRange':audit['initialAndInletConcentrationRange'],
        'volumeConcentrationRange':audit['volumeConcentrationRange'],'turbulenceBoundingEvents':audit['turbulenceBoundingEvents'],
        'timeStepCheck':time_step,'restart':json.loads((case/'restart.json').read_text()),
        'boundaryProfile':domain['cuts'],'case':str(case.relative_to(ROOT)),
        'timeStepRange':audit['timeStepRange'],'maxCourant':audit['maxCourant'],
        'maxRelativeBoundaryFluxImbalance':audit['maxRelativeBoundaryFluxImbalance']}
(output/'wake-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['frameRanges','sampleTimes']}))
