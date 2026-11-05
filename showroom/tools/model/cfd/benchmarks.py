"""Check the installed solver against Couette flow and scalar conservation.

These verify numerical setup/transport, not the aerodynamic accuracy of the car.
"""
import json, math, pathlib, subprocess
from foam_io import ROOT, np, header, field_values, scalar_list, latest
BASE=ROOT/'.artifacts/cfd/benchmarks'
FOAM=ROOT/'tools/model/cfd/foam.ps1'
def run(case,tool):
    with (case/('log.'+tool)).open('w') as log:
        subprocess.run(['powershell','-NoProfile','-File',str(FOAM),'-Tool',tool,'-case',str(case)],stdout=log,stderr=log,check=True)
def write(case,path,text,kind='dictionary'):
    p=case/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(header(p.name,kind)+text+'\n')
def build(name,nx,ny,dt,end,scalar=False):
    case=BASE/name
    write(case,'system/blockMeshDict',f'''
scale 1; vertices ((0 0 0) (1 0 0) (1 1 0) (0 1 0) (0 0 .1) (1 0 .1) (1 1 .1) (0 1 .1));
blocks (hex (0 1 2 3 4 5 6 7) ({nx} {ny} 1) simpleGrading (1 1 1)); edges ();
boundary (
 left {{ type cyclic; neighbourPatch right; faces ((0 4 7 3)); }}
 right {{ type cyclic; neighbourPatch left; faces ((1 2 6 5)); }}
 bottom {{ type {'symmetry' if scalar else 'wall'}; faces ((0 1 5 4)); }}
 top {{ type {'symmetry' if scalar else 'wall'}; faces ((3 7 6 2)); }}
 frontBack {{ type empty; faces ((0 3 2 1) (4 5 6 7)); }}
); mergePatchPairs ();''')
    write(case,'system/controlDict',f'''
application {'scalarTransportFoam' if scalar else 'simpleFoam'};
startFrom startTime; startTime 0; stopAt endTime; endTime {end}; deltaT {dt};
writeControl timeStep; writeInterval {round(end/dt)}; writeFormat ascii; writePrecision 12;
runTimeModifiable false;''')
    write(case,'system/fvSchemes',f'''
ddtSchemes {{ default {'Euler' if scalar else 'steadyState'}; }}
gradSchemes {{ default Gauss linear; }}
divSchemes {{ default none; div(phi,T) Gauss upwind; div(phi,U) bounded Gauss upwind; div((nuEff*dev2(T(grad(U))))) Gauss linear; }}
laplacianSchemes {{ default Gauss linear corrected; }}
interpolationSchemes {{ default linear; }} snGradSchemes {{ default corrected; }}
''')
    write(case,'system/fvSolution','''
solvers {
 p { solver PCG; preconditioner DIC; tolerance 1e-12; relTol 0; }
 "(U|T)" { solver PBiCGStab; preconditioner DILU; tolerance 1e-12; relTol 0; }
}
SIMPLE { nNonOrthogonalCorrectors 0; pRefCell 0; pRefValue 0; }
relaxationFactors { equations { U .5; } fields { p .3; } }
''')
    write(case,'constant/transportProperties','DT [0 2 -1 0 0 0 0] .0001;' if scalar else 'transportModel Newtonian; nu [0 2 -1 0 0 0 0] .1;')
    write(case,'constant/turbulenceProperties','simulationType laminar;')
    sides='left { type cyclic; } right { type cyclic; } frontBack { type empty; }'
    ubc='top { type symmetry; } bottom { type symmetry; }' if scalar else 'top { type fixedValue; value uniform (1 0 0); } bottom { type noSlip; }'
    write(case,'0/U','dimensions [0 1 -1 0 0 0 0]; internalField uniform '+('(1 0 0)' if scalar else '(0 0 0)')+'; boundaryField { '+sides+ubc+' }','volVectorField')
    write(case,'0/p','dimensions [0 2 -2 0 0 0 0]; internalField uniform 0; boundaryField { '+sides+' top { type zeroGradient; } bottom { type zeroGradient; } }','volScalarField')
    if scalar:
        x=(np.arange(nx)+.5)/nx
        initial=np.exp(-((x-.25)/.06)**2)
        write(case,'0/T','dimensions [0 0 0 0 0 0 0]; internalField '+scalar_list(initial)+'; boundaryField { '+sides+' top { type symmetry; } bottom { type symmetry; } }','volScalarField')
    run(case,'blockMesh');run(case,'scalarTransportFoam' if scalar else 'simpleFoam')
    return case

report={'scope':'Installed solver and boundary-condition verification; not GT validation','couette':[],'scalarSpace':[],'scalarTime':[]}
for ny in [8,16,32]:
    case=build('couette-'+str(ny),4,ny,1,4000)
    u=field_values(latest(case)/'U')[:,0].reshape(ny,4)
    error=float(np.max(np.abs(u-(np.arange(ny)[:,None]+.5)/ny)))
    report['couette'].append({'cellsAcrossGap':ny,'maxVelocityError':error})
    assert error<1e-7, 'Moving-wall Couette boundary condition failed'
for nx,dt in [(64,.1/32),(128,.1/64),(256,.1/128),(512,.1/256),(128,.004),(128,.002),(128,.001)]:
    case=build(f'scalar-{nx}-{dt:.7f}',nx,1,dt,.1,True)
    initial=field_values(case/'0/T'); c=field_values(latest(case)/'T')
    x=(np.arange(nx)+.5)/nx; width=math.sqrt(.06**2+4*.0001*.1)
    exact=.06/width*np.exp(-((x-.35)/width)**2)
    mass=float(c.sum()/initial.sum()-1); mean=float(np.sum(x*c)/c.sum())
    row={'cells':nx,'dt':dt,'relativeMassError':mass,'min':float(c.min()),'max':float(c.max()),
         'L1Error':float(np.mean(np.abs(c-exact))),'variance':float(np.sum((x-mean)**2*c)/c.sum())}
    report['scalarSpace' if dt==.1/(nx/2) else 'scalarTime'].append(row)
    assert abs(mass)<1e-8 and c.min()>-1e-9 and c.max()<=1+1e-9
space=report['scalarSpace'];times=report['scalarTime']
report['observedSpatialOrders']=[math.log(space[i]['L1Error']/space[i+1]['L1Error'],2) for i in range(len(space)-1)]
report['observedTemporalOrderFromVariance']=math.log(abs((times[0]['variance']-times[1]['variance'])/(times[1]['variance']-times[2]['variance'])),2)
assert all(.65<p<1.25 for p in report['observedSpatialOrders'])
assert .9<report['observedSpatialOrders'][-1]<1.1
assert .9<report['observedTemporalOrderFromVariance']<1.1
(BASE/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
