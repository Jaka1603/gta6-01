// PALMBAY HEAT — people.js: player character + pedestrians.
// Low-poly capsule figures with walk cycles and flee behaviour.
const THREE = window.THREE;
import { CFG, rng } from './config.js';

const SHIRTS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xecf0f1, 0x1abc9c, 0xfd79a8];
const PANTS = [0x2c3e50, 0x34495e, 0x7f8c8d, 0x5d4037, 0x1a1a2e];

export function makePerson(shirt, pants, skin = 0xd9a066) {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  // torso
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.55, 4, 8), shirtMat
  );
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);
  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), skinMat);
  head.position.y = 1.72;
  head.castShadow = true;
  g.add(head);
  // hair cap
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x2a1a10 })
  );
  hair.position.y = 1.76;
  g.add(hair);
  // legs
  const legGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.75, 6);
  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.set(-0.16, 0.38, 0);
  const legR = new THREE.Mesh(legGeo, pantsMat);
  legR.position.set(0.16, 0.38, 0);
  g.add(legL, legR);
  // arms
  const armGeo = new THREE.CylinderGeometry(0.09, 0.1, 0.6, 6);
  const armL = new THREE.Mesh(armGeo, shirtMat);
  armL.position.set(-0.44, 1.1, 0);
  const armR = new THREE.Mesh(armGeo, shirtMat);
  armR.position.set(0.44, 1.1, 0);
  g.add(armL, armR);
  g.userData = {
    legL, legR, armL, armR, walkPhase: Math.random() * 6,
    speed: 0, heading: 0, fleeing: false,
  };
  return g;
}

export function heroPerson() {
  // Dario Venn: teal shirt, dark jeans, gold chain vibe via shirt colour
  const p = makePerson(0x16a085, 0x2c3e50, 0xc98a5a);
  p.userData.hero = true;
  return p;
}

export class Pedestrians {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.peds = [];
    this.group = new THREE.Group();
    scene.add(this.group);
  }
  spawn(n) {
    for (let i = 0; i < n; i++) {
      const p = makePerson(
        SHIRTS[Math.floor(this.rand() * SHIRTS.length)],
        PANTS[Math.floor(this.rand() * PANTS.length)]
      );
      p.position.set((this.rand() * 2 - 1) * 190, 0, (this.rand() * 2 - 1) * 190);
      p.userData.heading = this.rand() * Math.PI * 2;
      p.userData.speed = 1.2 + this.rand() * 1.4;
      p.userData.wait = 0;
      this.group.add(p);
      this.peds.push(p);
    }
  }
  fleeFrom(x, z, radius = 18) {
    for (const p of this.peds) {
      const dx = p.position.x - x, dz = p.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d < radius) {
        p.userData.fleeing = true;
        p.userData.heading = Math.atan2(dx, dz);
        p.userData.speed = 4.5;
        p.userData.fleeTimer = 3;
      }
    }
  }
  update(dt) {
    for (const p of this.peds) {
      const u = p.userData;
      if (u.fleeTimer !== undefined) {
        u.fleeTimer -= dt;
        if (u.fleeTimer <= 0) {
          u.fleeing = false; u.speed = 1.2 + this.rand() * 1.4;
          u.fleeTimer = undefined;
        }
      }
      if (u.wait > 0) { u.wait -= dt; continue; }
      // wander: occasionally change heading / pause
      if (this.rand() < dt * 0.08) {
        if (this.rand() < 0.3) u.wait = 1 + this.rand() * 3;
        else u.heading += (this.rand() - 0.5) * 1.6;
      }
      const vx = Math.sin(u.heading) * u.speed;
      const vz = Math.cos(u.heading) * u.speed;
      p.position.x += vx * dt;
      p.position.z += vz * dt;
      p.position.x = Math.max(-205, Math.min(205, p.position.x));
      p.position.z = Math.max(-205, Math.min(205, p.position.z));
      p.rotation.y = u.heading;
      // walk cycle
      u.walkPhase += dt * u.speed * 3.2;
      const s = Math.sin(u.walkPhase) * 0.55;
      u.legL.rotation.x = s;
      u.legR.rotation.x = -s;
      u.armL.rotation.x = -s * 0.7;
      u.armR.rotation.x = s * 0.7;
    }
  }
}
