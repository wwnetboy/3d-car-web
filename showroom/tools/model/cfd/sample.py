"""Prepare cell-point interpolation onto the WebGL lattice and audit probes."""
import argparse, pathlib, shutil
from foam_io import header, np, latest
parser=argparse.ArgumentParser();parser.add_argument('case');parser.add_argument('--flow-only',action='store_true');parser.add_argument('--probes-only',action='store_true')
args=parser.parse_args();case=pathlib.Path(args.case);time=latest(case)
for name in ['U','k','p','nut']:
    if not (time/name).exists() and (case/'0'/name).exists(): shutil.copyfile(case/'0'/name,time/name)
shape=np.array([256,96,128]);low=np.array([-5.4,-.08,-2.5]);high=np.array([4.7,2.55,2.5]);step=(high-low)/shape
vec=lambda a:'('+' '.join(f'{v:.10g}' for v in a)+')'
fields='U p k nut' if args.flow_only else 'smoke age inletY inletZ U p k nut'
sets=f'''volume {{ type array; axis xyz; pointsDensity {vec(shape)};
 spanBox {vec(step*(shape+1))}; origin {vec(low-step*.5)};
 rotation {{ type axes; e1 (1 0 0); e2 (0 1 0); }} }}'''
probes=[(2.45,.28,0),(2.45,.4,0),(2.45,.28,.55),(2.25,.28,0),(0,.20,.65),
        (1,.06,0),(0,.06,0),(-1,.06,0),(-3.2,.6,0),(3.3,.64,0),(0,1.35,0)]
if args.probes_only: sets=''
sets+='\nprobes { type cloud; axis xyz; points ('+' '.join(vec(p) for p in probes)+'); }'
content=f'''functions {{
 readInput {{ type readFields; libs ("libfieldFunctionObjects.dll"); fields ({fields}); readOnStart true; }}
 sampled {{ type sets; libs ("libsampling.dll"); interpolationScheme cellPoint;
 setFormat csv; fields ({fields}); sets {{ {sets} }} }}
}}'''
(case/'system/sampleFields').write_text(header('sampleFields')+content+'\n')
print(case/'system/sampleFields')
