"""Audit actual transient fields and fluxes; a stable run is not calibration."""
import argparse, json, pathlib, re
from foam_io import ROOT, np, field_values
parser = argparse.ArgumentParser()
parser.add_argument('case')
parser.add_argument('--startup', type=float, default=0)
args = parser.parse_args()
case = (ROOT/args.case).resolve()
post = case/'postProcessing'
logs = sorted(case.glob('log.solve*'))
text = '\n'.join(p.read_text(errors='replace') for p in logs)
assert 'FOAM FATAL' not in text and 'ended prematurely' not in text
co = np.array([float(n) for n in re.findall(r'Courant Number mean: [\deE+.-]+ max: ([\deE+.-]+)',text)])
dt = np.array([float(n) for n in re.findall(r'deltaT = ([\deE+.-]+)',text)])
continuity = np.array([float(n) for n in re.findall(r'global = ([\deE+.-]+)',text)])
local_continuity = np.array([float(n) for n in re.findall(r'sum local = ([\deE+.-]+)',text)])
final = np.array([float(n) for n in re.findall(r'Final residual = ([\deE+.-]+)',text)])
assert len(co) and len(dt) and len(continuity) and np.isfinite(np.concatenate([co,dt,continuity,final])).all()

def series(name, filename):
    files = sorted((post/name).glob('*/'+filename),key=lambda p:float(p.parent.name))
    rows = {}
    for p in files:
        cleaned = '\n'.join(l for l in p.read_text().replace('(',' ').replace(')',' ').splitlines() if not l.startswith('#'))
        values = np.loadtxt(cleaned.splitlines(),ndmin=2)
        for row in values: rows[row[0]] = row
    return np.array([rows[t] for t in sorted(rows)])

bounds = series('bounds','fieldMinMax.dat')
inlet = series('inletFlux','surfaceFieldValue.dat')
outlet = series('outletFlux','surfaceFieldValue.dat')
sides = series('sideFlux','surfaceFieldValue.dat') if (post/'sideFlux').exists() else np.column_stack([inlet[:,0],np.zeros(len(inlet))])
assert np.array_equal(inlet[:,0],outlet[:,0]) and np.array_equal(inlet[:,0],sides[:,0])
imbalance = np.abs(inlet[:,1]+outlet[:,1]+sides[:,1])/np.maximum(np.abs(inlet[:,1]),1e-12)
velocity = series('wakeProbes','U')
smoke = series('wakeProbes','smoke')
selected = velocity[:,0] >= args.startup
assert selected.sum() >= 3, 'Need more samples after startup'
u = velocity[selected,1:].reshape(selected.sum(),-1,3)
c = smoke[smoke[:,0]>=args.startup,1:]
assert np.isfinite(u).all() and np.isfinite(c).all()
initial = (case/'0/smoke').read_text()
source_values = [field_values(case/'0/smoke')]
for match in re.finditer(r'\b(?:inletValue|value)\s+(?:nonuniform\s+List<scalar>\s+\d+\s*\((.*?)\)|uniform\s+([^;]+))\s*;',initial,re.S):
    source_values.append(np.fromstring(match[1] or match[2],sep=' '))
source_min = min(float(v.min()) for v in source_values)
source_max = max(float(v.max()) for v in source_values)
report = {'duration':float(velocity[-1,0]),'startupExcluded':args.startup,
          'steps':len(dt),'maxCourant':float(co.max()),'timeStepRange':[float(dt.min()),float(dt.max())],
          'maxGlobalContinuityError':float(np.abs(continuity).max()),
          'maxLocalContinuityError':float(local_continuity.max()),
          'turbulenceBoundingEvents':len(re.findall(r'bounding (?:k|omega),',text)),
          'maxRelativeBoundaryFluxImbalance':float(imbalance.max()),
          'initialAndInletConcentrationRange':[source_min,source_max],
          'volumeConcentrationRange':[float(bounds[:,7].min()),float(bounds[:,8].max())],
          'velocityRange':[float(bounds[:,1].min()),float(bounds[:,2].max())],
          'probeMeanVelocity':u.mean(axis=0).tolist(),'probeVelocityRms':u.std(axis=0).tolist(),
          'probeSmokeMean':c.mean(axis=0).tolist(),'probeSmokeRms':c.std(axis=0).tolist(),
          'scope':'Numerical checks on an uncalibrated URANS experiment, not experimental validation'}
checks = {'finite':True,'courant':bool(co.max()<=1.01),'timeStep':bool(dt.min()>=1e-6),
          'concentration':bool(bounds[:,7].min()>=-1e-7 and bounds[:,8].max()<=1.000001),
          'maximumPrinciple':bool(bounds[:,7].min()>=source_min-1e-6 and bounds[:,8].max()<=source_max+1e-6),
          'boundaryFlux':bool(imbalance.max()<=1e-3),'continuity':bool(np.abs(continuity).max()<1e-6 and local_continuity.max()<1e-6)}
report['checks'] = checks
(case/'transient-audit.json').write_text(json.dumps(report,indent=2)+'\n')
# The generic skill's mass-initial/final interface does not describe an open
# flow domain; use it for scalar bounds/finite values only, and audit flux above.
metrics = {'field_min':report['volumeConcentrationRange'][0], 'field_max':report['volumeConcentrationRange'][1], 'has_nan':False}
(case/'validation-metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if not k.startswith('probe')}))
assert all(checks.values()), 'Do not publish a failed transient experiment'
