import { articulateCrawler, deflectSurfaces, easeBetween, tiltPropulsion } from './articulation.js';
import { startWelcomeScene } from './welcome-scene.js';
import {
  AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color,
  DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer,
} from './three.js';

const motion = matchMedia('(prefers-reduced-motion: no-preference)');
const elements = [...document.querySelectorAll('[data-cad]')];
const viewers = new Map();
const modelBytes = new Map();
const welcome = document.querySelector('.welcome');
const arrivals = new Map(elements.filter(element => element.dataset.arrival).map(element =>
  [element, document.getElementById(element.dataset.arrival)]));
const clamp = value => Math.max(0, Math.min(1, value));
const point = new Vector3();
const tangent = new Vector3();

async function fetchModel(name) {
  const response = await fetch(new URL(name + '.mesh.gz', import.meta.url));
  if (!response.ok) throw new Error('Could not load CAD mesh');
  let bytes = await response.arrayBuffer();
  const magic = new Uint8Array(bytes, 0, 2);
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = await new Response(stream).arrayBuffer();
  }

  return bytes;
}

async function loadModel(name) {
  if (!modelBytes.has(name)) modelBytes.set(name, fetchModel(name));
  const bytes = await modelBytes.get(name);
  const length = new DataView(bytes).getUint32(0, true);
  const parts = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 4, length)));
  let offset = 4 + Math.ceil(length / 4) * 4;
  const assembly = new Group();
  const pods = {front: new Group(), rear: new Group()};
  if (name === 'crawler') {
    // The pivots align the front and rear brackets with the center ring.
    pods.front.position.set(.43, .482, 0);
    pods.rear.position.set(-.43, .482, 0);
    assembly.add(pods.front, pods.rear);
  }
  const belts = new Map();
  const sprockets = [];
  const controlSurfaces = new Map();
  const tiltPods = new Map();
  const rotors = new Map();

  for (const part of parts) {
    const packed = new Int16Array(bytes, offset, part.vertices * 3);
    offset += Math.ceil(packed.byteLength / 4) * 4;
    const indices = new Uint32Array(bytes, offset, part.indices);
    offset += indices.byteLength;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(packed, value => value / 8192), 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    const isPropeller = part.name.startsWith('E02_prop_');
    const material = new MeshStandardMaterial({
      color: new Color(...part.color),
      roughness: .72,
      metalness: .12,
      side: DoubleSide,
      transparent: isPropeller,
      opacity: isPropeller ? .23 : 1,
      depthWrite: !isPropeller,
    });
    const mesh = new Mesh(geometry, material);
    mesh.position.fromArray(part.center);
    const pod = pods[part.pod];
    if (part.tiltPod) {
      let mount = tiltPods.get(part.tiltPod);
      if (!mount) {
        mount = new Group();
        mount.position.fromArray(part.tiltPivot);
        tiltPods.set(part.tiltPod, mount);
        assembly.add(mount);
      }
      mesh.position.sub(mount.position);
      mount.add(mesh);
      if (isPropeller) {
        const rotor = buildRotor(mesh);
        rotors.set(part.tiltPod, rotor);
        mount.add(rotor);
      }
    } else if (pod) {
      mesh.position.sub(pod.position);
      pod.add(mesh);
    } else {
      assembly.add(mesh);
    }

    const link = part.name.match(/^([FR]_link_\d+)_(\d+)$/);
    if (link) {
      if (!belts.has(link[1])) belts.set(link[1], []);
      belts.get(link[1]).push({index: Number(link[2]), mesh});
    }
    if (part.name.includes('sprocket')) sprockets.push(mesh);
    if (/^P(?:24_aileron|31_rudder|33_elevator)_/.test(part.name)) controlSurfaces.set(part.name, mesh);
  }

  const tracks = [...belts.values()].map(links => {
    links.sort((first, second) => first.index - second.index);
    const centers = links.map(({mesh}) => mesh.position.clone());
    const curve = new CatmullRomCurve3(centers, true, 'catmullrom');
    const bottom = centers.reduce((lowest, center, index) => center.y < centers[lowest].y ? index : lowest, 0);
    const direction = -Math.sign(curve.getTangent(bottom / links.length).x);
    for (const [index, link] of links.entries()) {
      const original = curve.getTangent(index / links.length);
      link.angle = Math.atan2(original.y, original.x);
    }
    return {links, curve, direction};
  });
  return {assembly, tracks, sprockets, controlSurfaces, pods, tiltPods, rotors};
}

