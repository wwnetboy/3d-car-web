in vec4 aLow;
in vec3 aHigh;
out vec3 vEntry;
flat out vec4 vLow;
flat out vec3 vHigh;

void main() {
    vLow = aLow;
    vHigh = aHigh;
    vEntry = mix(aLow.xyz, aHigh, position + .5);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vEntry, 1.);
}
