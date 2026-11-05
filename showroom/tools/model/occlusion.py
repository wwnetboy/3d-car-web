"""Bake smooth, short-range vertex visibility against the assembled car in world space."""
import struct
import sys

import numpy as np
from embreex.mesh_construction import TriangleMesh
from embreex.rtcore_scene import EmbreeScene


def visibility(position, normal, indices):
    scene = EmbreeScene()
    TriangleMesh(scene, position, indices)
    n = normal / np.linalg.norm(normal, axis=1, keepdims=True)
    # Offset into the normal hemisphere to clear the originating smooth triangle.
    origins = np.ascontiguousarray(position + np.float32(0.0035) * n)
    radius = np.float32(0.46)
    openness = np.zeros(len(n), dtype=np.float32)
    total_weight = np.zeros_like(openness)
    # A fixed, bilaterally mirrored world-space Fibonacci sphere avoids random
    # noise at vertex/material seams. Cosine weights select each local hemisphere.
    pairs = 88
    golden_angle = np.pi * (3 - np.sqrt(5))
    for i in range(pairs):
        z = (i + 0.5) / pairs
        radial = np.sqrt(1 - z * z)
        x = radial * np.cos(i * golden_angle)
        y = radial * np.sin(i * golden_angle)
        for side in (-1, 1):
            direction = np.float32([x, y, side * z])
            weight = n[:, 0] * direction[0] + n[:, 1] * direction[1] + n[:, 2] * direction[2]
            facing = weight > 0
            distance = scene.run(origins[facing], direction[None, :], dists=radius, query='DISTANCE')
            # Reject numerical self-hits. Smooth falloff avoids a contact cutoff.
            t = np.where(distance < 0.001, radius, distance) / radius
            openness[facing] += weight[facing] * t * t * (3 - 2 * t)
            total_weight[facing] += weight[facing]
    return np.rint(255 * np.clip(openness / total_weight, 0, 1)).astype(np.uint8)


if __name__ == '__main__':
    stream = sys.stdin.buffer
    vertex_count, index_count = struct.unpack('<II', stream.read(8))
    position = np.frombuffer(stream.read(vertex_count * 12), '<f4').reshape(-1, 3)
    normal = np.frombuffer(stream.read(vertex_count * 12), '<f4').reshape(-1, 3)
    indices = np.frombuffer(stream.read(index_count * 4), '<i4').reshape(-1, 3)
    sys.stdout.buffer.write(visibility(position, normal, indices).tobytes())
