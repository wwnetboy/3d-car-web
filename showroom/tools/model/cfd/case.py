"""Reproducible RANS test cases. Body + fixed covers, rotating wheels, moving road."""
import argparse, json, math, pathlib, shutil
ROOT = pathlib.Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('name')
parser.add_argument('--cell', type=float, default=.48)
parser.add_argument('--speed', type=float, default=120)
args = parser.parse_args()
case = ROOT / '.artifacts/cfd' / args.name
for d in ['0', 'constant/triSurface', 'system']: (case / d).mkdir(parents=True, exist_ok=True)
def write(path, content, kind='dictionary'):
    name = pathlib.Path(path).name
    (case/path).write_text(f'FoamFile {{ version 2.0; format ascii; class {kind}; object {name}; }}\n'+content+'\n')
shutil.copyfile(ROOT/'.artifacts/cfd/geometry/car.stl', case/'constant/triSurface/car.stl')
speed = args.speed / 3.6
velocity = f'(-{speed:.9g} 0 0)'
nc = [math.ceil(n/args.cell) for n in [36,8,16]]
write('system/blockMeshDict', f'''
scale 1;
vertices ((-24 0 -8) (12 0 -8) (12 8 -8) (-24 8 -8) (-24 0 8) (12 0 8) (12 8 8) (-24 8 8));
blocks (hex (0 1 2 3 4 5 6 7) ({' '.join(map(str,nc))}) simpleGrading (1 1 1));
edges ();
boundary (
 inlet {{ type patch; faces ((1 2 6 5)); }}
 outlet {{ type patch; faces ((0 4 7 3)); }}
 ground {{ type wall; faces ((0 1 5 4)); }}
 farfield {{ type symmetryPlane; faces ((3 7 6 2) (0 3 2 1) (4 5 6 7)); }}
);
mergePatchPairs ();
'''.replace('type symmetryPlane;', 'type symmetry;'))
write('system/meshQualityDict', '#includeEtc "caseDicts/mesh/generation/meshQualityDict.cfg"\nmaxNonOrtho 65;')
write('system/snappyHexMeshDict', '''
#includeEtc "caseDicts/mesh/generation/snappyHexMeshDict.cfg"
castellatedMesh true; snap false; addLayers false;
mergePatchFaces false;
geometry {
 car.stl { type triSurfaceMesh; name car; }
 near { type searchableBox; min (-5 -.01 -1.7); max (3.2 1.6 1.7); }
 underbody { type searchableBox; min (-2.9 -.01 -1.4); max (2.9 .23 1.4); }
 wake { type searchableBox; min (-10 0 -2); max (-2 2 2); }
}
castellatedMeshControls {
 maxLocalCells 4000000; maxGlobalCells 5000000; minRefinementCells 0;
 maxLoadUnbalance .1; nCellsBetweenLevels 3; features ();
 refinementSurfaces { car { level (3 3); patchInfo { type wall; } } }
 refinementRegions {
  near { mode inside; levels ((1e15 2)); }
  underbody { mode inside; levels ((1e15 4)); }
  wake { mode inside; levels ((1e15 1)); }
 }
 resolveFeatureAngle 40; locationInMesh (8.123 2.123 3.123);
 allowFreeStandingZoneFaces false;
}
snapControls { nSmoothPatch 3; tolerance 1.5; nSolveIter 30; nRelaxIter 5;
 nFeatureSnapIter 0; implicitFeatureSnap false; explicitFeatureSnap false; }
mergeTolerance 1e-6;
''')
write('system/controlDict', f'''
application simpleFoam;
startFrom latestTime; startTime 0; stopAt endTime; endTime 600; deltaT 1;
writeControl timeStep; writeInterval 100; purgeWrite 2;
writeFormat ascii; writePrecision 9; writeCompression off; timeFormat general; timePrecision 6;
runTimeModifiable true;
functions {{
 force {{ type forceCoeffs; libs ("libforces.dll"); patches ("car_.*");
  rho rhoInf; rhoInf 1.225; CofR (0 0 0); dragDir (-1 0 0); liftDir (0 1 0);
  pitchAxis (0 0 1); magUInf {speed}; lRef 5.44421; Aref 2.5;
  writeControl timeStep; writeInterval 10; log true;
 }}
 yPlus {{ type yPlus; libs ("libfieldFunctionObjects.dll"); writeControl writeTime; }}
}}
''')
write('system/fvSchemes', '''
ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; grad(U) cellLimited Gauss linear 1; }
divSchemes {
 default none; div(phi,U) bounded Gauss upwind;
 div(phi,k) bounded Gauss upwind; div(phi,omega) bounded Gauss upwind;
 div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear limited .5; }
interpolationSchemes { default linear; }
snGradSchemes { default limited .5; }
wallDist { method meshWave; }
''')
write('system/fvSolution', '''
solvers {
 p { solver GAMG; smoother GaussSeidel; tolerance 1e-7; relTol .05; }
 "(U|k|omega)" { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol .1; }
}
SIMPLE { nNonOrthogonalCorrectors 1; consistent no;
 residualControl { p 1e-5; U 1e-5; k 1e-5; omega 1e-5; }
}
relaxationFactors { fields { p .2; } equations { U .4; k .4; omega .4; } }
''')
write('system/decomposeParDict', 'numberOfSubdomains 8; method scotch;')
write('constant/transportProperties', 'transportModel Newtonian;\nnu [0 2 -1 0 0 0 0] 1.5e-5;')
write('constant/turbulenceProperties', 'simulationType RAS;\nRAS { RASModel kOmegaSST; turbulence on; printCoeffs on; }')
wheels = json.loads((ROOT/'.artifacts/cfd/geometry/geometry.json').read_text())['wheels']
wheel_bc = ''
for w in wheels:
    wheel_bc += f'''car_{w['name']} {{ type rotatingWallVelocity; origin ({' '.join(map(str,w['centre']))});
 axis (0 0 -1); omega {speed/w['radius']}; value uniform (0 0 0); }}\n'''
