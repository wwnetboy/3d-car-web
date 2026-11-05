"""Extract a wake diagnostic domain, preserving the precursor mean-flow profile.

The rear body and moving road remain in the calculation. Front, upper and side
cuts use the full-car precursor's sampled fields, so no sine-wave inlet is added.
This local experiment cannot validate whole-car unsteady loads.
"""
import argparse, hashlib, json, os, pathlib, re, subprocess
from foam_io import ROOT, np, header, patches, field_values, boundary_centres, scalar_list

parser = argparse.ArgumentParser()
parser.add_argument('case')
parser.add_argument('--precursor', default='.artifacts/cfd/wake-transient')
parser.add_argument('--finish-fields', action='store_true')
args = parser.parse_args()
case = (ROOT/args.case).resolve()
assert case.is_relative_to(ROOT/'.artifacts/cfd')
assert not (case/'processor0').exists(), 'Subset before decomposition'
assert not (case/'wake-domain.json').exists(), 'Do not subset a completed domain again'
low = [-9.24, 0, -2.31111111111111]
high = [-1.68, 2.08695652173913, 2.31111111111111]
vec = lambda p: '('+' '.join(f'{x:.14g}' for x in p)+')'

def foam(tool, *extra):
    with (case/('log.'+tool)).open('w') as log:
        subprocess.run(['powershell','-NoProfile','-File',str(ROOT/'tools/model/cfd/foam.ps1'),
                        '-Tool',tool,'-case',str(case),*extra],stdout=log,stderr=log,check=True)

def write(name, text):
    (case/'system'/name).write_text(header(name)+text+'\n')

if not args.finish_fields:
    write('topoSetDict', f'actions ({{name keepWake; type cellSet; action new; source boxToCell; box {vec(low)} {vec(high)};}});')
    foam('topoSet')
    foam('subsetMesh', '-overwrite', 'keepWake')
actions = []
for name, axis, location, action in [('wakeInlet',0,high[0],'new'),('wakeOutlet',0,low[0],'new'),
                                    ('wakeSides',1,high[1],'new'),('wakeSides',2,low[2],'add'),('wakeSides',2,high[2],'add')]:
    a = [v-1e-5 for v in low]; b = [v+1e-5 for v in high]
    a[axis] = location-1e-5; b[axis] = location+1e-5
    actions.append(f'{{name {name}; type faceSet; action {action}; source boxToFace; box {vec(a)} {vec(b)};}}')
for name in ['wakeInlet','wakeOutlet','wakeSides']:
    # Some stair-step body faces lie on the cut plane too. Only reassign faces
    # exposed by the subset; preserve every actual wall and its mapped fields.
    actions.append(f'{{name {name}; type faceSet; action subset; source patchToFace; patches (oldInternalFaces);}}')
if not args.finish_fields:
    write('topoSetDict', 'actions ('+'\n'.join(actions)+');')
    foam('topoSet')
    write('createPatchDict', 'pointSync false; patches (\n'+'\n'.join(
        f'{{name {name}; patchInfo {{type patch;}} constructFrom set; set {name};}}'
        for name in ['wakeInlet','wakeOutlet','wakeSides'])+'\n);')
    foam('createPatch', '-overwrite')
boundary = patches(case)
assert all(boundary[p]['count'] > 0 for p in ['wakeInlet','wakeOutlet','wakeSides'])
assert boundary.get('oldInternalFaces', {'count':0})['count'] == 0, 'Unclassified cut faces remain'

# createPatch changes the mesh only. Sample the original full-car fields at
# the new face centres rather than guessing values or using empty patch fields.
precursor = (ROOT/args.precursor).resolve()
centres = {p:boundary_centres(case,p) for p in ['wakeInlet','wakeOutlet','wakeSides']}
sets = '\n'.join(p+' {type cloud; axis xyz; points ('+'\n'.join(vec(c) for c in points)+');}' for p,points in centres.items())
write('precursorFaces', '''functions {
 readInput {type readFields; libs ("libfieldFunctionObjects.dll"); fields (U p k omega nut smoke); readOnStart true;}
 cutFields {type sets; libs ("libsampling.dll"); interpolationScheme cellPoint;
 setFormat csv; fields (U p k omega nut smoke); sets {'''+sets+'}}}\n')