function buildRotor(envelope) {
  envelope.geometry.computeBoundingBox();
  const {min, max} = envelope.geometry.boundingBox;
  const radius = (max.x - min.x) / 2;
  const blade = new BufferGeometry();
  // The CAD disk is a clearance envelope. Use two stylized blades inside it.
  const profile = [
    .06, 0, -.035, .54, 0, -.14, .91, 0, -.12, .97, 0, -.04,
    .80, 0, .044, .30, 0, .094, .06, 0, .04,
  ];
  blade.setAttribute('position', new BufferAttribute(Float32Array.from(profile, point => point * radius), 3));
  blade.setIndex([0, 1, 5, 0, 5, 6, 1, 2, 4, 1, 4, 5, 2, 3, 4]);
  blade.computeVertexNormals();
  const material = new MeshStandardMaterial({color: 0x375879, side: DoubleSide, roughness: .52, metalness: .26});
  const rotor = new Group();
  rotor.position.copy(envelope.position);
  rotor.position.y += .006;
  const opposite = new Mesh(blade, material);
  opposite.rotation.y = Math.PI;
  rotor.add(new Mesh(blade, material), opposite);
  return rotor;
}

function driveCrawler(model, amount) {
  const distance = 2.1 * amount;
  model.assembly.position.x = distance - 1.05;
  rollTracks(model, distance);
  const turn = Math.sin(amount * 2 * Math.PI);
  const ripple = Math.sin(amount * 3 * Math.PI) * Math.sin(amount * Math.PI);
  model.assembly.rotation.y = turn * .13;
  articulateCrawler(model, turn * .34, ripple * .25, ripple * .15);
}

function rollTracks(model, distance) {
  for (const {links, curve, direction} of model.tracks) {
    const travel = direction * distance / curve.getLength();
    for (const [index, {mesh, angle}] of links.entries()) {
      const phase = ((index / links.length + travel) % 1 + 1) % 1;
      mesh.position.copy(curve.getPoint(phase, point));
      curve.getTangent(phase, tangent);
      mesh.rotation.z = Math.atan2(tangent.y, tangent.x) - angle;
    }
  }
  for (const sprocket of model.sprockets) sprocket.rotation.z = -distance / .24;
}

function render(viewer, bounds, amount) {
  const {element, model, camera, renderer, scene, name} = viewer;
  if (!bounds.width || !bounds.height) return;

  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (viewer.width !== width || viewer.height !== height) {
    renderer.setSize(width, height, false);
    const halfWidth = name === 'crawler' ? 2.8 : 3.32;
    const halfHeight = halfWidth * height / width;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    viewer.width = width;
    viewer.height = height;
  }

  if (name === 'crawler') {
    driveCrawler(model, amount);
    viewer.shadow.position.x = model.assembly.position.x;
  } else {
    const lift = easeBetween(amount, .03, .38);
    const cruise = easeBetween(amount, .24, .72);
    const bankPhase = (amount - .46) * 2 * Math.PI;
    const bank = cruise * .34 * Math.sin(bankPhase);
    const pitch = lift * .16 - cruise * .22;
    model.assembly.position.set(-.38 + .76 * cruise, -.58 + 1.11 * lift, 0);
    model.assembly.rotation.set(bank, -.16 + .28 * cruise, pitch, 'YZX');
    tiltPropulsion(model, cruise, amount * 8);
    deflectSurfaces(model, cruise * .43 * Math.cos(bankPhase), -bank * .76, pitch * cruise);
    const label = element.querySelector('[data-flight-mode]');
    const flightMode = cruise >= .99 ? '02 / FIXED WING' : cruise > .01 ? '02 / TRANSITION' : '02 / HOVER';
    if (label.textContent !== flightMode) label.textContent = flightMode;
  }
  renderer.render(scene, camera);
  element.classList.add('cad-ready');
}