write('0/U', f'''
dimensions [0 1 -1 0 0 0 0]; internalField uniform {velocity};
boundaryField {{
 inlet {{ type fixedValue; value uniform {velocity}; }}
 outlet {{ type inletOutlet; inletValue uniform {velocity}; value uniform {velocity}; }}
 ground {{ type fixedValue; value uniform {velocity}; }}
 farfield {{ type symmetry; }}
 car_body {{ type noSlip; }}
 {wheel_bc}
}}
''', 'volVectorField')
k = 1.5 * (speed*.01)**2
omega = math.sqrt(k)/(.09**.25 * .07 * 5.44421)
for name, dim, initial, wall in [('p','0 2 -2',0,'zeroGradient'), ('k','0 2 -2',k,'kqRWallFunction'),
                                ('omega','0 0 -1',omega,'omegaWallFunction'), ('nut','0 2 -1',0,'nutkWallFunction')]:
    inlet = 'zeroGradient' if name in ['p','nut'] else 'fixedValue'
    outlet = 'fixedValue' if name == 'p' else 'zeroGradient'
    write('0/'+name, f'''
dimensions [{dim} 0 0 0 0]; internalField uniform {initial};
boundaryField {{
 inlet {{ type {inlet}; value uniform {initial}; }}
 outlet {{ type {outlet}; value uniform {initial}; }}
 farfield {{ type symmetry; }}
 "(car_.*|ground)" {{ type {wall}; value uniform {initial}; }}
}}
''', 'volScalarField')
(case/'case.json').write_text(json.dumps({'cell':args.cell, 'kmh':args.speed, 'speed':speed, 'baseCells':nc,
    'movingGround':True,'rotatingWheels':True,'stationaryOuterCovers':True,'turbulence':'kOmegaSST',
    'inletTurbulenceIntensity':.01,'referenceAreaAssumed':2.5,'engineeringDragValidated':False},indent=2))
print(case)
