import { articulateCrawler, deflectSurfaces, easeBetween, tiltPropulsion } from './articulation.js';
import {
  BoxGeometry, CatmullRomCurve3, CylinderGeometry, DirectionalLight, Group, HemisphereLight,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera,
  RingGeometry, Scene, Vector3, WebGLRenderer,
} from './three.js';

const turn = 2 * Math.PI;
const driveRoute = new CatmullRomCurve3([
  [-3.1, 0, .65], [-2.42, 0, -1.92], [-.48, 0, -2.8], [2.47, 0, -1.97],
  [1.54, 0, -.36], [-.53, 0, .72], [-.92, 0, 2.73], [-2.68, 0, 2.25],
].map(point => new Vector3(...point)), true);
const flightRoute = new CatmullRomCurve3([
  [3.36, 2.22, -1.05], [2.25, 2.84, -3.11], [-.74, 2.68, -3.38], [-3.59, 2.24, -1.59],
  [-2.68, 1.77, 1.68], [-.23, 2.58, 2.87], [2.63, 2.32, 1.5], [2.06, 1.81, -.53],
].map(point => new Vector3(...point)), true);

const direction = new Vector3();
const ahead = new Vector3();
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const smooth = t => t * t * (3 - 2 * t);
const wrap = progress => progress - Math.floor(progress);
const pickupPoints = [[3.43, 1.50], [2.48, 2.72]];
const pickupSequence = [
  [0, 0, .93, 0], [.19, 0, .14, 0], [.28, 0, .14, 1],
  [.42, 0, 1.04, 1], [.62, 1, 1.04, 1], [.77, 1, .14, 1],
  [.86, 1, .14, 0], [1, 1, .93, 0],
];

function followRoute(route, progress, position) {
  const offset = wrap(progress);
  route.getPointAt(offset, position);
  route.getTangentAt(offset, direction);
  route.getTangentAt(wrap(offset + .023), ahead);
  const heading = Math.atan2(-direction.z, direction.x);
  const change = Math.atan2(-ahead.z, ahead.x) - heading;
  const turnAhead = Math.atan2(Math.sin(change), Math.cos(change));
  return {heading, turnAhead};
}

function driveRover(rover, shadow, seconds, rollTracks) {
  const time = seconds / 26.3;
  const distance = .14 + time + .033 * Math.sin(time * turn * 2);
  const {heading, turnAhead} = followRoute(driveRoute, distance, rover.assembly.position);
  rover.assembly.rotation.y = heading;
  const terrain = Math.sin(seconds * 1.3 + .6) * .64 + Math.sin(seconds * 2.2) * .36;
  articulateCrawler(rover, clamp(turnAhead * 1.26, -.48, .48), terrain * .27, terrain * .16);
  rollTracks(rover, distance * driveRoute.getLength() / rover.assembly.scale.x);
  shadow.position.x = rover.assembly.position.x;
  shadow.position.z = rover.assembly.position.z;
  shadow.rotation.z = heading;
}

function flyAircraft(aircraft, shadow, seconds) {
  const phase = wrap(seconds / 19.4);
  const progress = easeBetween(phase, .13, .88);
  const lift = easeBetween(phase, .02, .18) * (1 - easeBetween(phase, .87, .99));
  const cruise = easeBetween(phase, .16, .32) * (1 - easeBetween(phase, .73, .88));
  const {heading, turnAhead} = followRoute(flightRoute, progress, aircraft.assembly.position);
  const yaw = cruise * clamp(turnAhead * 1.6, -.4, .4);
  const bank = cruise * clamp(-turnAhead * 2.3, -.57, .57);
  const pitch = cruise * clamp(Math.atan2(direction.y, Math.hypot(direction.x, direction.z)), -.27, .27);
  // The CAD landing gear touches the platform at this model height.
  aircraft.assembly.position.y = .32 + lift * (aircraft.assembly.position.y - .32);
  const future = flightRoute.getTangentAt(wrap(progress + .046), direction);
  const futureChange = Math.atan2(-future.z, future.x) - Math.atan2(-ahead.z, ahead.x);
  const futureTurn = Math.atan2(Math.sin(futureChange), Math.cos(futureChange));
  const futureBank = clamp(-futureTurn * 2.3, -.57, .57);
  const roll = cruise * clamp((futureBank - clamp(-turnAhead * 2.3, -.57, .57)) * 2.8, -.53, .53);
  aircraft.assembly.rotation.set(bank, heading, pitch, 'YZX');
  tiltPropulsion(aircraft, cruise, seconds * 7);
  deflectSurfaces(aircraft, roll, yaw, pitch);
  shadow.position.x = aircraft.assembly.position.x;
  shadow.position.z = aircraft.assembly.position.z;
}

