"""Select the resolved fluid domain, excluding isolated gradient stencils.

Cells identified by OpenFOAM's determinant check have insufficient independent
fluid neighbours in sub-grid slits. Their volume becomes unresolved wall;
every removed cell and its count is retained in the audit.
"""
import json, pathlib, re, sys
case = pathlib.Path(sys.argv[1])
text = (case/'log.checkMesh').read_text(errors='replace')
match = re.search(r'Cells with small determinant.*number of cells:\s*(\d+)', text)
bad_count = int(match[1]) if match else 0
count = int(re.search(r'cells:\s*(\d+)', text)[1])
if bad_count == 0:
    print('No unresolved stencils')
    sys.exit(0)
assert bad_count / count < .005, 'Refine the mesh instead of removing more than 0.5% of cells'
sets = case/'constant/polyMesh/sets'
raw = (sets/'underdeterminedCells').read_text()
bad = set(map(int, re.search(r'\n\d+\s*\((.*?)\)', raw, re.S)[1].split()))
assert len(bad) == bad_count
keep = [str(i) for i in range(count) if i not in bad]
(sets/'resolvedFluid').write_text('FoamFile { version 2.0; format ascii; class cellSet; object resolvedFluid; }\n'+
                                str(len(keep))+'\n(\n'+'\n'.join(keep)+'\n)\n')
audit = case/'pruned-stencils.json'
records = json.loads(audit.read_text()) if audit.exists() else []
records.append({'cellsBefore':count, 'removedCount':bad_count,'removedFraction':bad_count/count, 'cellIndices':sorted(bad)})
audit.write_text(json.dumps(records,indent=2)+'\n')
print(f'Selecting {len(keep)} cells; {bad_count} unresolved stencils excluded')
sys.exit(2)
