// An open-bottom cylinder along the track (+X). Looking through its near side
// lets the exterior camera orbit outside the tunnel without crossing a lamp.
const float archRadius = 4.85;
const float archPitch = 15.; // 64 bays in the road's 960 m travel cycle.
const float archWidth = .078;
const float tunnelFadeEnd = 70.;
const float tunnelMiss = 10000.;

float archIntersection(vec3 eye, vec3 ray) {
    float a = dot(ray.yz, ray.yz);
    float b = dot(eye.yz, ray.yz);
    float c = dot(eye.yz, eye.yz) - archRadius * archRadius;
    float disc = b*b - a*c;
    if (disc <= 0. || a < 1e-6) return tunnelMiss;
    float t = (-b + sqrt(disc)) / a;
    return t > .015 ? t : tunnelMiss;
}

float distanceToBay(float x, float travel) {
    return abs(mod(x + travel + 2. + archPitch*.5, archPitch) - archPitch*.5);
}

// Distance to the luminous tube measured across the viewing ray. Projecting
// the axial offset keeps a round emitter's apparent thickness at grazing angles.
float archDistance(vec3 wall, vec3 ray, float travel) {
    float axial = distanceToBay(wall.x, travel);
    float radial = abs(dot(ray.yz, wall.yz / archRadius));
    float projected = axial * radial / max(length(vec2(ray.x, radial)), .001);
    // The diffuser has a rounded end recessed in the vertical lining.
    return length(vec2(projected, min(wall.y-(archWidth+.025),0.)));
}

float tunnelVisibility(float depth) {
    return 1. - smoothstep(5., tunnelFadeEnd, depth);
}

float lampEnd(float height) {
    return smoothstep(.012, .095, height);
}

// Sample the same lamps along a surface's reflected ray. A rough finish
// spreads the highlight and lowers its peak while retaining its energy.
vec3 archRadiance(vec3 origin, vec3 ray, float roughness, float travel) {
    float t = archIntersection(origin, ray);
    vec3 hit = origin + t * ray;
    if (t >= tunnelFadeEnd || hit.y <= 0.) return vec3(0.);
    float d = archDistance(hit, ray, travel);
    float spread = .32 * min(t, 25.) * roughness * roughness;
    float width = length(vec3(archWidth, spread, min(.36, .5*fwidth(d))));
    float offset = d/width;
    float light = 6.8 * archWidth/width * exp2(-1.4*offset*offset);
    return vec3(.92,.965,1.) * light * tunnelVisibility(t) * lampEnd(hit.y);
}
