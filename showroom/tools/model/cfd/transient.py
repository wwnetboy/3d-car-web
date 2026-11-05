"""Prepare an isolated URANS wake experiment from the accepted mean-flow mesh.

This writes no website assets. Measured transient results must be checked before
export; elapsed solver time is physical seconds, not SIMPLE iteration numbers.
"""
import argparse, hashlib, json, pathlib, shutil
from foam_io import ROOT, np, header, latest, field_values

parser = argparse.ArgumentParser()
parser.add_argument('target')
parser.add_argument('--source', default='.artifacts/cfd/medium-resolved')
parser.add_argument('--smoke-source', default='.artifacts/cfd/smoke-medium')
parser.add_argument('--end', type=float, default=.01)
parser.add_argument('--max-co', type=float, default=.8)
parser.add_argument('--ranks', type=int, default=8)
args = parser.parse_args()
source = (ROOT / args.source).resolve()
smoke_source = (ROOT / args.smoke_source).resolve()
target = (ROOT / args.target).resolve()
assert target.is_relative_to(ROOT / '.artifacts/cfd')
assert not target.exists(), 'Use a new experiment directory; do not overwrite a run'
assert 0 < args.end <= 5 and 0 < args.max_co <= 2 and 1 <= args.ranks <= 8
assert shutil.disk_usage(ROOT).free > 10 * 1024**3
initial = latest(source)
smoke_initial = latest(smoke_source)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(initial/'U') == sha(smoke_source/'0/U'), 'Smoke must use this velocity field'
concentration = field_values(smoke_initial/'smoke')
assert np.isfinite(concentration).all() and concentration.min() >= -1e-8 and concentration.max() <= 1
target.mkdir(parents=True)
shutil.copytree(source/'constant/polyMesh', target/'constant/polyMesh')
(target/'0').mkdir()
(target/'system').mkdir()
for name in ['U', 'p', 'phi', 'k', 'omega', 'nut']:
    shutil.copyfile(initial/name, target/'0'/name)
shutil.copyfile(smoke_initial/'smoke', target/'0/smoke')
for name in ['transportProperties', 'turbulenceProperties']:
    shutil.copyfile(source/'constant'/name, target/'constant'/name)

def write(path, text):
    (target/path).write_text(header(pathlib.Path(path).name)+text+'\n')

write('constant/dynamicMeshDict', 'dynamicFvMesh staticFvMesh;')
write('system/decomposeParDict', f'numberOfSubdomains {args.ranks}; method scotch;')
write('system/fvSchemes', '''
ddtSchemes { default Euler; ddt(U) backward; ddt(smoke) Euler; }
gradSchemes { default Gauss linear; grad(U) cellLimited Gauss linear 1; }
divSchemes {
 default none; div(phi,U) Gauss linearUpwindV grad(U);
 div(phi,k) Gauss upwind; div(phi,omega) Gauss upwind; div(phi,smoke) Gauss upwind;
 div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear limited .5; laplacian(Dsmoke,smoke) Gauss linear uncorrected; }
interpolationSchemes { default linear; }
snGradSchemes { default limited .5; }
wallDist { method meshWave; }
''')
write('system/fvSolution', '''
solvers {
 p { solver GAMG; smoother GaussSeidel; tolerance 1e-8; relTol .02; }
 pFinal { $p; relTol 0; }
 "(U|k|omega)" { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol .05; }
 "(U|k|omega)Final" { $U; relTol 0; }
 smoke { solver PBiCGStab; preconditioner DILU; tolerance 1e-9; relTol 0; maxIter 500; }
}
PIMPLE { momentumPredictor yes; nOuterCorrectors 2; nCorrectors 2; nNonOrthogonalCorrectors 0; }
relaxationFactors { equations { ".*" 1; } }
''')
probes = [[x,y,z] for x in [-2.9,-3.5,-4.2,-5]
          for y in [.2,.5,.85,1.2,1.6] for z in [-1,-.5,0,.5,1]]
locations = '\n'.join('('+ ' '.join(map(str,p))+')' for p in probes)
write('system/controlDict', f'''
application pimpleFoam; startFrom latestTime; startTime 0;
stopAt endTime; endTime {args.end}; deltaT .0001;
adjustTimeStep yes; maxCo {args.max_co}; maxDeltaT .001;
writeControl adjustableRunTime; writeInterval {args.end}; purgeWrite 2;
writeFormat ascii; writePrecision 10; writeCompression off;
timeFormat general; timePrecision 9; runTimeModifiable true;
functions {{
 smokeTransport {{ type scalarTransport; libs ("libsolverFunctionObjects.dll");
  field smoke; schemesField smoke; alphaD 1.42857142857; alphaDt 1.42857142857;
  nCorr 0; bounded01 false; resetOnStartUp false;
  executeControl timeStep; writeControl writeTime; }}
 wakeProbes {{ type probes; libs ("libsampling.dll"); fields (U k omega smoke);
  interpolationScheme cellPoint; writeControl timeStep; writeInterval 1;
  probeLocations ({locations}); }}
 bounds {{ type fieldMinMax; libs ("libfieldFunctionObjects.dll"); fields (smoke U k omega);
  location false; log false; writeControl timeStep; writeInterval 1; }}
 inletFlux {{ type surfaceFieldValue; libs ("libfieldFunctionObjects.dll");
  regionType patch; name inlet; operation sum; fields (phi); writeFields false;
  log false; writeControl timeStep; writeInterval 1; }}
 outletFlux {{ type surfaceFieldValue; libs ("libfieldFunctionObjects.dll");
  regionType patch; name outlet; operation sum; fields (phi); writeFields false;
  log false; writeControl timeStep; writeInterval 1; }}
}}
''')
report = {'method': 'Transient incompressible PIMPLE / kOmegaSST URANS with conservative passive scalar',
          'source': str(source), 'sourceTime': initial.name, 'sourceVelocitySha256': sha(initial/'U'),
          'smokeSource': str(smoke_source), 'smokeInitialSha256': sha(smoke_initial/'smoke'),
          'referenceKmh': 120, 'dt': .0001, 'maxCo': args.max_co, 'endTime': args.end,
          'material_source': 'Air: nu=1.5e-5 m2/s; turbulent Schmidt=0.7; same reference conditions as accepted mean solve',
          'output_dir': str(target), 'probes': probes, 'initialConcentrationRange': [float(concentration.min()),float(concentration.max())],
          'caveat': 'Uncalibrated display-mesh proxy; this is not LES, DNS, or experimental validation'}
(target/'experiment.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'case':str(target),'endTime':args.end,'maxCo':args.max_co,'cells':len(concentration)}))
