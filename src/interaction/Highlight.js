import * as THREE from 'three';

export class BlockHighlight {
    constructor(scene) {
        // A slightly larger-than-1x1x1 box to prevent z-fighting
        const geometry = new THREE.BoxGeometry(1.002, 1.002, 1.002);
        // Wireframe material so we only see the edges
        const material = new THREE.LineBasicMaterial({
            color: 0x000000,
            linewidth: 2,
        });

        // Use EdgesGeometry to only show outline instead of all triangles
        const edges = new THREE.EdgesGeometry(geometry);
        this.mesh = new THREE.LineSegments(edges, material);

        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    update(intersect) {
        if (intersect) {
            this.mesh.visible = true;
            // Add 0.5 because the BlockHighlight's anchor is center, but voxel anchor is 0,0,0
            this.mesh.position.copy(intersect.position).addScalar(0.5);
        } else {
            this.mesh.visible = false;
        }
    }
}
