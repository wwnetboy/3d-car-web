"""Restart passive smoke on a checked URANS flow checkpoint without clipping.

The rejected scalar has no coupling back into the velocity/turbulence solve.
Keep that independently finite flow; start smoke again from the bounded mean
precursor. Cut planes can carry reverse flow: prescribe precursor scalar values
only on inflow and use zero gradient on outflow. Fixed values on outgoing faces
otherwise violate the scalar maximum principle. Keep scalar diffusion implicit.
"""
import argparse, hashlib, json, re, shutil
from foam_io import ROOT, np, latest, field_values
parser=argparse.ArgumentParser()
parser.add_argument('source');parser.add_argument('target')
parser.add_argument('--end',type=float,default=1.2)
parser.add_argument('--max-co',type=float,default=.8)
args=parser.parse_args()
source=(ROOT/args.source).resolve();target=(ROOT/args.target).resolve()
assert target.is_relative_to(ROOT/'.artifacts/cfd') and not target.exists()
warm=latest(source)
for field in ['U','p','k','omega','nut','phi']:
    values=field_values(warm/field)
    assert np.isfinite(values).all()
    if field in ['k','omega','nut']: assert values.min()>=0
smoke=field_values(source/'0/smoke')
assert np.isfinite(smoke).all() and smoke.min()>=0 and smoke.max()<=1
target.mkdir(parents=True)
for folder in ['constant','system','0']:shutil.copytree(source/folder,target/folder)
for field in ['U','p','k','omega','nut','phi']:shutil.copyfile(warm/field,target/'0'/field)
for field in ['smoke','k','omega']:
    path=target/'0'/field
    text=path.read_text()
    for patch in ['wakeInlet','wakeSides']:
        pattern=r'(\b'+patch+r'\s*\{)([^{}]*)(\})'
        match=re.search(pattern,text,re.S)
        assert match
        if re.search(r'type\s+inletOutlet;',match[2]): continue
        assert re.search(r'type\s+fixedValue;',match[2])
        value=re.search(r'\bvalue\s+(nonuniform\s+List<scalar>\s+\d+\s*\(.*?\)|uniform\s+[^;]+)\s*;',match[2],re.S)
        assert value
        replacement=match[1]+'\ntype inletOutlet;\ninletValue '+value[1]+';\nvalue '+value[1]+';\n'+match[3]
        text=text[:match.start()]+replacement+text[match.end():]
    path.write_text(text)
for name in ['wake-domain.json','experiment.json']:shutil.copyfile(source/name,target/name)
control=target/'system/controlDict';text=control.read_text()
text=text.replace('stopAt writeNow;','stopAt endTime;')
text=re.sub(r'endTime\s+[\d.eE+-]+;',f'endTime {args.end};',text)
text=re.sub(r'maxCo\s+[\d.eE+-]+;',f'maxCo {args.max_co};',text)
text=re.sub(r'deltaT\s+[\d.eE+-]+;',f'deltaT {.0004*args.max_co/.8};',text)
control.write_text(text)
schemes=target/'system/fvSchemes';text=schemes.read_text()
if 'ddt(smoke)' not in text:
    text=text.replace('ddt(U) backward;', 'ddt(U) backward; ddt(smoke) Euler;')
text=text.replace('laplacianSchemes { default Gauss linear limited .5; }',
                  'laplacianSchemes { default Gauss linear limited .5; laplacian(Dsmoke,smoke) Gauss linear uncorrected; }')
assert text.count('laplacian(Dsmoke,smoke)')==1
schemes.write_text(text)
report={'flowCheckpoint':str(warm),'initialVelocitySha256':hashlib.sha256((warm/'U').read_bytes()).hexdigest(),
        'initialSmokeSha256':hashlib.sha256((source/'0/smoke').read_bytes()).hexdigest(),
        'scalarReinitialized':True,'rejectedScalarCopied':False,'maxCo':args.max_co,
        'reason':'Allow scalar/turbulence outflow on reversing precursor cut faces; implicit scalar diffusion; no concentration clipping',
        'cutScalarBoundary':'inletOutlet: fixed precursor only when phi < 0, zeroGradient when phi >= 0',
        'limitation':'Orthogonal scalar diffusion on a mildly non-orthogonal display-mesh proxy; not a spatial convergence proof'}
(target/'restart.json').write_text(json.dumps(report,indent=2)+'\n')
experiment=json.loads((target/'experiment.json').read_text())
experiment.update({'output_dir':str(target),'maxCo':args.max_co,'dt':.0004*args.max_co/.8,'endTime':args.end})
(target/'experiment.json').write_text(json.dumps(experiment,indent=2)+'\n')
print(json.dumps(report))
