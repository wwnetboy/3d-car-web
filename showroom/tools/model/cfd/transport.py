"""Frozen RANS conservative tracer solve; no sources at the body or in ducts."""
import argparse, json, pathlib, shutil
from foam_io import ROOT, np, header, field_values, patches, boundary_centres, scalar_list, latest
parser=argparse.ArgumentParser()
parser.add_argument('source'); parser.add_argument('target')
args=parser.parse_args()
source=pathlib.Path(args.source).resolve(); target=pathlib.Path(args.target).resolve()
time=latest(source)
assert (time/'U').exists() and (time/'nut').exists(), 'Reconstruct the selected RANS result first'
target.mkdir(parents=True,exist_ok=True)
for folder in ['constant/polyMesh','system']:
    shutil.copytree(source/folder,target/folder,dirs_exist_ok=True)
(target/'0').mkdir(exist_ok=True)
for name in ['U','phi','nut','p','k']:
    if (time/name).exists(): shutil.copyfile(time/name,target/'0'/name)
def write(path,text,kind='dictionary'):
    (target/path).write_text(header(pathlib.Path(path).name,kind)+text+'\n')
centres=boundary_centres(source)
mesh_patches=patches(source)
inlet_values={
 'smoke':np.exp(-.9*((centres[:,1]-.64)/.52)**2-.65*(centres[:,2]/1.1)**2),
 'age':np.zeros(len(centres)), 'inletY':centres[:,1], 'inletZ':(centres[:,2]+8)/16, 'T':np.zeros(len(centres))}
for name, inlet in inlet_values.items():
    bc=[]
    for patch in mesh_patches:
        if patch=='inlet': bc.append(f'{patch} {{ type fixedValue; value {scalar_list(inlet)}; }}')
        elif patch=='farfield': bc.append(f'{patch} {{ type symmetry; }}')
        elif patch=='outlet': bc.append(f'{patch} {{ type inletOutlet; inletValue uniform 0; value uniform 0; }}')
        else: bc.append(f'{patch} {{ type zeroGradient; }}')
    write('0/'+name,'dimensions [0 0 0 0 0 0 0];\ninternalField uniform 0;\nboundaryField {\n'+'\n'.join(bc)+'\n}', 'volScalarField')
nut=field_values(time/'nut')
diffusivity=1.5e-5/.7+np.maximum(0,nut)/.7
bc='\n'.join(f'{p} {{ type '+('symmetry' if p=='farfield' else 'zeroGradient')+'; }' for p in mesh_patches)
write('0/diffusivity','dimensions [0 2 -1 0 0 0 0];\ninternalField '+scalar_list(diffusivity)+';\nboundaryField {\n'+bc+'\n}','volScalarField')
functions='readDiffusion { type readFields; libs ("libfieldFunctionObjects.dll"); fields (diffusivity); readOnStart true; }\n'
for field in ['smoke','age','inletY','inletZ']:
    functions+=f'''{field}Transport {{ type scalarTransport; libs ("libsolverFunctionObjects.dll");
 field {field}; schemesField T; nut diffusivity; nCorr 4; tolerance 1e-7; bounded01 false;
 executeControl timeStep; writeControl writeTime;
'''
    if field=='age': functions+='fvOptions { residence { type scalarSemiImplicitSource; enabled true; selectionMode all; volumeMode specific; sources { age (1 0); } } }\n'
    functions+='}\n'
write('system/controlDict',f'''
application scalarTransportFoam;
startFrom latestTime; startTime 0; endTime 12; stopAt endTime; deltaT 1;
writeControl timeStep; writeInterval 4; purgeWrite 2;
writeFormat ascii; writePrecision 9; writeCompression off;
runTimeModifiable true;
functions {{ {functions} }}
''')
write('constant/transportProperties','DT [0 2 -1 0 0 0 0] 0;')
write('system/fvSchemes','''
ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; }
divSchemes { default none; div(phi,T) Gauss upwind; }
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
''')
write('system/fvSolution','''
solvers { T { solver PBiCGStab; preconditioner DILU; tolerance 1e-8; relTol 0; maxIter 2000; } }
SIMPLE { nNonOrthogonalCorrectors 1; }
''')
(target/'transport.json').write_text(json.dumps({'source':str(source),'sourceTime':time.name,'Schmidt':.7,
 'smokeSources':['inlet only'],'diffusivity':'nu/0.7 + nut/0.7','meanFlowFrozen':True,
 'inletZEncoding':{'bias':-8,'scale':16}},indent=2))
print(target)
