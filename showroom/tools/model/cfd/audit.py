"""Numerical quality and conservation ledger; never converts these into validation."""
import json, pathlib, re
from foam_io import ROOT, np, latest, list_body, field_values, patches
base=ROOT/'.artifacts/cfd'
def values(body,n):
    m=re.search(r'value\s+nonuniform\s+List<scalar>\s+(\d+)\s*\((.*?)\)\s*;',body,re.S)
    if m:
        v=np.fromstring(m[2],sep=' ');assert len(v)==n;return v
    m=re.search(r'value\s+uniform\s+([^;]+)',body)
    if m:return np.full(n,float(m[1]))
    raise ValueError('Missing boundary flux')
report={'scope':'Numerical verification of an approximate display-geometry CFD case; no experimental validation',
 'referenceKmh':120,'cases':[]}
for name in ['coarse-resolved','medium-resolved','fine']:
    case=base/name;time=latest(case);mesh=case/'constant/polyMesh'
    _,body=list_body((mesh/'owner').read_text());owner=np.fromstring(body,sep=' ',dtype=np.int32)
    _,body=list_body((mesh/'neighbour').read_text());neighbour=np.fromstring(body,sep=' ',dtype=np.int32)
    phi=field_values(time/'phi');all_phi=np.zeros(len(owner));all_phi[:len(phi)]=phi
    boundary=(time/'phi').read_text().split('boundaryField',1)[1]
    sums={}
    for patch,info in patches(case).items():
        match=re.search(r'\b'+patch+r'\s*\{(.*?)\}',boundary,re.S)
        v=values(match[1],info['count']);all_phi[info['start']:info['start']+info['count']]=v;sums[patch]=float(v.sum())
    cells=int(max(owner.max(),neighbour.max())+1)
    divergence=np.bincount(owner,weights=all_phi,minlength=cells)-np.bincount(neighbour,weights=phi,minlength=cells)
    inlet=abs(sums['inlet']);net=abs(sum(sums.values()))/inlet
    coefficient=next((case/'postProcessing/force/0').glob('*.dat'))
    forces=np.loadtxt(coefficient,comments='#');tail=forces[-11:,1]
    log=(case/'log.solve').read_text(errors='replace')
    residuals={}
    for field,initial,final in re.findall(r'Solving for (\w+), Initial residual = ([\deE+.-]+), Final residual = ([\deE+.-]+)',log):
        residuals[field]={'initial':float(initial),'linearFinal':float(final)}
    source_report=json.loads((case/'case.json').read_text())
    probe=next(latest(case/'postProcessing/sampled').glob('probes_*.csv'))
    with probe.open() as f: labels=f.readline().strip().split(',')
    data=np.loadtxt(probe,delimiter=',',skiprows=1)
    row={'case':name,'cells':cells,'latestIteration':time.name,'fluxM3s':sums,
         'relativeBoundaryFluxImbalance':net,'sumAbsoluteCellImbalanceOverInlet':float(np.abs(divergence).sum()/inlet),
         'maxCellFluxImbalance':float(np.abs(divergence).max()),'residuals':residuals,
         'strictResidualGoalMet':all(v['initial']<1e-5 for v in residuals.values()),
         'dragCoefficientWithAssumed2_5m2Area':float(forces[-1,1]),'last100IterationDragRangeOverMean':float(np.ptp(tail)/np.mean(tail)),
         'probes':[dict(zip(labels,map(float,line))) for line in data],
         'quality':'Orthogonal/castellated cells; unresolved gradient stencils removed; concavity warnings remain in extended checks',
         'boundaryLayerResolved':False,'CdSuitableForEngineeringUse':False}
    assert net<1e-5 and np.isfinite(divergence).all(), 'Car flow failed the flux conservation gate'
    report['cases'].append(row)
medium=report['cases'][1];fine=report['cases'][2]
for item in [medium,fine]:
    item['underbodySpeedMps']=[float(np.linalg.norm([p['U_0'],p['U_1'],p['U_2']])) for p in item['probes'][5:8]]
report['underbodyMediumFineMaxRelativeDifference']=float(np.max(np.abs(np.array(medium['underbodySpeedMps'])/fine['underbodySpeedMps']-1)))
coeff=[r['dragCoefficientWithAssumed2_5m2Area'] for r in report['cases']]
report['mediumFineDragDifference']=abs(coeff[1]/coeff[2]-1)
report['gridIndependenceEstablished']=False
report['interpretation']='Main underbody advection is comparable; cavity/wake and drag remain grid sensitive. Do not report GCI or a validated vehicle Cd.'
report['benchmarks']=json.loads((base/'benchmarks/report.json').read_text())
report['washout']=json.loads((base/'washout-report.json').read_text())
(base/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['cases','benchmarks','washout']}))
for c in report['cases']: print(json.dumps({k:v for k,v in c.items() if k not in ['probes','residuals','fluxM3s']}))
