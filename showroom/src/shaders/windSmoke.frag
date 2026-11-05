precision highp sampler3D;
uniform sampler3D uFlow;
uniform sampler3D uPassages;
uniform sampler3D uContactMask;
uniform sampler3D uWake;
uniform vec4 uWakeWeights;
uniform vec3 uWakeMin;
uniform vec3 uWakeSize;
uniform float uWakeActive;
uniform vec2 uSurfaceDecode;
uniform vec4 uFlowScale;
uniform vec4 uFlowBias;
uniform sampler3D uNoise;
uniform sampler2D uBodyDepth;
uniform vec3 uFlowMin;
uniform vec3 uFlowSize;
uniform vec4 uDepthViewport;
uniform vec2 uDepthProjection;
uniform float uTravel;
uniform float uSpeed;
uniform float uExposure;
uniform float uHead;
uniform float uTail;
uniform float uPhysical;
uniform float uStrength;
uniform float uStepSize;
in vec3 vEntry;
flat in vec4 vLow;
flat in vec3 vHigh;
out vec4 fragColor;

vec4 field(vec3 p) {
    // Quintic interpolation keeps both velocity and acceleration continuous
    // as the advected texture crosses lattice cells, without extra samples.
    vec3 f = fract(p);
    f = f*f*f*(f*(f*6.-15.)+10.);
    return texture(uNoise,(floor(p)+f+.5)/32.);
}

// Approximate the shutter integral along the advected coordinate. High-speed
// detail becomes soft motion rather than flashing at the display frame rate.
vec4 advectedNoise(vec3 p, float frequency) {
    float radius = uExposure*frequency*.288675;
    if (radius<.08) return field(p);
    vec3 offset = vec3(radius,0.,0.);
    return .5*(field(p-offset)+field(p+offset));
}

float waveFilter(float frequency) {
    float width = max(.0001,uExposure*.68*frequency*.5);
    return sin(width)/width;
}

