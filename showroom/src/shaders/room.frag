varying vec3 vWorld;
uniform float uDay;
uniform float uWindRoom;
uniform float uFine;
uniform float uRoad;
uniform float uTravel;
#include <drive_arches>

float wheel(vec2 p, vec2 center) {
    vec2 d = (p - center) / vec2(.43, .21);
    return exp(-dot(d,d) * 1.65);
}

float contactShadow(vec2 p) {
    vec2 body = abs((p-vec2(.01,0.))/vec2(2.77,1.17));
    float contact = exp(-(pow(body.x,4.)+pow(body.y,4.))*2.);
    float diffuse = exp(-dot(p/vec2(2.8,1.48),p/vec2(2.8,1.48)));
    float rubber = wheel(p,vec2(1.64,1.02))+wheel(p,vec2(1.64,-1.02))+wheel(p,vec2(-1.37,1.06))+wheel(p,vec2(-1.37,-1.06));
    return clamp(diffuse*.25 + contact*.70 + rubber*(.25+uFine*.28),0.,.96);
}

float stripe(float d, float width) {
    return 1. - smoothstep(width,width+max(.009,fwidth(d)),abs(d));
}

const vec3 tunnelHaze = vec3(.045,.061,.104);
const vec3 wallFoot = vec3(.097,.115,.138);

// Soft irradiance from a lamp foot on both sides of the wall/floor joint.
vec3 footWash(float bay, float offset) {
    vec2 r = vec2(bay/.83,offset/.70);
    float falloff = 1./(1.+dot(r,r));
    return vec3(.115,.148,.185)*falloff*falloff;
}

vec3 roadSurface(vec3 p, vec3 eye) {
    float x = p.x+uTravel;
    float bay = distanceToBay(p.x,uTravel);
    // One asphalt plane continues past the edge stripe to the foot of the wall.
    vec3 col = vec3(.165,.188,.204) + .035*exp(-bay*bay*.046);
    float dash = 1.-smoothstep(1.6,1.78,abs(mod(x+4.,8.)-4.));
    float lane = stripe(abs(p.z)-2.25,.052)*dash;
    col = mix(col,vec3(.72,.78,.765),.86*lane);
    float edgeMark = stripe(abs(p.z)-3.7,.024);
    col = mix(col,vec3(.45,.49,.50),.40*edgeMark);
    col *= 1.-.08*stripe(mod(x+8.,16.)-8.,.012);

    float toWall = abs(archRadius-abs(p.z));
    float visibleSide = 1.-smoothstep(archRadius-.28,archRadius,eye.z*sign(p.z));
    col = mix(col,wallFoot,visibleSide*exp(-toWall*5.5));
    col += visibleSide*footWash(bay,toWall);
    return col * (1.-contactShadow(p.xz)*.93);
}

vec3 tunnelLining(vec3 p, vec3 ray) {
    float bay = distanceToBay(p.x,uTravel);
    float d = archDistance(p,ray,uTravel);
    float aa = clamp(fwidth(d), .008, .14);
    float core = 1.-smoothstep(archWidth-aa*.5, archWidth+aa*.5, d);
    vec3 shell = mix(vec3(.078,.096,.145),vec3(.12,.15,.214),clamp(p.y/archRadius,0.,1.));
    float rise = smoothstep(0.,.32,p.y);
    vec3 diffuse = mix(footWash(bay,0.),vec3(.16,.21,.29)*exp(-bay*1.7),rise);
    vec3 halo = vec3(.12,.15,.19)*exp(-d*3.) + vec3(.27,.30,.34)*exp(-d*d/.030);
    vec3 lining = mix(wallFoot,shell,rise) + diffuse + halo*smoothstep(0.,.15,p.y);
    return mix(lining,vec3(.98,.991,1.),core*lampEnd(p.y));
}

vec3 testStraight(vec3 eye, vec3 ray) {
    float ground = ray.y < -.0001 ? -eye.y/ray.y : tunnelMiss;
    float wall = archIntersection(eye,ray);
    float depth = min(ground,wall);
    if (depth >= tunnelFadeEnd) return tunnelHaze;
    vec3 p = eye + ray*depth;
    vec3 col = ground < wall ? roadSurface(p,eye) : tunnelLining(p,ray);
    return mix(tunnelHaze,col,tunnelVisibility(depth));
}

float floorHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx)*.1031);
    q += dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
}

float floorNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.-2.*f);
    return mix(mix(floorHash(i),floorHash(i+vec2(1.,0.)),f.x),
               mix(floorHash(i+vec2(0.,1.)),floorHash(i+1.),f.x),f.y);
}