function operateArm(arm, cargo, seconds) {
  const time = seconds / 11.4;
  const progress = wrap(time);
  const [from, to] = Math.floor(time) % 2 ? [pickupPoints[1], pickupPoints[0]] : pickupPoints;
  const endIndex = pickupSequence.findIndex(state => state[0] > progress);
  const [startTime, startTravel, startHeight, startGrip] = pickupSequence[endIndex - 1];
  const [endTime, endTravel, endHeight, endGrip] = pickupSequence[endIndex];
  const eased = smooth((progress - startTime) / (endTime - startTime));
  const travel = startTravel + (endTravel - startTravel) * eased;
  const height = startHeight + (endHeight - startHeight) * eased;
  const grip = startGrip + (endGrip - startGrip) * eased;
  const x = from[0] + (to[0] - from[0]) * travel;
  const z = from[1] + (to[1] - from[1]) * travel;
  const dx = x - arm.pedestal.position.x;
  const dz = z - arm.pedestal.position.z;

  // Solve the two links to keep the jaws vertical over the workpiece.
  const reach = Math.hypot(dx, dz) / arm.pedestal.scale.x;
  const rise = height / arm.pedestal.scale.x + .49 - arm.shoulder.position.y;
  const upper = arm.elbow.position.x;
  const lower = arm.wrist.position.x;
  const elbow = -Math.acos(clamp((reach ** 2 + rise ** 2 - upper ** 2 - lower ** 2) / (2 * upper * lower), -1, 1));
  const shoulder = Math.atan2(rise, reach) - Math.atan2(lower * Math.sin(elbow), upper + lower * Math.cos(elbow));
  arm.swivel.rotation.y = Math.atan2(-dz, dx);
  arm.shoulder.rotation.z = shoulder;
  arm.elbow.rotation.z = elbow;
  arm.wrist.rotation.z = -Math.PI / 2 - shoulder - elbow;
  for (const [side, finger] of arm.fingers) finger.rotation.z = side * (.45 - .42 * grip);

  if (progress >= .28 && progress < .77) cargo.position.set(x, height, z);
  else {
    const resting = progress < .28 ? from : to;
    cargo.position.set(resting[0], .14, resting[1]);
  }
}