// The field transports inlet coordinates around solid vehicle boundaries.
// Continuous density is evaluated in these coordinates, so its texture bends
// with the flow rather than sliding straight through an authored smoke ribbon.
vec4 medium(vec3 p) {
    vec3 uvw = (p-uFlowMin)/uFlowSize;
    vec4 flow = texture(uFlow,uvw)*uFlowScale+uFlowBias;
    // The sampled CFD grid can miss thin glass, skin and floor panels. The
    // conservative mesh boundary also excludes these surfaces at every angle;
    // the camera depth pass separately stops rays at the exact visible mesh.
    vec3 surface = texture(uContactMask,uvw).rgb;
    float distance = min(flow.a,surface.b*uSurfaceDecode.x+uSurfaceDecode.y);
    if (distance<.003 || p.y<.025 || flow.x>uHead+.15) return vec4(0.);
    vec2 passage = texture(uPassages,uvw).rg;
    // Sample the checked local-URANS concentration at the actual world point.
    // Geometry exclusion above and the exact depth stop remain unwarped.
    vec3 wakeUVW = (p-uWakeMin)/uWakeSize;
    float resolvedWake = uWakeActive*smoothstep(2.65,3.1,-p.x)
        *smoothstep(0.,.04,wakeUVW.x)
        *(1.-smoothstep(.90,1.,wakeUVW.y))
        *(1.-smoothstep(.90,1.,abs(wakeUVW.z*2.-1.)));
    if (resolvedWake>0.) {
        float computed = dot(texture(uWake,wakeUVW),uWakeWeights);
        passage.r = mix(passage.r,computed,resolvedWake);
    }
    float wake = smoothstep(1.6,4.8,-p.x);
    float phase = flow.x-uTravel;
    vec2 inlet = flow.yz;
    float downstream = 1.-smoothstep(-2.2,1.5,p.x);
    // Deflected inlet coordinates identify smoke that has met the vehicle.
    // Waves grow along that region and persist into its wake; the inlet stays
    // fine and even. The retarded phase convects each crest downstream.
    float deflected = smoothstep(.035,.32,length(p.yz-flow.yz));
    float wakeEnvelope = exp(-pow((p.y-.8)/1.1,2.)-pow(p.z/1.6,2.));
    float disturbed = mix(downstream*max(deflected,wake*wakeEnvelope),smoothstep(.025,.55,passage.g),uPhysical);
    float developed = 1.-smoothstep(1.8,3.0,p.x);
    float amplitude = developed*disturbed*(.025+.10*downstream+.12*wake)*smoothstep(.015,.12,distance)*(1.-resolvedWake);
    float wave = (flow.x-uTravel*.68)*2.+flow.z*.8;
    inlet.x += amplitude*(.74*sin(wave)*waveFilter(2.)+.26*sin(wave*1.71+flow.z*.6)*waveFilter(3.42));
    inlet.y += amplitude*.32*cos(wave*.86+flow.y*1.5)*waveFilter(1.72);
    vec4 drift = advectedNoise(vec3(phase*.48,inlet*2.4),.48);
    inlet += (drift.gb-.5)*(.008+.04*disturbed)*(1.-.85*resolvedWake);
    // The cross-section is a steady, continuous feed. Its broad density profile
    // follows inlet labels around the car without being switched by travel time.
    // Only fine detail advects: squaring moving broad noise made the whole sheet
    // brighten and nearly disappear in successive packets.
    float profile = smoothstep(.22,.78,field(vec3(1.17,inlet.x*5.5,inlet.y*1.4)).r);
    vec4 billow = advectedNoise(vec3(phase*.45,inlet.x*6.,inlet.y*3.),.45);
    vec4 detail = advectedNoise(vec3(phase*.65,inlet.x*12.,inlet.y*7.)+billow.rgb*.35,.65);
    float cloud = smoothstep(.25,.75,.35*billow.r+.65*detail.b);
    float detailContrast = mix(.18,.55,developed*disturbed)*exp(-max(0.,flow.x-18.)*.08);
    float textureDensity = (.40+1.10*profile)*(1.+detailContrast*(cloud-.5));
    float plume = exp(-.9*pow((inlet.x-.64)/.52,2.)-.65*pow(inlet.y/1.10,2.));
    float contact = exp(-distance/.18);
    float surfaceFade = smoothstep(.003,.028,distance);
    float leading = smoothstep(-.12,.65,uHead-flow.x);
    float trailing = uTail<0. ? 1. : smoothstep(-.15,.65,flow.x-uTail);
    float inletFade = smoothstep(0.,.34,uFlowMin.x+uFlowSize.x-p.x);
    float outletFade = smoothstep(0.,.85,p.x-uFlowMin.x);
    float edgeFade = 1.-smoothstep(1.75,2.14,abs(p.z));
    // The conservative concentration still comes solely from the inlet solve.
    // An inlet-coordinate visibility mask emphasizes the smoke aimed at the
    // vehicle. It is a display transfer function, not a new CFD source solve.
    // Since it follows inlet labels, it bends with the same traced material.
    float sourceEnvelope = exp(-1.3*pow((flow.y-.48)/.44,2.)-1.1*pow(flow.z/1.00,2.));
    float concentration = mix(plume,passage.r,uPhysical);
    // Restore the earlier soft shell and duct layers as an optical treatment.
    // Confine the extra thickness to the body and actual opening marks, cap it,
    // and gate it with the same concentration/arrival/shutoff as the main smoke.
    // These marks are display geometry, not pressure or a second smoke source.
    vec2 duct = surface.rg;
    float ductLayer = duct.r*(1.-smoothstep(.16,.5,distance));
    float layer = min(1.,.65*contact+.75*ductLayer);
    float layerTexture = .88+.12*cloud;
    float density = concentration*(.68*sourceEnvelope*textureDensity+layer*(2.6-.45*duct.g)*layerTexture);
    float extinction = density*surfaceFade*leading*trailing*inletFade*outletFade*edgeFade;
    float illumination = clamp(.84+mix(.10,.26,disturbed)*(detail.g-.5)-.045*contact,.35,.96);
    vec3 scatter = mix(vec3(.20,.24,.26),vec3(.96,.98,1.),illumination);
    if (contact>.12) {
        vec3 lit = (p+normalize(vec3(3.,6.,-4.))*.18-uFlowMin)/uFlowSize;
        float visibility = smoothstep(-.01,.07,texture(uFlow,lit).a*uFlowScale.w+uFlowBias.w);
        scatter *= .88+.12*visibility;
    }
    return vec4(scatter,extinction);
}

void main() {
    vec3 ray = normalize(vEntry-cameraPosition);
    vec3 target = mix(vLow.xyz,vHigh,greaterThanEqual(ray,vec3(0.)));
    vec3 d = abs(target-vEntry)/max(abs(ray),vec3(.00001));
    float thickness = min(d.x,min(d.y,d.z));
    vec2 uv = (gl_FragCoord.xy-uDepthViewport.xy)/uDepthViewport.zw;
    float depth = texture(uBodyDepth,uv).r;
    float viewDepth = uDepthProjection.y/(2.*depth-1.+uDepthProjection.x);
    float surfaceDistance = viewDepth/max(.0001,-(viewMatrix*vec4(ray,0.)).z);
    float entry = length(vEntry-cameraPosition);
    thickness = min(thickness,surfaceDistance-entry);
    if (thickness<=0.) discard;
    // All slabs share this camera-ray quadrature; neither density nor sample
    // phase restarts at a slab face, avoiding vertical seams during motion.
    float last = entry+thickness;
    float bin = floor(entry/uStepSize)*uStepSize;
    float jitter = fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
    float transmittance = 1.;
    vec3 light = vec3(0.);
    for (int i=0;i<192;i++) {
        if (bin>=last || transmittance<.025) break;
        float start = max(entry,bin), end = min(last,bin+uStepSize);
        float interval = end-start;
        float sampleT = clamp(bin+uStepSize*mix(.43,.57,jitter),start,end);
        vec4 mist = medium(vEntry+ray*(sampleT-entry));
        float alpha = 1.-exp(-mist.a*interval*uStrength);
        light += transmittance*mist.rgb*alpha;
        transmittance *= 1.-alpha;
        bin += uStepSize;
    }
    float alpha = 1.-transmittance;
    if (alpha<.002) discard;
    fragColor = vec4(light/alpha,alpha);
}
