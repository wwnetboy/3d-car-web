"""Compare identical wake initial/boundary data at two time-step limits."""
import argparse, json
from foam_io import ROOT, np
parser=argparse.ArgumentParser()
parser.add_argument('coarse');parser.add_argument('fine')
parser.add_argument('--start',type=float,default=.1)
parser.add_argument('--end',type=float,default=.4)
args=parser.parse_args()
cases=[(ROOT/p).resolve() for p in [args.coarse,args.fine]]
restarts=[json.loads((p/'restart.json').read_text()) for p in cases]
for name in ['initialVelocitySha256','initialSmokeSha256']:
    assert restarts[0][name]==restarts[1][name], 'Time-step test must share the initial state'
assert restarts[1]['maxCo']==restarts[0]['maxCo']/2
for p in cases:
    audit=json.loads((p/'transient-audit.json').read_text())
    assert all(audit['checks'].values()) and audit['duration']>=args.end-1e-7
times=np.linspace(args.start,args.end,201)

def probes(case,field):
    rows={}
    for path in sorted((case/'postProcessing/wakeProbes').glob('*/'+field),key=lambda p:float(p.parent.name)):
        data='\n'.join(l for l in path.read_text().replace('(',' ').replace(')',' ').splitlines() if not l.startswith('#'))
        for row in np.loadtxt(data.splitlines(),ndmin=2):rows[row[0]]=row
    values=np.array([rows[t] for t in sorted(rows)])
    return np.column_stack([np.interp(times,values[:,0],values[:,i]) for i in range(1,values.shape[1])])

u=[probes(p,'U') for p in cases]; c=[probes(p,'smoke') for p in cases]
du=u[1]-u[0];dc=c[1]-c[0]
report={'interval':[args.start,args.end],'maxCo':[r['maxCo'] for r in restarts],
        'velocityRmsErrorMps':float(np.sqrt(np.mean(du**2))),
        'velocityRmsErrorOverFreestream':float(np.sqrt(np.mean(du**2))/(120/3.6)),
        'concentrationRmsError':float(np.sqrt(np.mean(dc**2))),
        'concentrationMaxError':float(np.abs(dc).max()),
        'scope':'100 wake probes, identical initial/boundary conditions; temporal sensitivity only, not grid independence'}
report['checks']={'velocity':report['velocityRmsErrorOverFreestream']<=.01,
                  'concentrationRms':report['concentrationRmsError']<=.005,
                  'concentrationMax':report['concentrationMaxError']<=.03}
(cases[0]/'time-step-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
assert all(report['checks'].values()), 'Transient playback must pass the declared time-step comparison'
