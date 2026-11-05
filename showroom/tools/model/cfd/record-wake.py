"""Enable sampled transient smoke frames; never copy unverified data to public/."""
import argparse, json, re
from foam_io import ROOT, np, header
parser = argparse.ArgumentParser()
parser.add_argument('case')
parser.add_argument('--end', type=float, default=1.8)
parser.add_argument('--start', type=float, default=.4)
parser.add_argument('--interval', type=float, default=.02)
args = parser.parse_args()
case = (ROOT/args.case).resolve()
assert case.is_relative_to(ROOT/'.artifacts/cfd') and (case/'wake-domain.json').exists()
assert 0 <= args.start < args.end <= 5 and .005 <= args.interval <= .1
shape = np.array([64,32,48]); low = np.array([-5.4,.025,-2.15]); high = np.array([-2.3,2.05,2.15])
step = (high-low)/shape
vec = lambda a: '('+' '.join(f'{v:.12g}' for v in a)+')'
sampling = f'''
wakeFrames {{
 type sets; libs ("libsampling.dll"); interpolationScheme cellPoint;
 setFormat csv; fields (smoke); writeControl runTime; writeInterval {args.interval}; timeStart {args.start};
 sets {{ volume {{ type array; axis xyz; pointsDensity {vec(shape)};
 spanBox {vec(step*(shape+1))}; origin {vec(low-step*.5)};
 rotation {{ type axes; e1 (1 0 0); e2 (0 1 0); }} }} }}
}}
'''
(case/'system/wakeSampling').write_text(sampling)
path = case/'system/controlDict'; control = path.read_text()
control = re.sub(r'endTime\s+[\d.eE+-]+;',f'endTime {args.end};',control)
control = re.sub(r'writeInterval\s+[\d.eE+-]+;\s*purgeWrite', 'writeInterval .2; purgeWrite', control, count=1)
if '#include "wakeSampling"' not in control:
    index = control.rfind('}')
    control = control[:index]+'\n#include "wakeSampling"\n'+control[index:]
path.write_text(control)
# Two outer corrections, one pressure correction each, as in the bundled
# PIMPLE tutorial. The tighter 2x2 bootstrap remains separately audited.
path = case/'system/fvSolution'
path.write_text(path.read_text().replace('nCorrectors 2;', 'nCorrectors 1;').replace('tolerance 1e-8; relTol .02;', 'tolerance 1e-7; relTol .02;'))
report = {'shape':shape.tolist(),'min':low.tolist(),'max':high.tolist(),'step':step.tolist(),
          'start':args.start,'end':args.end,'interval':args.interval,
          'field':'smoke','meaning':'Actual transported scalar samples from the transient local URANS solve'}
(case/'recording.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
