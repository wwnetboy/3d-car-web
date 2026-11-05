"""Small ASCII OpenFOAM reader for the reproducible offline audits."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'.artifacts/cfd-python'))
import numpy as np

def header(name, kind='dictionary'):
    return f'FoamFile {{ version 2.0; format ascii; class {kind}; object {name}; }}\n'

def list_body(text):
    match = re.search(r'\n\s*(\d+)\s*\n\s*\((.*)\)\s*(?:;\s*)?(?://[^\n]*\n?)*\s*$', text, re.S)
    if not match:
        # Foam lists can be followed by the decorative footer.
        text = re.sub(r'//[^\n]*', '', text)
        match = re.search(r'\n\s*(\d+)\s*\n\s*\((.*)\)\s*;?\s*$', text, re.S)
    if not match: raise ValueError('Not an ASCII Foam list')
    return int(match[1]), match[2]

def field_values(path):
    text = pathlib.Path(path).read_text()
    match = re.search(r'internalField\s+nonuniform\s+List<(scalar|vector)>\s+(\d+)\s*\((.*?)\)\s*;', text, re.S)
    if not match:
        uniform = re.search(r'internalField\s+uniform\s+([^;]+);', text)
        if not uniform: raise ValueError(str(path))
        return np.fromstring(uniform[1].replace('(', '').replace(')', ''), sep=' ')
    data = np.fromstring(match[3].replace('(', ' ').replace(')', ' '), sep=' ')
    return data.reshape(int(match[2]), 3) if match[1] == 'vector' else data

def patches(case):
    text = (pathlib.Path(case)/'constant/polyMesh/boundary').read_text()
    result = {}
    for name, body in re.findall(r'(\w+)\s*\{([^{}]*)\}', text):
        start = re.search(r'startFace\s+(\d+)', body)
        count = re.search(r'nFaces\s+(\d+)', body)
        if start and count: result[name] = {'start':int(start[1]), 'count':int(count[1]),'body':body}
    return result

def boundary_centres(case, patch='inlet'):
    mesh = pathlib.Path(case)/'constant/polyMesh'
    n, body = list_body((mesh/'points').read_text())
    pts = np.fromstring(body.replace('(', ' ').replace(')', ' '), sep=' ').reshape(n,3)
    p = patches(case)[patch]
    n, body = list_body((mesh/'faces').read_text())
    face_lines = body.strip().splitlines()[p['start']:p['start']+p['count']]
    return np.array([pts[np.fromstring(line[line.index('(')+1:line.index(')')],sep=' ',dtype=int)].mean(axis=0) for line in face_lines])

def scalar_list(values):
    return 'nonuniform List<scalar>\n'+str(len(values))+'\n(\n'+'\n'.join(f'{v:.9g}' for v in values)+'\n)'

def latest(case):
    dirs = [p for p in pathlib.Path(case).iterdir() if p.is_dir() and re.fullmatch(r'\d+(?:\.\d+)?',p.name)]
    return max(dirs,key=lambda p:float(p.name))
