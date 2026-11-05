"""Switch off the inlet tracer on the frozen car flow; compare three timesteps."""
import argparse, json, pathlib, re, shutil, subprocess
from foam_io import ROOT, np, header, latest
parser=argparse.ArgumentParser();parser.add_argument('source');args=parser.parse_args()
source=pathlib.Path(args.source).resolve();initial=latest(source)
report=[]
for dt in [.04,.02,.01]:
    case=source.parent/f'washout-{dt}'
    shutil.copytree(source/'constant',case/'constant',dirs_exist_ok=True)
    shutil.copytree(source/'system',case/'system',dirs_exist_ok=True)
    shutil.copytree(source/'0',case/'0',dirs_exist_ok=True)
    c=(initial/'smoke').read_text()
    c=re.sub(r'\binlet\s*\{.*?\}', 'inlet { type fixedValue; value uniform 0; }', c, flags=re.S)
    (case/'0/smoke').write_text(c)
    control=header('controlDict')+f'''
application scalarTransportFoam; startFrom startTime; startTime 0;
stopAt endTime; endTime 2; deltaT {dt};
writeControl timeStep; writeInterval {round(2/dt)}; purgeWrite 1;
writeFormat ascii; writePrecision 9; writeCompression off; timePrecision 8; runTimeModifiable false;
functions {{
 readDiffusion {{ type readFields; libs ("libfieldFunctionObjects.dll"); fields (diffusivity); readOnStart true; }}
 smokeTransport {{ type scalarTransport; libs ("libsolverFunctionObjects.dll"); field smoke; schemesField T;
  nut diffusivity; nCorr 0; tolerance 1e-8; executeControl timeStep; writeControl writeTime; }}
 mass {{ type volFieldValue; libs ("libfieldFunctionObjects.dll"); regionType all;
  operation volIntegrate; fields (smoke); writeFields false; writeControl timeStep; writeInterval 1; log false; }}
}}
'''
    (case/'system/controlDict').write_text(control)
    p=case/'system/fvSchemes';p.write_text(p.read_text().replace('default steadyState','default Euler'))
    (case/'system/decomposeParDict').write_text(header('decomposeParDict')+'numberOfSubdomains 4; method scotch;\n')
    (case/'system/fvSolution').write_text(header('fvSolution')+'''
solvers { T { solver PBiCGStab; preconditioner DILU; tolerance 1e-8; relTol 0; maxIter 1000; } }
SIMPLE { nNonOrthogonalCorrectors 1; }
''')
    for tool,ranks in [('decomposePar',1),('scalarTransportFoam',4)]:
        with (case/('log.'+tool)).open('w') as log:
            subprocess.run(['powershell','-NoProfile','-File',str(ROOT/'tools/model/cfd/foam.ps1'),'-Tool',tool,'-Ranks',str(ranks),'-case',str(case)],stdout=log,stderr=log,check=True)
    file=next((case/'postProcessing/mass/0').glob('*.dat'))
    data=np.loadtxt(file,comments='#')
    row={'dt':dt,'time':data[:,0].tolist(),'smokeIntegral':data[:,1].tolist(),
         'lastMass':float(data[-1,1]),'monotoneDecay':bool(np.all(np.diff(data[:,1])<=1e-7))}
    assert row['monotoneDecay'], 'Source-free smoke must not accumulate after shutoff'
    report.append(row)
    print(json.dumps({'dt':dt,'lastMass':row['lastMass']}),flush=True)
a,b,c=[r['lastMass'] for r in report]
order=float(np.log2(abs((a-b)/(b-c)))) if (a-b)*(b-c)>0 else None
result={'scope':'Frozen 120 km/h medium-grid mean flow, source off for two physical seconds',
        'temporalOrderAtTwoSeconds':order,'runs':report,
        'caveat':'Steady initialization fills even slowly exchanging cavities; residual trapped tracer is not an ongoing source'}
(source.parent/'washout-report.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'temporalOrder':order}),flush=True)
