// PALMBAY HEAT — gang.js (v2): the Palm Bay street gang + the busted
// scene. One consistent gang colour (green, Grove-style) for every
// member: green shirt, green bandana, dark jeans. Some carry rifles,
// some pistols — weapons are real geometry, held at the right scale in
// the right hand. The busted scene: a dark-uniform officer beside the
// police car, suspect standing hands-up in front of it.
const THREE = window.THREE;
import { PALETTE } from './config.js';
import { makePerson, attachWeapon } from './people.js';

export function makeGangMember(withRifle) {
  const p = makePerson(
    PALETTE.gangGreen,
    0x2c3e50,
    PALETTE.skinTones[Math.floor(Math.random() * PALETTE.skinTones.length)],
    { hairColor: 0x1a1a1a }
  );
  // green bandana: a band around the head
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.09, 12, 1, true),
    new THREE.MeshStandardMaterial({
      color: PALETTE.gangBandana, roughness: 0.9, side: THREE.DoubleSide,
    })
  );
  band.position.y = 1.62;
  p.add(band);
  // a bandana tail hanging at the back of the head
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.16, 0.02),
    band.material
  );
  tail.position.set(0, 1.52, -0.15);
  tail.rotation.x = 0.2;
  p.add(tail);
  attachWeapon(p, withRifle ? 'rifle' : 'pistol');
  // aiming pose: right arm raised forward, left arm across (rifle)
  if (withRifle) {
    p.userData.armR.rotation.x = -1.35;
    p.userData.armL.rotation.x = -0.9;
  } else {
    p.userData.armR.rotation.x = -1.5;
  }
  p.userData.gang = true;
  return p;
}

// A loose group of gang members on a sidewalk / street corner.
// positions: [{x, z, heading, rifle}]
export function stageGang(scene, positions) {
  const group = new THREE.Group();
  group.name = 'gang';
  for (const pos of positions) {
    const m = makeGangMember(!!pos.rifle);
    m.position.set(pos.x, 0, pos.z);
    m.rotation.y = pos.heading || 0;
    group.add(m);
  }
  scene.add(group);
  return group;
}

// Police officer in dark navy uniform + cap, standing at attention.
export function makeOfficer() {
  const p = makePerson(
    PALETTE.policeNavy,
    0x14141c,
    PALETTE.skinTones[1],
    { hairColor: 0x111111 }
  );
  // cap: flat disc + brim
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.16, 0.07, 12),
    new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.6 })
  );
  cap.position.y = 1.74;
  p.add(cap);
  const brim = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.02, 0.12),
    cap.material
  );
  brim.position.set(0, 1.71, 0.14);
  p.add(brim);
  // badge: small gold disc on the chest
  const badge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.02, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8a030, metalness: 0.9, roughness: 0.3 })
  );
  badge.rotation.x = Math.PI / 2;
  badge.position.set(-0.1, 1.32, 0.12);
  p.add(badge);
  p.userData.officer = true;
  return p;
}

// Busted scene: officer beside the police car, suspect hands-up in
// front of it. Returns { officer, suspect }.
export function stageBusted(scene, carPos, carHeading) {
  const group = new THREE.Group();
  group.name = 'busted';
  const officer = makeOfficer();
  // officer stands at the car's driver side, facing the suspect
  const side = new THREE.Vector3(1, 0, 0).applyEuler(
    new THREE.Euler(0, carHeading, 0)
  );
  officer.position.copy(carPos).addScaledVector(side, 2.2);
  officer.position.z += 1.5;
  officer.rotation.y = carHeading + Math.PI / 2;
  group.add(officer);
  const suspect = makePerson(0xe74c3c, 0x34495e, 0xd9a066);
  const fwd = new THREE.Vector3(0, 0, 1).applyEuler(
    new THREE.Euler(0, carHeading, 0)
  );
  suspect.position.copy(carPos).addScaledVector(fwd, 4.5);
  suspect.rotation.y = carHeading + Math.PI;
  // hands up: both arms swung up-forward
  suspect.userData.armL.rotation.x = -2.7;
  suspect.userData.armR.rotation.x = -2.7;
  group.add(suspect);
  scene.add(group);
  return { group, officer, suspect };
}