vec3 concreteFinish(vec2 p, float glow, float shadow, float day) {
    // Sealed, semi-polished concrete: low-contrast mineral variation, with
    // footprint-filtered micrograin instead of a broad frosted reflection.
    float footprint = max(length(dFdx(p)),length(dFdy(p)));
    float fine = 1.-smoothstep(.004,.024,footprint);
    float grain = (floorNoise(p*95.)-.5)*fine;
    float mineral = floorNoise(p*2.8)-.5;
    vec3 concrete = mix(vec3(.10,.112,.12),vec3(.57,.59,.60),day);
    concrete += mix(vec3(.10,.11,.115),vec3(.18,.18,.17),day)*glow;
    concrete += grain*.006+mineral*.010;
    return concrete*(1.-shadow*mix(.93,.88,day));
}

vec3 windMovingFloor(vec2 p, float glow, float shadow) {
    // The observer follows the car: paint and mineral texture advect toward -X.
    // Lighting and the contact shadow stay attached to the stationary vehicle.
    vec2 moving = p + vec2(uTravel,0.);
    vec3 col = concreteFinish(moving,glow,shadow,0.);
    float dash = 1.-smoothstep(.65,.72,abs(mod(moving.x+1.5,3.)-1.5));
    float guide = stripe(abs(p.y)-1.68,.022)*dash;
    col = mix(col,vec3(.46,.49,.50),guide*.65*(1.-shadow*.7));
    return col;
}

void main() {
    vec3 ray = normalize(vWorld - cameraPosition);
    vec2 origin = cameraPosition.xz;
    float a = max(dot(ray.xz,ray.xz), .00001);
    float b = dot(origin, ray.xz);
    float wc = (-b + sqrt(max(0., b*b - a*(dot(origin,origin) - 196.)))) / a;
    vec3 wall = cameraPosition + ray * wc;
    float angle = atan(wall.z, wall.x);
    float arc = angle * 14.;
    float delta = atan(sin(angle-2.58),cos(angle-2.58));
    float pool = exp(-delta*delta*4.5);
    float cove = exp(-pow(abs((wall.y-.3)/3.9), 2.));
    float wash = exp(-pow(abs((wall.y-2.4)/5.), 2.)) * pool;
    vec3 darkWall = vec3(.039,.046,.053) + vec3(.036,.042,.049)*cove + vec3(.144,.163,.173)*wash;
    vec3 lightWall = vec3(.67,.70,.70) + vec3(.19,.19,.18)*cove + .045*wash;
    vec3 col = mix(darkWall, lightWall, uDay);
    // A black wind-tunnel backdrop separates illuminated smoke from the room.
    // Its brightness is independent of the car's studio lighting.
    vec3 windBackground = vec3(.004,.005,.007);

    // A recessed continuous luminaire along the curved back wall.
    float channel = wall.y - (1.32+.026*(arc-34.));
    float belt = exp(-abs(channel)*26.);
    float spill = exp(-abs(channel)*2.8);
    float end = smoothstep(.54,1.,pool);
    float section = fract(arc/7.);
    float joint = smoothstep(0.,.0025,section)*smoothstep(0.,.0025,1.-section);
    col += end*joint*(belt*vec3(.12,.135,.142) + spill*.023)*(1.-uDay*.35);
    col -= (1.-joint)*.012*end*smoothstep(0.,1.,wall.y);

    float fg = -cameraPosition.y / min(ray.y, -.000001);
    if (ray.y < 0. && fg < wc) {
        vec2 p = origin + ray.xz*fg;
        float radius = length(p);
        float edge = smoothstep(8.5,14.,radius);
        float glow = exp(-dot((p-vec2(-.8,1.1))/vec2(6.,4.), (p-vec2(-.8,1.1))/vec2(6.,4.)));
        float shadow = contactShadow(p);
        vec3 floorColor = concreteFinish(p,glow,shadow,uDay);
        col = mix(floorColor,mix(darkWall,lightWall,uDay),edge);
        if (uWindRoom > .0001)
            windBackground = mix(windMovingFloor(p,glow,shadow),windBackground,edge);
    }
    col = mix(col,windBackground,uWindRoom);
    if (uRoad > .0001) col = mix(col,testStraight(cameraPosition,ray),uRoad);
    // Display-referred, with sub-LSB dithering to keep the cove free of banding.
    float grain = fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
    gl_FragColor = vec4(col + (grain-.5)*.0055, 1.);
}
