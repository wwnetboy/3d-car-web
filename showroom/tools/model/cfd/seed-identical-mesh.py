"""Warm-start volume values while retaining the target's exact inlet conditions."""
import pathlib, sys
from foam_io import latest
source=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2]);time=latest(source)
assert (source/'constant/polyMesh/owner').read_bytes()==(target/'constant/polyMesh/owner').read_bytes()
for name in ['smoke','age','inletY','inletZ']:
    previous=(time/name).read_text();initial=(target/'0'/name).read_text()
    (target/'0'/name).write_text(previous.split('boundaryField',1)[0]+'boundaryField'+initial.split('boundaryField',1)[1])