function travelToNextSection(element, bounds, arrival) {
  if (!motion.matches) return 0;
  const landing = arrival.getBoundingClientRect();
  const travel = clamp((innerHeight * .86 - landing.top) / (innerHeight * .60));
  const eased = travel * travel * (3 - 2 * travel);
  const scale = 1 - .42 * eased;
  const laneX = landing.left + landing.width * (innerWidth > 680 ? .75 : .5);
  const laneY = landing.top + landing.height / 2;
  const x = (laneX - bounds.left - bounds.width * .5) * eased;
  const y = (laneY - bounds.top - bounds.height * .5) * eased;
  element.style.setProperty('--arrival-x', `${x}px`);
  element.style.setProperty('--arrival-y', `${y}px`);
  element.style.setProperty('--arrival-scale', scale.toFixed(4));
  return y;
}

let scheduled = false;
function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (welcome.open) return;
    for (const element of elements) {
      const bounds = element.getBoundingClientRect();
      const viewer = viewers.get(element);
      const offset = travelToNextSection(element, bounds, arrivals.get(element));
      const visible = bounds.bottom + offset > 0 && bounds.top + offset < innerHeight;
      if (!visible && (!viewer || viewer.width)) continue;

      const start = Math.min(innerHeight * .84, bounds.top + scrollY);
      const scrollAmount = clamp((start - bounds.top) / (start + bounds.height * .13));
      const amount = motion.matches ? scrollAmount : .5;
      element.style.setProperty('--cad-progress', amount.toFixed(4));
      if (viewer) render(viewer, bounds, amount);
    }
  });
}

function crawlerShadow() {
  const image = document.createElement('canvas');
  image.width = image.height = 64;
  const context = image.getContext('2d');
  const falloff = context.createRadialGradient(32, 32, 7, 32, 32, 31);
  falloff.addColorStop(0, '#1d2f4857');
  falloff.addColorStop(.55, '#1d2f482b');
  falloff.addColorStop(1, '#1d2f4800');
  context.fillStyle = falloff;
  context.fillRect(0, 0, 64, 64);
  const surface = new Mesh(new PlaneGeometry(4.5, 1.95), new MeshBasicMaterial({
    map: new CanvasTexture(image), transparent: true, depthWrite: false,
  }));
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = -.002;
  return surface;
}

async function startViewer(element) {
  const name = element.dataset.cad;
  const canvas = element.querySelector('canvas');
  let renderer;
  try {
    const model = await loadModel(name);
    renderer = new WebGLRenderer({canvas, alpha: true, antialias: true});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    const scene = new Scene();
    const camera = new OrthographicCamera(-3, 3, 2, -2, .1, 40);
    camera.position.set(...(name === 'crawler' ? [3.7, 2.3, 6.5] : [4.5, 5.3, 7]));
    camera.lookAt(0, name === 'crawler' ? .6 : 0, 0);
    scene.add(model.assembly, new HemisphereLight(0xe7f0ff, 0x647087, 1.9), new AmbientLight(0xf0f3ff, .4));
    const key = new DirectionalLight(0xfff5e6, 2.1);
    key.position.set(-3, 6, 4);
    scene.add(key);
    const shadow = name === 'crawler' ? crawlerShadow() : null;
    if (shadow) scene.add(shadow);

    viewers.set(element, {element, model, camera, renderer, scene, name, shadow});
    canvas.addEventListener('webglcontextlost', () => {
      viewers.delete(element);
      element.classList.remove('cad-ready');
    }, {once: true});
    scheduleRender();
  } catch {
    renderer?.dispose();
  }
}

const observer = new IntersectionObserver(entries => {
  for (const {target, isIntersecting} of entries) {
    if (!isIntersecting) continue;
    observer.unobserve(target);
    startViewer(target);
  }
}, {rootMargin: '320px'});
elements.forEach(element => observer.observe(element));
scheduleRender();
addEventListener('scroll', scheduleRender, {passive: true});
addEventListener('resize', scheduleRender);
document.addEventListener('visibilitychange', scheduleRender);
welcome.addEventListener('close', scheduleRender);
if (welcome.open) startWelcomeScene(welcome, loadModel, rollTracks, crawlerShadow, motion);
