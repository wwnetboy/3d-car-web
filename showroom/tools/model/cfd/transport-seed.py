"""Create a scalar-only warm start; the final car velocity remains unchanged."""
import pathlib, shutil, sys
from foam_io import ROOT, header, field_values, latest, patches, scalar_list
source=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2]);time=latest(source)
shutil.copytree(source/'constant/polyMesh',target/'constant/polyMesh',dirs_exist_ok=True)
shutil.copytree(source/'system',target/'system',dirs_exist_ok=True)
(target/'0').mkdir(exist_ok=True)
for name in ['smoke','age','inletY']: shutil.copyfile(time/name,target/'0'/name)
z=(field_values(time/'inletZ')+8)/16
bc='\n'.join(f'{p} {{ type '+('symmetry' if p=='farfield' else 'zeroGradient')+'; }' for p in patches(source))
(target/'0/inletZ').write_text(header('inletZ','volScalarField')+'dimensions [0 0 0 0 0 0 0];\ninternalField '+scalar_list(z)+';\nboundaryField {\n'+bc+'\n}\n')