with (case/'log.precursor').open('w') as log:
    subprocess.run(['powershell','-NoProfile','-File',str(ROOT/'tools/model/cfd/foam.ps1'),
                    '-Tool','postProcess','-case',str(precursor),'-time','0','-dict',
                    pathlib.Path(os.path.relpath(case/'system/precursorFaces',precursor)).as_posix()],
                   stdout=log,stderr=log,check=True,cwd=precursor)
values = {}
for patch, points in centres.items():
    csv = next((precursor/'postProcessing/cutFields/0').glob(patch+'_*.csv'))
    with csv.open() as f: names = f.readline().strip().split(',')
    data = np.loadtxt(csv,delimiter=',',skiprows=1)
    assert data.shape[0] == len(points) and np.allclose(data[:,:3],points,atol=1e-6), 'Incomplete precursor sampling'
    assert np.isfinite(data).all()
    values[patch] = {name:data[:,i] for i,name in enumerate(names)}

for field in ['U','p','k','omega','nut','smoke']:
    path = case/'0'/field
    text = path.read_text()
    start = text.index('boundaryField')
    existing = {m[1]:m[2] for m in re.finditer(r'(\w+)\s*\{([^{}]*)\}',text[start:],re.S)}
    definitions = []
    for patch in boundary:
        if patch not in values:
            assert patch in existing, 'Missing retained boundary '+patch
            definitions.append(patch+' {\n'+existing[patch]+'\n}')
            continue
        row = values[patch]
        value = ('nonuniform List<vector>\n'+str(len(row['U_0']))+'\n(\n'+'\n'.join(
            vec(p) for p in np.column_stack([row['U_0'],row['U_1'],row['U_2']]))+'\n)') if field == 'U' else scalar_list(row[field])
        if field == 'p':
            replacement = 'type fixedValue; value '+value+';' if patch == 'wakeOutlet' else 'type zeroGradient;'
        elif field == 'nut':
            replacement = 'type calculated; value '+value+';'
        elif patch == 'wakeOutlet' or field in ['smoke','k','omega']:
            replacement = 'type inletOutlet; inletValue '+value+'; value '+value+';'
        else:
            replacement = 'type fixedValue; value '+value+';'
        definitions.append(patch+'\n{\n'+replacement+'\n}')
    path.write_text(text[:start]+'boundaryField {\n'+'\n'.join(definitions)+'\n}\n')
if (case/'0/phi').exists(): (case/'0/phi').rename(case/'precursor-phi')

control = case/'system/controlDict'
text = control.read_text().replace('name inlet;', 'name wakeInlet;').replace('name outlet;', 'name wakeOutlet;')
text = text.replace('outletFlux {', 'sideFlux { type surfaceFieldValue; libs ("libfieldFunctionObjects.dll"); regionType patch; name wakeSides; operation sum; fields (phi); writeFields false; log false; writeControl timeStep; writeInterval 1; }\n outletFlux {')
control.write_text(text)
foam('checkMesh')
report = {'low':low,'high':high,'cells':len(field_values(case/'0/smoke')),
          'precursorVelocitySha256':hashlib.sha256((precursor/'0/U').read_bytes()).hexdigest(),
          'cuts':'Stationary full-car mean U/k/omega/smoke profiles; pressure outlet; no imposed oscillation',
          'scope':'Rear body / wake diagnostic, not whole-car transient aerodynamics',
          'patches':{p:v['count'] for p,v in boundary.items()}}
(case/'wake-domain.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
