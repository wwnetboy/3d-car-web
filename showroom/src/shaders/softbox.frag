varying vec2 vUv;
uniform float uPower;
void main() {
    vec2 p = vUv*2. - 1.;
    float edge = 1. - max(pow(abs(p.x), 7.), pow(abs(p.y), 3.5));
    float diffuser = smoothstep(0., .89, edge);
    float ramp = mix(.46, 1., smoothstep(-1., .5, p.y));
    gl_FragColor = vec4(vec3(.95,1.,1.025) * uPower * ramp, diffuser);
}