function buildArm() {
  const pedestal = new Group();
  const swivel = new Group();
  const shoulder = new Group();
  const elbow = new Group();
  const wrist = new Group();
  const steel = new MeshStandardMaterial({color: 0x94a8bf, metalness: .44, roughness: .45});
  const graphite = new MeshStandardMaterial({color: 0x25344b, metalness: .25, roughness: .57});
  const brass = new MeshStandardMaterial({color: 0xc08a43, metalness: .36, roughness: .47});

  function cylinder(parent, radius, height, material, x, y, z, crosswise = false) {
    const mesh = new Mesh(new CylinderGeometry(radius, radius, height, 28), material);
    mesh.position.set(x, y, z);
    if (crosswise) mesh.rotation.x = Math.PI / 2;
    parent.add(mesh);
  }

  function box(parent, width, height, depth, material, x, y, z) {
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  cylinder(pedestal, .74, .21, graphite, 0, .105, 0);
  cylinder(swivel, .55, .21, steel, 0, .28, 0);
  cylinder(swivel, .4, .35, graphite, 0, .49, 0);
  shoulder.position.y = .72;
  elbow.position.x = 1.24;
  wrist.position.x = 1.04;
  shoulder.add(elbow);
  elbow.add(wrist);
  swivel.add(shoulder);
  pedestal.add(swivel);

  for (const [joint, length, radius] of [[shoulder, 1.24, .25], [elbow, 1.04, .19]]) {
    cylinder(joint, radius, .52, graphite, 0, 0, 0, true);
    cylinder(joint, radius * .73, .56, brass, 0, 0, 0, true);
    for (const side of [-1, 1]) {
      box(joint, length, .18, .095, steel, length / 2, 0, .17 * side);
    }
  }

  cylinder(wrist, .14, .29, steel, 0, 0, 0, true);
  box(wrist, .26, .22, .30, graphite, .15, 0, 0);
  const fingers = [-1, 1].map(side => {
    const finger = new Group();
    finger.position.set(.28, 0, 0);
    box(finger, .20, .075, .09, steel, .10, side * .18, 0);
    box(finger, .11, .07, .09, brass, .22, side * .18, 0).rotation.z = side * -.36;
    wrist.add(finger);
    return [side, finger];
  });

  return {pedestal, swivel, shoulder, elbow, wrist, fingers};
}

function buildPlatform() {
  const platform = new Group();
  const base = new Mesh(new CylinderGeometry(4.8, 4.98, .30, 128),
    new MeshStandardMaterial({color: 0x172234, roughness: .81, metalness: .19}));
  base.position.y = -.16;
  platform.add(base);

  for (const [radius, width, color] of [[4.76, .025, 0x537aa8], [3.08, .013, 0x46617d], [2.88, .013, 0x364a60], [1.0, .015, 0x537aa8]]) {
    const ring = new Mesh(new RingGeometry(radius - width, radius, 128),
      new MeshBasicMaterial({color}));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -.006;
    platform.add(ring);
  }

  const markerMaterial = new MeshBasicMaterial({color: 0x537aa8});
  const markerGeometry = new BoxGeometry(.17, .012, .025);
  for (let step = 0; step < 32; step++) {
    const angle = step / 32 * turn;
    const marker = new Mesh(markerGeometry, markerMaterial);
    marker.position.set(4.53 * Math.cos(angle), .001, 4.53 * Math.sin(angle));
    marker.rotation.y = -angle;
    platform.add(marker);
  }
  return platform;
}

export async function startWelcomeScene(dialog, loadModel, rollTracks, makeShadow, motion) {
  const stage = dialog.querySelector('.welcome-stage');
  const canvas = stage.querySelector('canvas');
  let renderer;
  let frame;
  let scene;
  let stopped = false;

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    removeEventListener('resize', schedule);
    document.removeEventListener('visibilitychange', schedule);
    motion.removeEventListener('change', schedule);
    dialog.removeEventListener('close', stop);
    if (scene) {
      scene.traverse(node => {
        node.geometry?.dispose();
        node.material?.map?.dispose();
        node.material?.dispose();
      });
    }
    renderer?.dispose();
    stage.classList.remove('scene-ready');
  }

  function schedule() {
    if (!stopped && !frame && !document.hidden) frame = requestAnimationFrame(draw);
  }

  let rover, aircraft, roverShadow, aircraftShadow, arm, cargo, camera;
  let width = 0;
  let height = 0;
  let previous;
  let elapsed = 0;

  function draw(time) {
    frame = undefined;
    if (stopped || !dialog.open || document.hidden) {
      previous = undefined;
      return;
    }
    if (motion.matches && previous !== undefined) elapsed += Math.min(66, time - previous);
    previous = motion.matches ? time : undefined;

    if (stage.clientWidth !== width || stage.clientHeight !== height) {
      width = stage.clientWidth;
      height = stage.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const ratio = width / height;
      const halfWidth = Math.max(5.75, 4.82 * ratio);
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.top = halfWidth / ratio;
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
    }

    const seconds = elapsed / 1000;
    driveRover(rover, roverShadow, seconds, rollTracks);
    flyAircraft(aircraft, aircraftShadow, seconds);
    operateArm(arm, cargo, seconds);

    const view = .93 + .14 * Math.sin(seconds * .25);
    camera.position.set(12.5 * Math.cos(view), 8.6, 12.5 * Math.sin(view));
    camera.lookAt(0, .75, 0);
    renderer.render(scene, camera);
    stage.classList.add('scene-ready');
    if (motion.matches) schedule();
  }

  dialog.addEventListener('close', stop, {once: true});
  try {
    [rover, aircraft] = await Promise.all([loadModel('crawler'), loadModel('tricopter')]);
    if (stopped || !dialog.open) return;

    renderer = new WebGLRenderer({canvas, alpha: true, antialias: true});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    canvas.addEventListener('webglcontextlost', stop, {once: true});
    scene = new Scene();
    camera = new OrthographicCamera(-5, 5, 4, -4, .1, 60);
    rover.assembly.scale.setScalar(.65);
    aircraft.assembly.scale.setScalar(.63);
    roverShadow = makeShadow();
    roverShadow.scale.setScalar(.64);
    roverShadow.position.y = .003;
    aircraftShadow = makeShadow();
    aircraftShadow.scale.setScalar(.67);
    aircraftShadow.position.y = .002;
    aircraftShadow.material.opacity = .62;
    arm = buildArm();
    arm.pedestal.scale.setScalar(.78);
    arm.pedestal.position.set(2.14, 0, 1.30);
    cargo = new Mesh(new BoxGeometry(.25, .27, .25),
      new MeshStandardMaterial({color: 0x69d9ee, emissive: 0x176172, emissiveIntensity: .52, roughness: .42}));
    const docks = new Group();
    const dockMaterial = new MeshBasicMaterial({color: 0x45788e});
    for (const [x, z] of pickupPoints) {
      const dock = new Mesh(new RingGeometry(.24, .26, 32), dockMaterial);
      dock.rotation.x = -Math.PI / 2;
      dock.position.set(x, .002, z);
      docks.add(dock);
    }
    const key = new DirectionalLight(0xffedd8, 2.55);
    key.position.set(-4, 8, 5);
    const rim = new DirectionalLight(0x98bcff, 1.55);
    rim.position.set(4, 4, -6);
    scene.add(buildPlatform(), docks, cargo, roverShadow, aircraftShadow, arm.pedestal, rover.assembly, aircraft.assembly,
      new HemisphereLight(0xc8ddff, 0x455270, 1.5), key, rim);
    addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
    motion.addEventListener('change', schedule);
    schedule();
  } catch {
    stop();
  }
}
