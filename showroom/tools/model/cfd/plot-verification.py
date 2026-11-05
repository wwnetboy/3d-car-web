"""Standalone audit figure. Uses the host matplotlib, not the CFD dependency path."""
import json, pathlib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=pathlib.Path(__file__).resolve().parents[3]
report=json.loads((root/'public/flow/verification.json').read_text())
fig,axs=plt.subplots(1,2,figsize=(11,4),layout='constrained')
colors=['#798797','#197f78','#d08a32']
for case,color in zip(report['cases'],colors):
    speed=[sum(p[k]**2 for k in ['U_0','U_1','U_2'])**.5 for p in case['probes'][5:8]]
    axs[0].plot([1,0,-1],speed,'o-',color=color,label=f"{case['cells']:,} cells")
axs[0].axhline(120/3.6,color='#b8c2ca',ls='--',label='Freestream: 33.33 m/s')
axs[0].set(title='Underbody velocity: grid sensitivity',xlabel='X position (m), nose towards +X',ylabel='Speed (m/s)',ylim=(31,36))
axs[0].legend(frameon=False,fontsize=8)
for run,color in zip(report['washout']['runs'],colors):
    axs[1].plot(run['time'],run['smokeIntegral'],color=color,label=f"dt = {run['dt']} s")
axs[1].set(title='Smoke shutoff: monotone removal',xlabel='Time after inlet shutoff (s)',ylabel='Concentration-weighted volume (m³)',yscale='log',ylim=(1,110))
axs[1].legend(frameon=False,fontsize=8)
for ax in axs:
    ax.grid(alpha=.18);ax.spines[['top','right']].set_visible(False)
fig.suptitle('120 km/h display-mesh CFD — numerical verification, not vehicle validation',fontsize=12)
target=root/'tools/model/cfd/verification'
fig.savefig(target.with_suffix('.png'),dpi=160)
fig.savefig(target.with_suffix('.svg'))
print(target.with_suffix('.png'))
