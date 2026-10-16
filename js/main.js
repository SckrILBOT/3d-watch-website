/**
 * CHRONOS // CALIBRE-01
 * Interactive exploded-view watch experience
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------
const GLB_URL = './assets/watch_calibre.glb';
const DEBUG = new URLSearchParams(location.search).has('debug');
// read through .matches where needed (cheap), so a system change applies on the next frame
const reduceMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

const LAYER_ORDER = [
  'Layer01_Caseback',
  'Layer02_Mainplate',
  'Layer03_MainspringBarrel',
  'Layer04_GearTrain',
  'Layer05_Escapement',
  'Layer06_BalanceWheel',
  'Layer07_SkeletonDial',
  'Layer08_Hands',
  'Layer09_OuterCase',
  'Layer10_SapphireGlass',
];

/**
 * Explode — style of the reference video:
 * glass/bezel lid flies highest first, mechanism fans in the middle with
 * staggered gaps, case base stays low. Slight tilt on floating lid.
 * Axes: glTF Y-up (watch stack along Y).
 */
const EXPLODE_DIR = {
  Layer01_Caseback: -1.15,
  Layer02_Mainplate: -0.55,
  Layer03_MainspringBarrel: 0.05,
  Layer04_GearTrain: 0.28,
  Layer05_Escapement: 0.52,
  Layer06_BalanceWheel: 0.78,
  Layer07_SkeletonDial: 1.12,
  Layer08_Hands: 1.38,
  Layer09_OuterCase: 0.10,
  Layer10_SapphireGlass: 2.0,   // was 2.35: the lifted glass was cut by the top edge
};

/** Per-layer stagger + cinematic tilt (video-like) */
const EXPLODE_STYLE = {
  // lid opens first and farthest
  Layer10_SapphireGlass: { delay: 0.0, k: 1.15, tiltX: 0.16, spinY: 0.04 },
  Layer09_OuterCase:     { delay: 0.02, k: 1.0, tiltX: 0.02, spinY: 0.0 },
  Layer08_Hands:         { delay: 0.08, k: 1.05, tiltX: 0.06, spinY: 0.02 },
  Layer07_SkeletonDial:  { delay: 0.10, k: 1.05, tiltX: 0.08, spinY: 0.03 },
  Layer06_BalanceWheel:  { delay: 0.16, k: 1.0, tiltX: 0.10, spinY: 0.12 },
  Layer05_Escapement:    { delay: 0.18, k: 1.0, tiltX: 0.08, spinY: 0.08 },
  Layer04_GearTrain:     { delay: 0.20, k: 1.0, tiltX: 0.06, spinY: 0.10 },
  Layer03_MainspringBarrel: { delay: 0.22, k: 1.0, tiltX: 0.05, spinY: 0.14 },
  Layer02_Mainplate:     { delay: 0.28, k: 1.0, tiltX: 0.03, spinY: 0.02 },
  Layer01_Caseback:      { delay: 0.32, k: 1.0, tiltX: 0.02, spinY: 0.0 },
};

const HOTSPOTS = [
  {
    id: '01',
    title: 'Заводной барабан',
    body: 'Внутри свёрнута заводная пружина. Она раскручивается медленно, а зубчатый венец снаружи барабана ведёт всю колёсную цепь.',
    specs: [['Запас хода', '72 часа'], ['Венец', '72 зуба'], ['Барабан', 'Розовое золото']],
    // glTF Y-up: blender (x,y,z) → (x, z, -y); positions from blender/movement_gen.py
    anchor: new THREE.Vector3(-0.464, -0.07, -0.464),
    viewDist: 2.2,
    layer: 'Layer03_MainspringBarrel',
  },
  {
    id: '02',
    title: 'Колёсная передача',
    body: 'Большое колесо входит в маленькую трибку следующего, поэтому на каждом шаге скорость растёт, а усилие падает. Так энергия барабана доходит до спуска.',
    specs: [['Зацепления', '72/10, 64/8, 60/8, 60/7'], ['Колёса', 'Розовое золото, трибки из стали'], ['Опоры', 'Рубины в золотых шатонах']],
    anchor: new THREE.Vector3(0.5, -0.01, -0.288),
    viewDist: 2.6,
    layer: 'Layer04_GearTrain',
  },
  {
    id: '03',
    title: 'Анкерный спуск',
    body: 'Вилка держит спусковое колесо и отпускает его на полшага, когда баланс проходит середину, а заодно подталкивает баланс.',
    specs: [['Колесо', '15 зубьев'], ['Палеты', 'Два рубина'], ['Вилка', 'Охватывает 2,5 зуба']],
    anchor: new THREE.Vector3(0.383, 0.045, 0.717),
    viewDist: 1.3,
    layer: 'Layer05_Escapement',
  },
  {
    id: '04',
    title: 'Балансовое колесо',
    body: 'Обод и волосковая пружина задают ритм всех часов: 4 полных колебания в секунду. От упругости пружины зависит, спешат часы или отстают.',
    specs: [['Частота', '4 Гц, 28 800 пк/ч'], ['Обод', 'Glucydur'], ['Пружина', 'Nivarox']],
    anchor: new THREE.Vector3(0.029, 0.075, 0.921),
    viewDist: 1.8,
    layer: 'Layer06_BalanceWheel',
  },
];

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
const state = {
  explode: 0,            // 0..1
  explodeScroll: 0,      // driven by scroll
  explodeManual: null,   // override from slider
  speed: 1,
  paused: false,         // independent of speed: resume restores the chosen speed
  xray: false,
  time: 0,
  ready: false,
  cameraMode: 'scroll', // scroll | inspect
};

// ------------------------------------------------------------------
// DOM
// ------------------------------------------------------------------
const canvas = document.getElementById('webgl');
const loaderEl = document.getElementById('loader');
const loaderFill = document.getElementById('loader-fill');
const loaderPct = document.getElementById('loader-pct');
const explodeRange = document.getElementById('explode-range');
const explodeVal = document.getElementById('explode-val');
const hotspotCard = document.getElementById('hotspot-card');
const partsPop = document.getElementById('parts-pop');
const btnParts = document.getElementById('btn-parts');
const btnPartsLabel = document.getElementById('btn-parts-label');
const btnPause = document.getElementById('btn-pause');
const btnPartExit = document.getElementById('btn-part-exit');

// ------------------------------------------------------------------
// Renderer / Scene / Camera
// ------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;

const scene = new THREE.Scene();
// Warm graphite instead of black. (The post chain tone-maps the background too, so the colour
// on screen comes out darker than this hex; CSS --bg is matched to what is actually rendered.)
const BG_COLOR = 0x2b2927;
scene.background = new THREE.Color(BG_COLOR);
scene.fog = new THREE.FogExp2(BG_COLOR, 0.045);

// Soft warm light behind the watch: a large radial glow that always faces the camera and sits
// behind whatever the camera looks at, so it follows the watch across the screen (hero right,
// cards left/right, a focused part) without any screen-space maths.
const glow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0xb8a48c,          // pale warm cream: lamplight, not orange
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = -1;
  scene.add(mesh);
  return mesh;
})();
const _glowDir = new THREE.Vector3();

/** keep the glow behind the look point, facing the camera, sized to the view */
function updateGlow() {
  const look = controls.target;
  _glowDir.subVectors(look, camera.position);
  const d = _glowDir.length() || 1;
  _glowDir.divideScalar(d);
  glow.position.copy(look).addScaledVector(_glowDir, 6);
  glow.quaternion.copy(camera.quaternion);
  // ~ the same share of the screen at any camera distance
  glow.scale.setScalar((d + 6) * 0.95);
}

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
// The real pose comes from poseAt(0) at boot (see the end of the file), before the first frame.

// Environment (PBR reflections)
const pmrem = new THREE.PMREMGenerator(renderer);
const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = envRT.texture;
// Soften studio reflections so polished metal doesn't blow out
if ('environmentIntensity' in scene) {
  scene.environmentIntensity = 0.45;
}

// Lights — dramatic key + fill + rim
const key = new THREE.DirectionalLight(0xfff2dd, 1.25);
key.position.set(4, -2, 6);
scene.add(key);

const fill = new THREE.DirectionalLight(0xa8c0ff, 0.45);
fill.position.set(-5, 1, 3);
scene.add(fill);

// rim: only a whisper — from the hero camera it mirrors off the bezel at 12 o'clock as a gold halo
const rim = new THREE.DirectionalLight(0xe0c27a, 0.08);
rim.position.set(0, 5, -4);
scene.add(rim);

// Soft under-light so the caseback / lower stack (section 2) is not pitch black
const under = new THREE.DirectionalLight(0x8899bb, 0.35);
under.position.set(0, -6, 1);
scene.add(under);

const ambient = new THREE.AmbientLight(0x404860, 0.22);
scene.add(ambient);

// Soft point lights for jewel sparkle
const p1 = new THREE.PointLight(0xff6688, 0.3, 5); // soft: it left a pink glare spot on the bezel
p1.position.set(0.4, 0.4, 1.2);
scene.add(p1);
const p2 = new THREE.PointLight(0x88aaff, 1.0, 10);
p2.position.set(-1.2, -0.8, 1.5);
scene.add(p2);

// Post-processing — keep bloom subtle so metals don't blow out to white
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.12, 0.35, 0.97 // only real highlights bloom, and softly (strength, radius, threshold)
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Orbit controls (enabled in inspect mode)
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 0.5;  // zoom is only on for a focused part (setPartControls)
controls.maxDistance = 30;
controls.enableZoom = false;   // wheel / pinch must scroll the page, not move the camera (R1)
controls.enablePan = false;
controls.enabled = false;
controls.target.set(0, 0, 0.2);
// OrbitControls sets touch-action:none on the canvas, which kills page scroll by swipe.
// Keep vertical swipes for the page; horizontal drags still orbit.
canvas.style.touchAction = 'pan-y';

// ------------------------------------------------------------------
// Model
// ------------------------------------------------------------------
// The watch stays at the world origin; where it sits on screen is the camera's frame offset.
const watchRoot = new THREE.Group();
scene.add(watchRoot);

const layers = {};          // name -> Object3D
const layersArray = [];     // ordered
let modelReady = false;

function setLoadProgress(p, msg) {
  const pct = Math.round(Math.max(0, Math.min(100, p)));
  loaderFill.style.width = pct + '%';
  loaderPct.textContent = pct + '%';
  if (msg) {
    const el = document.querySelector('.loader-msg');
    if (el) el.textContent = msg;
  }
}

function resolveLayers(root) {
  const found = new Map();
  root.traverse((obj) => {
    const n = obj.name || '';
    // Layer roots may be Group / Object3D / Mesh (empty split parents are Object3D).
    if (n.startsWith('Layer')) {
      found.set(n, obj);
    }
  });

  // Node dump only with ?debug in the URL (it used to print ~470 lines on every load)
  if (DEBUG) {
    console.log('[CHRONOS] Found mesh/group names:');
    root.traverse((o) => {
      if (o.name) console.log(o.isMesh ? '  mesh:' : '  node:', o.name);
    });
  }

  // Map by exact name first
  for (const name of LAYER_ORDER) {
    if (found.has(name)) {
      layers[name] = found.get(name);
    }
  }

  // Fallback: assign remaining by height (world Y/Z after load)
  const missing = LAYER_ORDER.filter((n) => !layers[n]);
  if (missing.length) {
    console.warn('[CHRONOS] Missing layer names, falling back to Z-index sort for:', missing);
    // Collect all meshes without layer assignment
    const unassigned = [];
    root.traverse((o) => {
      if (o.isMesh && !o.name.startsWith('Layer')) {
        // skip if any ancestor is already a layer
        let p = o.parent;
        let isChild = false;
        while (p) {
          if (p.name && p.name.startsWith('Layer')) { isChild = true; break; }
          p = p.parent;
        }
        if (!isChild) unassigned.push(o);
      }
    });
    unassigned.sort((a, b) => {
      const pa = new THREE.Vector3();
      const pb = new THREE.Vector3();
      a.getWorldPosition(pa);
      b.getWorldPosition(pb);
      return pa.z - pb.z;
    });
    missing.forEach((n, i) => {
      if (unassigned[i]) layers[n] = unassigned[i];
    });
    console.warn('[CHRONOS] Fallback assignment done. Present:', Object.keys(layers));
  }

  // Collect base positions
  for (const name of LAYER_ORDER) {
    const obj = layers[name];
    if (!obj) {
      console.error('[CHRONOS] Layer still missing:', name);
      continue;
    }
    // Ensure materials work with bloom / transparency
    obj.traverse((c) => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((m) => {
          if (m.transparent !== undefined && m.opacity < 1) {
            m.transparent = true;
            m.depthWrite = false;
          }
          if (m.name && m.name.includes('Sapphire')) {
            m.transparent = true;
            // Keep glass readable: floor 0.18, cap 0.25 (GLB alpha can arrive at 0.08).
            m.opacity = Math.min(0.25, Math.max(m.opacity, 0.18));
            m.depthWrite = false;
            // Reads as glass, not as a grey disc: strong sheen + clearcoat reflections (set on the
            // loaded material; clones for X-Ray inherit it).
            m.metalness = 0;
            // was 0.04 / 3.0: the studio light strip mirrored in it as a hot streak at 12 o'clock
            m.roughness = 0.32;
            m.envMapIntensity = 0.45;
            m.color.set(0xe8f2ff);
            m.opacity = 0.32;
            m.emissive = new THREE.Color(0x1d2e44); // faint cool glow: glass stays visible on black
            m.emissiveIntensity = 0.7;
          }
          // Main plate: its perlage texture is mapped onto the plate's rim too, where it
          // stretched into a grid of little squares (seen from below and through the caseback
          // window). Plain satin metal instead.
          if (m.name && m.name.includes('Perlage')) {
            m.map = null;
            m.color.set(0xb4b9bf);
            m.metalness = 1;
            m.roughness = 0.34;
            m.needsUpdate = true;
          }
          if (m.name && m.name.includes('Ruby')) {
            m.emissive = new THREE.Color(0x660011);
            m.emissiveIntensity = 0.35;
          }
        });
      }
    });
    layersArray.push({
      name,
      index: LAYER_ORDER.indexOf(name), // 0 = caseback … 9 = glass (click pitch)
      obj,
      basePos: obj.position.clone(),
      baseRot: obj.rotation.clone(),
      explodeOffset: EXPLODE_DIR[name] ?? 0,
      style: EXPLODE_STYLE[name] || { delay: 0.15, k: 1, tiltX: 0, spinY: 0 },
    });
  }

  modelReady = true;
  state.ready = true;
  collectMechParts();
  setLoadProgress(100, 'Калибр синхронизирован');
  setTimeout(showEnter, 450);
  measureKeyStops();
  initScroll();
  initHotspots();
  updateCameraFromScroll(scrollProgress);
}

/**
 * The way in: «Смотреть со звуком» / «Без звука». The click is the gesture browsers need before
 * audio may start, so with sound chosen it plays from the very first scroll.
 * Screenshot scripts open the page with ?debug&enter to skip it.
 */
function showEnter() {
  if (new URLSearchParams(location.search).has('enter')) {
    loaderEl.classList.add('is-done');
    return;
  }
  const box = document.getElementById('loader-enter');
  document.documentElement.classList.add('is-gated'); // no scrolling behind the gate (M3)
  window.scrollTo(0, 0);
  loaderEl.classList.add('is-ready');
  box.hidden = false;
  const enter = (withSound) => {
    setSound(withSound);
    unlockSound();
    document.documentElement.classList.remove('is-gated');
    window.scrollTo(0, 0);
    loaderEl.classList.add('is-done');
    // focus leaves the hidden gate: onto the page, so Tab starts from the top (L2)
    const main = document.getElementById('scroll-root');
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: true });
  };
  document.getElementById('enter-sound').addEventListener('click', () => enter(true), { once: true });
  document.getElementById('enter-mute').addEventListener('click', () => enter(false), { once: true });
  // the visitor's last choice is the default button
  document.getElementById(sound.on ? 'enter-sound' : 'enter-mute').focus({ preventScroll: true });
}

const loader = new GLTFLoader();
setLoadProgress(8, 'Загрузка калибра…');

loader.load(
  GLB_URL,
  (gltf) => {
    setLoadProgress(72, 'Сборка механизма…');
    const root = gltf.scene;
    // Normalize scale if needed
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0 && (maxDim > 8 || maxDim < 1)) {
      const s = 3.2 / maxDim;
      root.scale.setScalar(s);
      console.log('[CHRONOS] Rescaled model by', s, 'maxDim was', maxDim);
    }
    watchRoot.add(root);
    resolveLayers(watchRoot);
  },
  (evt) => {
    if (evt.total) {
      const p = 8 + (evt.loaded / evt.total) * 60;
      setLoadProgress(p, 'Загрузка калибра…');
    } else {
      setLoadProgress(40, 'Загрузка калибра…');
    }
  },
  (err) => {
    console.error('[CHRONOS] GLB load failed', err);
    setLoadProgress(100, 'Ошибка загрузки модели');
    loaderEl.querySelector('.loader-msg').textContent =
      'Не удалось загрузить watch_calibre.glb — проверьте assets/';
    // Do not trap the user on a forever-loader (M4)
    setTimeout(() => loaderEl.classList.add('is-done'), 2200);
    // Keep the page usable and say what happened: texts still reveal, the dead HUD goes away (M7)
    document.body.classList.add('model-failed');
    const banner = document.createElement('div');
    banner.className = 'model-banner';
    banner.setAttribute('role', 'alert');
    banner.textContent = '3D-модель не загрузилась. Проверьте файл assets/watch_calibre.glb и обновите страницу.';
    document.body.appendChild(banner);
    initScroll();
  }
);

// ------------------------------------------------------------------
// Animation loop (live mechanism)
// ------------------------------------------------------------------
const clock = new THREE.Clock();

const mechParts = {
  gearWheels: [],
  handHour: null,
  handMinute: null,
  handSecond: null,
  clockMs: Date.now(),   // virtual wall clock: runs at real speed (×speed), stops on pause (L8)
};

function findDescendant(root, name) {
  if (!root) return null;
  let hit = null;
  root.traverse((o) => {
    if (!hit && o.name === name) hit = o;
  });
  return hit;
}

function collectMechParts() {
  const hands = layers['Layer08_Hands'];
  const find = (layer, name) => findDescendant(layers[layer], name);
  mechParts.barrel = find('Layer03_MainspringBarrel', 'Barrel_Drum');
  mechParts.center = find('Layer04_GearTrain', 'Gear_Center');
  mechParts.third = find('Layer04_GearTrain', 'Gear_Third');
  mechParts.fourth = find('Layer04_GearTrain', 'Gear_Fourth');
  mechParts.escWheel = find('Layer05_Escapement', 'Esc_Wheel');
  mechParts.pallet = find('Layer05_Escapement', 'Esc_Pallet');
  mechParts.balance = find('Layer06_BalanceWheel', 'Bal_Wheel');
  mechParts.gearWheels = [mechParts.center, mechParts.third, mechParts.fourth].filter(Boolean);
  mechParts.handHour = findDescendant(hands, 'Hand_Hour');
  mechParts.handMinute = findDescendant(hands, 'Hand_Minute');
  mechParts.handSecond = findDescendant(hands, 'Hand_Second');
  mechParts.clockMs = Date.now();
  if (DEBUG) {
    console.log('[CHRONOS] mech parts', {
      wheels: mechParts.gearWheels.map((o) => o.name),
      hour: !!mechParts.handHour,
      minute: !!mechParts.handMinute,
      second: !!mechParts.handSecond,
    });
  }
}

// Swiss lever movement, tooth counts from blender/movement_gen.py.
// Every arbor is driven from the escape wheel through the real ratios, so meshing
// teeth stay in each other's gaps. Angles are about glTF Y (= Blender Z, CCW from the dial side).
const MOVEMENT = {
  beatHz: 2.5,          // balance oscillations per second (visual; a real 28 800 is 4 Hz)
  balanceAmp: 2.2,      // rad, ~125° each way
  forkMax: 0.18,        // rad, pallet fork swing (matches FORK_MAX in Blender)
  forkGain: 0.35,       // impulse pin radius / fork length (0.07 / 0.20)
  escHalfStep: Math.PI / 15, // 15-tooth escape wheel advances half a tooth per beat
};
const RATIO = {
  fourth: -7 / 60,                                   // escape pinion 7 / fourth wheel 60
  third: (7 / 60) * (8 / 60),                        // fourth pinion 8 / third wheel 60
  center: -(7 / 60) * (8 / 60) * (8 / 64),           // third pinion 8 / center wheel 64
  barrel: (7 / 60) * (8 / 60) * (8 / 64) * (10 / 72),// center pinion 10 / barrel 72
};

function animateMechanism() {
  if (!modelReady) return;
  const t = state.time;
  const m = MOVEMENT;

  // Balance: free oscillation. Two beats per oscillation, beat k starts at a zero crossing.
  const balAngle = m.balanceAmp * Math.sin(2 * Math.PI * m.beatHz * t);
  if (mechParts.balance) mechParts.balance.rotation.y = balAngle;

  // Pallet fork follows the impulse pin through the centre, then rests on its banking.
  if (mechParts.pallet) {
    mechParts.pallet.rotation.y = -m.forkMax * Math.tanh((balAngle * m.forkGain) / m.forkMax);
  }

  // Escape wheel: locked between beats, quick half-tooth step right after each zero crossing.
  const s = 2 * m.beatHz * t;
  const beat = Math.floor(s);
  const f = Math.min(1, Math.max(0, (s - beat - 0.04) / 0.16));
  const escAngle = m.escHalfStep * (beat + f * f * (3 - 2 * f));
  if (mechParts.escWheel) mechParts.escWheel.rotation.y = escAngle;

  if (mechParts.fourth) mechParts.fourth.rotation.y = escAngle * RATIO.fourth;
  if (mechParts.third) mechParts.third.rotation.y = escAngle * RATIO.third;
  if (mechParts.center) mechParts.center.rotation.y = escAngle * RATIO.center;
  if (mechParts.barrel) mechParts.barrel.rotation.y = escAngle * RATIO.barrel;

  // Hands: independent Hour / Minute / Second, virtual clock honors speed/pause.
  const date = new Date(mechParts.clockMs);
  const sec = date.getSeconds() + date.getMilliseconds() / 1000;
  const min = date.getMinutes() + sec / 60;
  const hr = (date.getHours() % 12) + min / 60;
  // Tip is at local -Z (Blender +Y → glTF -Z). rotation.y = -angle reads as clockwise
  // from above; 12 o'clock is -Z when rotation is 0.
  if (mechParts.handSecond) mechParts.handSecond.rotation.y = -sec * (Math.PI * 2 / 60);
  if (mechParts.handMinute) mechParts.handMinute.rotation.y = -min * (Math.PI * 2 / 60);
  if (mechParts.handHour) mechParts.handHour.rotation.y = -hr * (Math.PI * 2 / 12);
}

// ------------------------------------------------------------------
// Sound: synthesised with Web Audio (no files). On by default (the HUD button / M turns it off,
// and that choice is remembered). Browsers start audio only after a click, key or tap, so the
// context is created on the first such gesture.
//   scroll — a soft ratchet, like winding a crown: one click per stretch of scroll, so it runs
//            faster and louder the faster the page moves
//   click  — a layer lifting off its seat (higher for the upper layers), lower when it sets back
//   whoosh — the air rushing past during the fly-through the watch
// ------------------------------------------------------------------
const sound = {
  on: false,
  ctx: null,
  master: null,
  noise: null,
  lastTick: 0,
  lastClick: 0,

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(this.ctx.destination);
    // 60 ms of white noise, reused for every transient
    const len = Math.round(this.ctx.sampleRate * 0.06);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    return true;
  },

  set(on) {
    this.on = on;
    if (!this.ctx) return; // created on the first click / key / tap (unlock())
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    if (on) {
      this.ctx.resume();
      this.master.gain.linearRampToValueAtTime(0.9, now + 0.15);
    } else {
      this.master.gain.linearRampToValueAtTime(0, now + 0.12); // no pop
    }
  },

  /** a burst of band-passed noise: the "contact" of metal on metal */
  burst(t, freq, q, gain, decay) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + decay + 0.01);
  },

  /** a short ringing partial: the "ping" of a small steel part */
  ring(t, freq, gain, decay) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.01);
  },

  /** one ratchet click; speed 0..1 sets loudness and brightness */
  ratchet(dir, speed) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    // queued right after the previous click, so a big wheel step plays as a quick run of clicks
    const t = Math.max(this.ctx.currentTime, this.lastTick + 0.028);
    if (t - this.ctx.currentTime > 0.15) return; // never lag behind the page
    this.lastTick = t;
    const v = 0.35 + 0.65 * speed;
    const f = (dir > 0 ? 2600 : 2200) * (0.92 + Math.random() * 0.16);
    this.burst(t, f, 7, 0.07 * v, 0.022);
    this.ring(t, f * 1.9, 0.008 * v, 0.03);
  },

  /**
   * a filtered-noise swell lasting `dur` seconds. `away`: the pulling-back variant — same air,
   * but it starts bright and close and falls away low (used when leaving a part)
   */
  whoosh(dur, away = false) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    if (!this.longNoise) {
      const len = Math.round(this.ctx.sampleRate * 2);
      this.longNoise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const ch = this.longNoise.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; ch[i] = last * 6; }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.longNoise;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.Q.value = 0.9;
    const peak = away ? 0.2 : 0.5;     // where the swell is loudest, as a share of dur
    lp.frequency.setValueAtTime(away ? 1300 : 300, t);
    lp.frequency.exponentialRampToValueAtTime(away ? 1900 : 1600, t + dur * peak); // brightest inside
    lp.frequency.exponentialRampToValueAtTime(away ? 180 : 260, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(away ? 0.22 : 0.28, t + dur * peak);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  },

  layerClick(index, lifting) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    let t = this.ctx.currentTime;
    // a fast scroll lifts several layers in one frame: string them out a little
    t = Math.max(t, this.lastClick + 0.035);
    this.lastClick = t;
    const pitch = 1 + index * 0.06;          // upper layers ring higher
    const base = (lifting ? 1400 : 1050) * pitch;
    this.burst(t, base * 1.6, 3, 0.22, 0.05);
    this.ring(t, base, 0.05, lifting ? 0.18 : 0.12);
    this.ring(t, base * 2.76, 0.025, 0.09);   // inharmonic partial: reads as metal, not a bell
  },
};

// Browsers allow audio only after a real gesture (a wheel does not count): start it then
function unlockSound() {
  if (!sound.ctx && !sound.init()) return;
  sound.set(sound.on);
  if (sound.ctx.state === 'running') {
    ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.removeEventListener(ev, unlockSound, true));
  }
}
['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, unlockSound, true));

// scroll ratchet: one click per 70px of page movement, louder when it moves fast
let ratchetY = window.scrollY;
let ratchetAcc = 0;
let ratchetLastT = performance.now();
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  const dy = y - ratchetY;
  ratchetY = y;
  if (flyAuto.active || partFocused) return; // the fly-through has its own sound; a part holds the page
  const now = performance.now();
  const speed = Math.min(1, Math.abs(dy) / Math.max(1, now - ratchetLastT) / 3); // px/ms → 0..1
  ratchetLastT = now;
  ratchetAcc += Math.abs(dy);
  while (ratchetAcc >= 70) {
    ratchetAcc -= 70;
    sound.ratchet(Math.sign(dy), speed);
  }
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (!sound.ctx || !sound.on) return;
  if (document.hidden) sound.ctx.suspend();
  else sound.ctx.resume();
});

function applyExplode(factor) {
  // Video-style axial explode: staggered per layer, slight lid tilt.
  // GLB stack runs along Y (glTF Y-up).
  for (const entry of layersArray) {
    const { obj, basePos, baseRot, explodeOffset, style } = entry;

    // stagger: later layers start opening only after the lid has moved
    const d = style.delay || 0;
    const k = style.k || 1;
    const local = Math.max(0, Math.min(1, (factor - d) / Math.max(0.15, (1 - d))));
    const t = local * local * (3 - 2 * local); // smoothstep

    // sound: a click when the layer lifts off its seat, a lower one when it sets back down
    const lifted = local > 0.06;
    if (entry.lifted !== undefined && lifted !== entry.lifted) sound.layerClick(entry.index, lifted);
    entry.lifted = lifted;

    obj.position.y = basePos.y + explodeOffset * k * t;
    // gentle radial spread, much weaker than Y (keeps the sandwich readable)
    const radial = 0.06 * t;
    obj.position.x = basePos.x * (1 + radial);
    obj.position.z = basePos.z * (1 + radial);

    // cinematic tilt only on X/Z — Y rotation stays with the live mechanism
    obj.rotation.x = baseRot.x + (style.tiltX || 0) * t;
    obj.rotation.z = baseRot.z + (style.spinY || 0) * t * 0.35;
  }
}

// ------------------------------------------------------------------
// Scroll + camera choreography
// ------------------------------------------------------------------
/**
 * Camera fly-through: one key per section, as an orbit around the watch.
 *   az   — degrees around the watch (0 = dial upright, camera on +Z), grows down the page,
 *          so scrolling reads as one continuous flight around the opening calibre
 *   el   — degrees above the dial plane, dist — from the look point
 *   frameX / frameY — where the look point sits on screen, as a share of the viewport
 *          (+X right, +Y up): the watch moves away from the text card without moving in 3D
 * Orbit values are Catmull-Rom splined (the camera never stops at a key); the frame shift
 * holds near each key so the watch rests beside its card and slides between cards.
 */
const CAM_KEYS = [
  // 0 hero: dial readable, watch on the right of the screen, text on the left
  { az: 0, el: 62, dist: 8.6, look: [0, 0.05, 0.15], fov: 36, explode: 0, frameX: 0.16, frameY: 0.03, frameYPortrait: -0.17, distPortrait: 1.22 },
  // 1 shell: glass lifts, camera dives to a 3/4 view (card right → watch left)
  // explode only grows down the page: 0 → 30 → 60 → 85 → 100% (fully open at the finale)
  { az: 38, el: 36, dist: 6.8, look: [0, 0.5, 0], fov: 40, explode: 0.3, frameX: -0.17, frameY: 0, frameYPortrait: -0.17 },
  // 2 energy: low side pass, the gaps between layers open up (card left → watch right)
  { az: 82, el: 22, dist: 7.6, look: [0, 0.4, 0], fov: 40, explode: 0.6, frameX: 0.17, frameY: 0.02, frameYPortrait: -0.17 },
  // (2 → 3 is not an orbit: the camera flies THROUGH the open watch — see flyThroughPose)
  // 3 heart: out the far side, turned back on the whole exploded stack (card right)
  { az: 297, el: 30, dist: 9.2, look: [0, 0.4, 0], fov: 38, explode: 0.85, frameX: -0.17, frameY: 0.05, frameYPortrait: -0.17 },
  // 4 finale: settles into the free-orbit view (card left)
  { az: 320, el: 32, dist: 9.8, look: [0, 0.4, 0], fov: 40, explode: 1.0, frameX: 0.14, frameY: 0.05, frameYPortrait: -0.2, distPortrait: 1.1 },
];
// the segment that starts at this key is the fly-through instead of an orbit
const FLY_SEG = 2;

const DEG = Math.PI / 180;

/**
 * Scroll progress at which each camera key is reached: where its section sits centred on
 * screen (hero = 0, finale = 1). Measured from the page, so a longer stretch between two
 * sections (the .fly-gap spacer before card 03) gives that camera move more scroll.
 */
let keyStops = CAM_KEYS.map((_, i) => i / (CAM_KEYS.length - 1));
function measureKeyStops() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return;
  const n = CAM_KEYS.length - 1;
  // Room beside the copy: on a narrow desktop (1024 px) the card takes half the width, so the
  // watch moves further out and the camera steps back until it fits in the free part (R2)
  const W = window.innerWidth;
  const H = window.innerHeight;
  const tablet = isPortrait() && W / H >= 0.6; // a phone keeps its tuned framing
  CAM_KEYS.forEach((k, i) => {
    k._fx = undefined;
    k._fy = undefined;
    k._dm = 1;
    if (tablet) {
      // portrait tablet: centre the watch between the copy and the HUD, a little further away
      const el = document.querySelector(`.panel[data-section="${i}"] .panel-content`);
      const hudTop = H - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-h')) || 80) - 24;
      const copyBottom = el && i > 0 && i < n ? Math.min(H * 0.55, el.getBoundingClientRect().height + 88) : H * 0.45;
      k._fy = (H / 2 - (copyBottom + hudTop) / 2) / H;
      k._dm = 1.3;
      return;
    }
    if (isPortrait() || !k.frameX) return;
    const el = document.querySelector(`.panel[data-section="${i}"] .panel-content`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    // share of the width the copy covers, from the screen edge it sits on (+ a small gap)
    const share = Math.min(0.75, (k.frameX > 0 ? r.right : W - r.left) / W + 0.02);
    k._fx = Math.sign(k.frameX) * Math.max(Math.abs(k.frameX), share / 2);
    k._dm = Math.min(1.7, Math.max(1, 0.62 / (1 - share)));
  });
  keyStops = CAM_KEYS.map((_, i) => {
    if (i === 0) return 0;
    if (i === n) return 1;
    const el = document.querySelector(`.panel[data-section="${i}"]`);
    if (!el) return i / n;
    const c = el.offsetTop + el.offsetHeight / 2 - window.innerHeight / 2;
    return Math.max(0, Math.min(1, c / max));
  });
}

/** Which key segment progress p is in, and how far along it (0..1). */
function segAt(p) {
  p = Math.max(0, Math.min(1, p));
  const n = CAM_KEYS.length - 1;
  let i = 0;
  while (i < n - 1 && p > keyStops[i + 1]) i++;
  const span = keyStops[i + 1] - keyStops[i];
  return { i, f: span > 0 ? Math.max(0, Math.min(1, (p - keyStops[i]) / span)) : 0 };
}

/** Uniform Catmull-Rom between p1 and p2. */
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

/** Frame shift of a key (portrait: the text is on top, so the watch only moves down, never sideways). */
function keyFrame(k) {
  return isPortrait()
    ? { x: 0, y: k._fy ?? k.frameYPortrait ?? 0 }
    : { x: k._fx ?? k.frameX ?? 0, y: k.frameY ?? 0 };
}

/** Camera pose for scroll progress p (0..1). Writes into `out`. */
function poseAt(p, out) {
  const n = CAM_KEYS.length - 1;
  const { i, f } = segAt(p);
  if (i === FLY_SEG) return flyThroughPose(f, out);
  const K = (j) => CAM_KEYS[Math.max(0, Math.min(n, j))];
  const spline = (get) => {
    let p0 = get(K(i - 1));
    let p3 = get(K(i + 2));
    // the orbit pieces on either side of the fly-through end on their own (no pull from the
    // far side of the watch), so the camera arrives at the cards calmly
    if (i + 1 === FLY_SEG) p3 = 2 * get(K(i + 1)) - get(K(i));
    if (i === FLY_SEG + 1) p0 = 2 * get(K(i)) - get(K(i + 1));
    return catmullRom(p0, get(K(i)), get(K(i + 1)), p3, f);
  };

  const az = spline((k) => k.az) * DEG;
  const el = spline((k) => k.el) * DEG;
  // narrow windows: step back so it fits (R5); portrait keys may step back a little more
  const dist = spline((k) => k.dist * (k._dm ?? 1)) * aspectScale() * (isPortrait() ? spline((k) => k.distPortrait ?? 1) : 1);
  out.look.set(spline((k) => k.look[0]), spline((k) => k.look[1]), spline((k) => k.look[2]));
  out.pos.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    .multiplyScalar(dist)
    .add(out.look);
  out.fov = spline((k) => k.fov);

  // frame shift: rest near the key, slide in the middle third between two cards
  const s = Math.max(0, Math.min(1, (f - 0.2) / 0.6));
  const g = s * s * (3 - 2 * s);
  const fa = keyFrame(K(i));
  const fb = keyFrame(K(i + 1));
  out.fx = fa.x + (fb.x - fa.x) * g;
  out.fy = fa.y + (fb.y - fa.y) * g;
  return out;
}

/** The camera pose sitting exactly on key j (same maths as poseAt at f = 0). */
function keyPoseAt(j, out) {
  const k = CAM_KEYS[j];
  const az = k.az * DEG;
  const el = k.el * DEG;
  const dist = k.dist * (k._dm ?? 1) * aspectScale() * (isPortrait() ? k.distPortrait ?? 1 : 1);
  out.look.set(k.look[0], k.look[1], k.look[2]);
  out.pos.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    .multiplyScalar(dist)
    .add(out.look);
  out.fov = k.fov;
  const fr = keyFrame(k);
  out.fx = fr.x;
  out.fy = fr.y;
  return out;
}

/**
 * Between cards 02 and 03 the camera flies through the open watch: it dives from the side into
 * the gap between the wheels and the dial, crosses the centre looking straight ahead, comes out
 * the far side and turns round onto the whole stack for card 03.
 * Path: key 2 → entry → centre → exit → key 3 (Catmull-Rom through those points); the gap height
 * is read from the live layer positions, so it follows the explode.
 */
const FLY_KNOTS = [0, 0.3, 0.5, 0.7, 1];
const _fa = newPose();
const _fb = newPose();
const _flyPts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _flyDir = new THREE.Vector3();
const _dA = new THREE.Vector3();
const _dB = new THREE.Vector3();
const _flyQ = new THREE.Quaternion();
const _flyQPart = new THREE.Quaternion();

/** Turn unit vector a towards b by s (0..1) about the shortest axis; writes into out. */
function slerpDir(a, b, s, out) {
  _flyQ.setFromUnitVectors(a, b);
  _flyQPart.identity().slerp(_flyQ, s);
  return out.copy(a).applyQuaternion(_flyQPart);
}

function flyThroughPose(f, out) {
  const a = keyPoseAt(FLY_SEG, _fa);
  const b = keyPoseAt(FLY_SEG + 1, _fb);
  const ease = (t) => t * t * (3 - 2 * t);
  // the autoplay (flyAuto) already eases the page in and out, so the path itself is linear
  const u = f;

  // the gap between the gear train and the dial at the current explode, nearer the dial:
  // the case ring and the bridges stand up from below, the dial is a thin disc above
  const gear = layers.Layer04_GearTrain;
  const dial = layers.Layer07_SkeletonDial;
  const gapY = gear && dial ? gear.position.y + (dial.position.y - gear.position.y) * 0.62 : 0.6;

  // straight line through the centre, in from key 2's side
  _flyDir.set(-a.pos.x, 0, -a.pos.z).normalize();
  _flyPts[0].copy(a.pos);
  _flyPts[1].set(0, gapY, 0).addScaledVector(_flyDir, -2.4);
  _flyPts[2].set(0, gapY, 0);
  // climbing on the way out, clear of the far side of the case ring
  _flyPts[3].set(0, gapY + 0.8, 0).addScaledVector(_flyDir, 2.6);
  _flyPts[4].copy(b.pos);

  let k = 0;
  while (k < FLY_KNOTS.length - 2 && u > FLY_KNOTS[k + 1]) k++;
  const t = (u - FLY_KNOTS[k]) / (FLY_KNOTS[k + 1] - FLY_KNOTS[k]);
  const P = (j) => _flyPts[Math.max(0, Math.min(_flyPts.length - 1, j))];
  out.pos.set(
    catmullRom(P(k - 1).x, P(k).x, P(k + 1).x, P(k + 2).x, t),
    catmullRom(P(k - 1).y, P(k).y, P(k + 1).y, P(k + 2).y, t),
    catmullRom(P(k - 1).z, P(k).z, P(k + 1).z, P(k + 2).z, t)
  );

  // where it looks: at the watch → ahead and a little down inside (the wheels rush past
  // underneath) → turning round onto the watch; the turn starts as the camera leaves the
  // watch, so the stack swings back into view
  _dA.subVectors(a.look, a.pos).normalize();
  _dB.subVectors(b.look, b.pos).normalize();
  _ahead.copy(_flyDir).setY(-0.32).normalize();
  const look = _look3;
  if (u < 0.3) slerpDir(_dA, _ahead, ease(u / 0.3), look);
  else if (u < 0.46) look.copy(_ahead);
  else slerpDir(_ahead, _dB, ease(Math.min(1, (u - 0.46) / 0.34)), look);
  const lookDist = a.pos.distanceTo(a.look) + (b.pos.distanceTo(b.look) - a.pos.distanceTo(a.look)) * u;
  out.look.copy(out.pos).addScaledVector(look, lookDist);

  // a wider lens inside the watch: the parts rush past
  out.fov = a.fov + (b.fov - a.fov) * u + 16 * Math.sin(Math.PI * u);

  // the watch slides from one side of the screen to the other; centred while inside
  const g = ease(Math.max(0, Math.min(1, (f - 0.2) / 0.6)));
  out.fx = a.fx + (b.fx - a.fx) * g;
  out.fy = a.fy + (b.fy - a.fy) * g;
  return out;
}
const _look3 = new THREE.Vector3();
const _ahead = new THREE.Vector3();

function newPose() {
  return { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, fx: 0, fy: 0 };
}

// Current frame shift (share of the viewport) — kept so resize and fly-tos can reuse it
const frame = { x: 0, y: 0 };

/** Shift the rendered image so the look point lands at (frame.x, frame.y) from the centre. */
function setFrame(fx, fy) {
  frame.x = fx;
  frame.y = fy;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.setViewOffset(w, h, -fx * w, fy * h, w, h); // also updates the projection matrix
}

function applyPose(pose) {
  camera.position.copy(pose.pos);
  camera.fov = pose.fov;
  setFrame(pose.fx, pose.fy);
  camera.lookAt(pose.look);
  controls.target.copy(pose.look);
}

let scrollProgress = 0;

function initScroll() {
  // Section copy is plain page content: it scrolls in and out with the page, no reveal effects.
  // The one orchestrated motion is the camera flight and the watch coming apart.

  // GSAP ScrollTrigger if available
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (gsap && ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);

    ScrollTrigger.create({
      trigger: '#scroll-root',
      start: 'top top',
      end: 'bottom bottom',
      scrub: reduceMotionMQ.matches ? 0.2 : 1.6,
      onUpdate: (self) => {
        scrollProgress = self.progress;
        state.explodeScroll = smoothstepExplode(self.progress);
        updateCameraFromScroll(self.progress);
        // (leaving the finale is handled by its own trigger → leave(); HUD slider follows tick())
      },
    });
  } else {
    // fallback scroll listener
    window.addEventListener('scroll', () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress = max > 0 ? window.scrollY / max : 0;
      state.explodeScroll = smoothstepExplode(scrollProgress);
      updateCameraFromScroll(scrollProgress);
    }, { passive: true });
  }
}

function smoothstepExplode(p) {
  // Use CAM_KEYS[].explode (0 / 30 / 60 / 85 / 100%) so the open curve matches the camera beats.
  const { i, f } = segAt(p);
  const ease = f * f * (3 - 2 * f);
  return CAM_KEYS[i].explode + (CAM_KEYS[i + 1].explode - CAM_KEYS[i].explode) * ease;
}

// One rule for "phone / portrait layout" in JS and CSS (styles.css uses the same media query),
// so the camera and the page never assume different layouts (a tablet in portrait was split)
const PORTRAIT_MQ = window.matchMedia('(max-width: 720px), (max-aspect-ratio: 85/100)');
function isPortrait() {
  return PORTRAIT_MQ.matches;
}

/** >1 on narrow screens: how much farther from the look point the camera must stand. */
function aspectScale() {
  const aspect = window.innerWidth / window.innerHeight;
  return aspect >= 1 ? 1 : Math.min(2.3, Math.max(1, 0.95 / aspect));
}

function updateCameraFromScroll(p) {
  // Scroll always updates its own explode value (so reverse scroll reassembles, even in
  // inspect mode). tick() eases state.explode towards it, or towards the slider while it is held.
  state.explodeScroll = smoothstepExplode(p);

  // inspect: orbit / part focus own the camera; a fly back to the path follows the scroll itself
  if (state.cameraMode === 'inspect' || camFly.active) return;
  applyPose(poseAt(p, _pose));
}

// scratch pose for updateCameraFromScroll (called on every scroll update)
const _pose = newPose();

// ------------------------------------------------------------------
// HUD
// ------------------------------------------------------------------
const ICON_PAUSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="2.6" height="9" rx="0.6"/><rect x="7.4" y="1.5" width="2.6" height="9" rx="0.6"/></svg>';
// the triangle is nudged right: its visual centre is left of its box centre
const ICON_PLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.4 1.6 10.4 6 3.4 10.4Z"/></svg>';

const btnSound = document.getElementById('btn-sound');
const ICON_SOUND_ON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="body" d="M2 6h2.6L8 3.2v9.6L4.6 10H2z"/><path d="M10.4 5.6a3.2 3.2 0 0 1 0 4.8M12.3 3.8a5.8 5.8 0 0 1 0 8.4"/></svg>';
const ICON_SOUND_OFF = '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="body" d="M2 6h2.6L8 3.2v9.6L4.6 10H2z"/><path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8"/></svg>';

function setSound(on, remember = true) {
  sound.set(on);
  if (remember) {
    try { localStorage.setItem('chronos-sound', on ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
  }
  const isOn = sound.on;
  btnSound.classList.toggle('is-active', isOn);
  btnSound.setAttribute('aria-pressed', String(isOn));
  btnSound.innerHTML = isOn ? ICON_SOUND_ON : ICON_SOUND_OFF;
  btnSound.title = isOn ? 'Выключить звук (M)' : 'Включить звук (M)';
  btnSound.setAttribute('aria-label', isOn ? 'Выключить звук' : 'Включить звук');
}

function setPaused(paused) {
  state.paused = paused;
  btnPause.classList.toggle('is-active', paused);
  btnPause.setAttribute('aria-pressed', String(paused));
  // SVG icons: the ⏸/▶ glyphs sat off-centre (font metrics differ per system)
  btnPause.innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
  btnPause.title = paused ? 'Продолжить (P)' : 'Пауза (P)';
  btnPause.setAttribute('aria-label', paused ? 'Продолжить' : 'Пауза');
}

function initHUD() {
  // Expose the HUD height to CSS so cards / panels clear it on any layout (R6)
  const hudRow = document.querySelector('.hud-row');
  const syncHud = () => document.documentElement.style.setProperty('--hud-h', Math.ceil(hudRow.offsetHeight) + 'px');
  syncHud();
  if (window.ResizeObserver) new ResizeObserver(syncHud).observe(hudRow);

  const btnXray = document.getElementById('btn-xray');
  const speedSeg = document.getElementById('speed-seg');

  btnXray.addEventListener('click', () => {
    state.xray = !state.xray;
    btnXray.classList.toggle('is-active', state.xray);
    btnXray.setAttribute('aria-pressed', String(state.xray));
    applyXRay(state.xray);
  });

  btnPause.addEventListener('click', () => setPaused(!state.paused));
  // on by default; a visitor who turned it off keeps it off on the next visit
  let soundPref = 'on';
  try { soundPref = localStorage.getItem('chronos-sound') || 'on'; } catch (e) { /* storage blocked */ }
  setSound(soundPref !== 'off', false);
  btnSound.addEventListener('click', () => setSound(!sound.on));

  // «Узлы» only opens the list, wherever the page is; picking a part flies to it from here
  btnParts.addEventListener('click', (e) => {
    e.stopPropagation();
    setPartsOpen(partsPop.hidden);
  });
  // (the «Узлы» button stops its own click, so only outside clicks reach this)
  document.addEventListener('click', (e) => {
    if (!partsPop.hidden && !partsPop.contains(e.target)) setPartsOpen(false);
  });

  document.getElementById('btn-reassemble').addEventListener('click', () => {
    closePartFocus();
    flySuppressed = true; // the smooth ride to the top passes the flight stretch: not a nudge
    window.scrollTo({ top: 0, behavior: reduceMotionMQ.matches ? 'auto' : 'smooth' });
  });

  // The slider's value holds until the user scrolls the page on: then the scroll takes over
  // again (it used to snap back on a 2.5 s timer and lose the choice — QA M1)
  let manualScrollY = 0;
  explodeRange.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    state.explodeManual = v / 100;
    explodeVal.textContent = v + '%';
    manualScrollY = window.scrollY;
  });
  window.addEventListener('scroll', () => {
    if (state.explodeManual !== null && !partFocused && Math.abs(window.scrollY - manualScrollY) > 40) {
      state.explodeManual = null;
    }
  }, { passive: true });

  speedSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    speedSeg.querySelectorAll('button').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    state.speed = Number(btn.dataset.speed);
    setPaused(false); // picking a speed always means "run"
  });

  const leavePart = () => {
    closePartFocus(true);
    btnParts.focus({ preventScroll: true });
  };
  document.getElementById('hotspot-close').addEventListener('click', leavePart);
  btnPartExit.addEventListener('click', leavePart);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // focus goes back to «Узлы» instead of falling to <body>
      if (!partsPop.hidden) { setPartsOpen(false); btnParts.focus({ preventScroll: true }); }
      else if (!hotspotCard.hidden) { closePartFocus(true); btnParts.focus({ preventScroll: true }); }
    }
    // ↑ / ↓ move inside the open parts menu
    if (!partsPop.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = [...partsPop.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next].focus({ preventScroll: true });
    }
    // P toggles pause. (Space is left alone so it keeps scrolling the page.)
    if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey &&
        !e.target.closest?.('input:not([type=range]), textarea, select')) {
      setSound(!sound.on);
    }
    if ((e.code === 'KeyP') && !e.ctrlKey && !e.metaKey && !e.altKey &&
        !e.target.closest?.('input:not([type=range]), textarea, select')) {
      setPaused(!state.paused);
    }
  });

  // Finale entry/exit (orbit mode, camera) is handled in initHotspots → enter()/leave().
}

// X-Ray: only the shell turns into a wireframe, the dial turns glassy.
// Materials are shared between shell and movement in the GLB, so we swap in clones
// instead of editing the shared ones, and put the originals back when X-Ray is off.
const XRAY_SHELL = new Set(['Layer09_OuterCase', 'Layer02_Mainplate', 'Layer01_Caseback', 'Layer10_SapphireGlass']);
const xrayClones = new Map();   // original material -> clone, per mode

function xrayMaterial(m, mode) {
  const key = m.uuid + mode;
  let clone = xrayClones.get(key);
  if (!clone) {
    clone = m.clone();
    clone.transparent = true;
    clone.depthWrite = false;
    if (mode === 'wire') {
      clone.wireframe = true;
      clone.opacity = 0.22;
    } else {
      clone.opacity = 0.14; // dial: see-through, no wireframe
    }
    xrayClones.set(key, clone);
  }
  return clone;
}

function applyXRay(on) {
  for (const entry of layersArray) {
    const { name, obj } = entry;
    const mode = XRAY_SHELL.has(name) ? 'wire' : name === 'Layer07_SkeletonDial' ? 'glass' : null;
    if (!mode) continue;
    obj.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      if (c.userData._fadePrev) return; // fading out around a part: restoreFaded() re-applies X-Ray
      if (!c.userData._xrayOrig) c.userData._xrayOrig = c.material;
      const orig = c.userData._xrayOrig;
      if (!on) {
        c.material = orig;
      } else if (Array.isArray(orig)) {
        c.material = orig.map((m) => xrayMaterial(m, mode));
      } else {
        c.material = xrayMaterial(orig, mode);
      }
    });
  }
}

// ------------------------------------------------------------------
// Hotspots
// ------------------------------------------------------------------
// The «Узлы» popover in the HUD lists the parts; picking one isolates it and flies the camera.
let inFinale = false;          // mechanism is open (final section) → nodes are usable

function initHotspots() {
  const list = document.getElementById('parts-list');
  list.innerHTML = '';
  HOTSPOTS.forEach((h) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.id = h.id;
    btn.innerHTML = `<span class="num">${h.id}</span><span>${h.title}</span>`;
    btn.addEventListener('click', () => {
      setPartsOpen(false);
      openHotspot(h, btn);
    });
    li.setAttribute('role', 'none'); // menu > menuitem; the <li> is only layout (QA L3)
    li.appendChild(btn);
    list.appendChild(li);
  });

  const enter = () => {
    if (inFinale) return;
    inFinale = true;
    // One place owns the finale: orbit on, and the camera glides to the finale frame
    // (otherwise it freezes wherever the delayed scroll scrub happened to be) (R2).
    state.cameraMode = 'inspect';
    controls.enabled = true;
    const end = poseAt(1, newPose());
    flyCamera(end.pos, end.look, end.fov, end.fx, end.fy);
  };
  const leave = () => {
    inFinale = false;
    setPartsOpen(false);
    // leaving the finale: restore the full watch, glide the camera back onto the scroll path
    closePartFocus();
    returnToScroll();
  };

  if (window.ScrollTrigger) {
    window.ScrollTrigger.create({
      trigger: '.panel-inspector',
      start: 'top 65%',
      end: 'bottom top',
      onEnter: enter,
      onEnterBack: enter,
      onLeaveBack: leave,
    });
  } else {
    // fallback: finale = near page bottom
    window.addEventListener('scroll', () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const nearEnd = max > 0 && window.scrollY / max > 0.82;
      if (nearEnd && !inFinale) enter();
      else if (!nearEnd && inFinale) leave();
    }, { passive: true });
  }
  // HUD is wired once at module boot — do NOT call initHUD() again here.
}

function setPartsOpen(open) {
  partsPop.hidden = !open;
  btnParts.setAttribute('aria-expanded', String(open));
  btnParts.classList.toggle('is-open', open);
  if (open) {
    const first = partsPop.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
}

/** Hand the camera back to the scroll path with a glide (it re-aims at the live scroll pose). */
function returnToScroll() {
  state.cameraMode = 'scroll';
  controls.enabled = false;
  const p = poseAt(scrollProgress, newPose());
  flyCamera(p.pos, p.look, p.fov, p.fx, p.fy, { follow: true, speed: 1.1 });
}

// ---- Part isolation: the other layers fade out while the camera flies in ----
// Materials are shared between layers in the GLB, so the fading layers get shared clones
// (one per original material: they all fade together) and the chosen layer keeps the originals.
const fade = {
  value: 1,              // 1 = whole watch visible, 0 = only the chosen layer
  target: 1,
  clones: new Map(),     // original material -> { clone, baseOpacity }
  meshes: [],            // { mesh, prev } swapped to clones
};

function fadeClone(m) {
  let rec = fade.clones.get(m);
  if (!rec) {
    const clone = m.clone();
    clone.transparent = true;
    clone.depthWrite = false;
    rec = { clone, baseOpacity: m.opacity };
    fade.clones.set(m, rec);
  }
  return rec.clone;
}

/** Put every faded mesh back on its own material (and X-Ray on top, if it is on). */
function restoreFaded() {
  for (const { mesh, prev } of fade.meshes) {
    mesh.material = prev;
    mesh.visible = true;
    delete mesh.userData._fadePrev;
  }
  fade.meshes.length = 0;
  for (const entry of layersArray) entry.obj.visible = true;
  applyXRay(state.xray); // X-Ray may have been toggled while the layers were faded
}

function isolateLayer(targetName) {
  restoreFaded();
  for (const entry of layersArray) {
    if (entry.name === targetName) continue;
    entry.obj.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      const prev = c.material;
      c.userData._fadePrev = prev;
      c.material = Array.isArray(prev) ? prev.map(fadeClone) : fadeClone(prev);
      fade.meshes.push({ mesh: c, prev });
    });
  }
  // switching from one part to another: the rest is already gone, keep it gone
  fade.target = 0;
  if (reduceMotionMQ.matches) fade.value = 0;
  updateFade(0);
}

function showAllLayers() {
  fade.target = 1;
  if (reduceMotionMQ.matches || !fade.meshes.length) {
    fade.value = 1;
    restoreFaded();
  }
}

/** Called every frame: ease the fade, push it into the clone opacities. */
function updateFade(dt) {
  if (!fade.meshes.length) return;
  const step = dt * 1.4; // ~0.7 s, a bit quicker than the camera flight
  fade.value = fade.target > fade.value
    ? Math.min(fade.target, fade.value + step)
    : Math.max(fade.target, fade.value - step);
  const v = fade.value * fade.value; // ease-in: parts thin out slowly, then vanish
  for (const rec of fade.clones.values()) rec.clone.opacity = rec.baseOpacity * v;
  const hidden = fade.value <= 0.001;
  for (const { mesh } of fade.meshes) mesh.visible = !hidden;
  if (fade.target === 1 && fade.value >= 1) restoreFaded();
}

let savedPose = null;   // finale camera before the first part fly-to, so closing can fly back (R3)
let partFocused = false;
let focusScrollY = 0; // the page is held here while a part is open (R1)

/**
 * Close the part card, show every layer again and reset the «Узлы» button.
 * restoreCamera: user closed the card (×/Escape/scroll) → fly back: to the finale view,
 * or onto the scroll path when the part was opened somewhere up the page.
 */
function closePartFocus(restoreCamera = false) {
  if (restoreCamera && partFocused) {
    // the approach sound in reverse: the part drops away and the watch comes back
    if (!reduceMotionMQ.matches) sound.whoosh(1.3, true);
    if (inFinale && savedPose) {
      flyCamera(savedPose.pos, savedPose.look, savedPose.fov, savedPose.fx, savedPose.fy);
    } else if (inFinale) {
      const end = poseAt(1, newPose());
      flyCamera(end.pos, end.look, end.fov, end.fx, end.fy);
    } else {
      returnToScroll();
    }
  }
  if (partFocused) setPartControls(false);
  partFocused = false;
  focusedHotspot = null;
  savedPose = null;
  btnPartExit.tabIndex = -1;
  hotspotCard.classList.remove('is-open');
  hotspotCard.hidden = true;
  showAllLayers();
  document.querySelectorAll('.parts-list button').forEach((b) => b.classList.remove('is-active'));
  btnPartsLabel.textContent = 'Узлы';
  btnParts.classList.remove('is-active');
  document.body.classList.remove('part-focus');
}

// While a part is open the page stays put: the wheel / pinch zooms on the part (OrbitControls
// on the canvas), and nothing scrolls the page until the user leaves with «Вернуться к часам».
// The «Прокрутите» cue fades out as soon as the page moves, and comes back at the very top
const syncScrolled = () => {
  const scrolled = window.scrollY > 8;
  document.body.classList.toggle('has-scrolled', scrolled);
  // the «grab» hand belongs to the top of the page only (hero turn)
  if (scrolled && canvas.style.cursor === 'grab') canvas.style.cursor = '';
};
window.addEventListener('scroll', syncScrolled, { passive: true });
syncScrolled();

// ---- Hero turn: at the very top the watch can be dragged round to look at it from every side.
// No zoom; the wheel keeps scrolling the page, and scrolling sends the watch back (see tick()).
// Horizontal drag turns it about the vertical axis, vertical drag tips it towards / away.
const heroTurn = { q: new THREE.Quaternion(), dragging: false, x: 0, y: 0, id: null };
const _identityQ = new THREE.Quaternion();
const _turnQ = new THREE.Quaternion();
const _turnAxis = new THREE.Vector3();
const _idleQ = new THREE.Quaternion();
const _idleEuler = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

function canTurnHero() {
  return state.ready && state.cameraMode === 'scroll' && !partFocused && !camFly.active && window.scrollY <= 8;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !canTurnHero()) return;
  heroTurn.dragging = true;
  heroTurn.x = e.clientX;
  heroTurn.y = e.clientY;
  heroTurn.id = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
  document.body.classList.add('turned'); // the hint has done its job
});
canvas.addEventListener('pointermove', (e) => {
  if (!heroTurn.dragging) {
    // the hand cursor only where turning actually works
    canvas.style.cursor = canTurnHero() ? 'grab' : '';
    return;
  }
  if (e.pointerId !== heroTurn.id) return;
  const dx = e.clientX - heroTurn.x;
  const dy = e.clientY - heroTurn.y;
  heroTurn.x = e.clientX;
  heroTurn.y = e.clientY;
  const k = 0.006; // rad per pixel: a full turn is a long sweep, not a flick
  heroTurn.q.premultiply(_turnQ.setFromAxisAngle(UP, dx * k));
  _turnAxis.setFromMatrixColumn(camera.matrixWorld, 0); // camera right: tip towards / away
  heroTurn.q.premultiply(_turnQ.setFromAxisAngle(_turnAxis, dy * k)).normalize();
});
const endTurn = (e) => {
  if (!heroTurn.dragging || e.pointerId !== heroTurn.id) return;
  heroTurn.dragging = false;
  canvas.style.cursor = canTurnHero() ? 'grab' : '';
};
canvas.addEventListener('pointerup', endTurn);
canvas.addEventListener('pointercancel', endTurn); // e.g. a vertical swipe became a page scroll

// The input blocks below stop wheel / touch / keys, but the scrollbar (or a script) still moves
// the page: put it straight back, so explode, the finale trigger and the open part stay in sync.
window.addEventListener('scroll', () => {
  if (partFocused && window.scrollY !== focusScrollY) window.scrollTo(0, focusScrollY);
}, { passive: true });
const SCROLL_KEYS = new Set(['Space', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown']);
window.addEventListener('wheel', (e) => {
  lastUserScroll = performance.now();
  flySuppressed = false;
  // over the card / HUD: no page scroll either; during the fly-through the page is driven
  if (partFocused || flyAuto.active) e.preventDefault();
}, { passive: false });
window.addEventListener('touchmove', (e) => {
  lastUserScroll = performance.now();
  if (flyAuto.active) { e.preventDefault(); return; }
  // the part card may scroll inside itself on phones
  if (partFocused && !e.target.closest?.('.hotspot-card')) e.preventDefault();
}, { passive: false });
window.addEventListener('keydown', (e) => {
  const onControl = e.target.closest?.('button, a, input, select, textarea');
  if (SCROLL_KEYS.has(e.code) && !onControl) lastUserScroll = performance.now();
  if (flyAuto.active && SCROLL_KEYS.has(e.code)) { e.preventDefault(); return; }
  if (!partFocused || !partsPop.hidden || e.target.closest?.('input, textarea, select')) return;
  if (SCROLL_KEYS.has(e.code)) e.preventDefault();
});

// ---- Fly-through on its own: a nudge of the scroll past card 02 (or back up past card 03)
// plays the whole flight through the watch at its own pace; the page is driven to the next
// card and the user's scroll is held until it lands. Only the user's own scrolling starts it
// (not «Собрать часы» or other programmatic scrolls passing by).
const flyAuto = { active: false, from: 0, to: 0, t0: 0, dur: 3.6 };
let lastUserScroll = -1e9;
let flySuppressed = false; // set by «Собрать часы» until the page is back at the top
let flyLastP = 0;

function scrollMax() {
  return document.documentElement.scrollHeight - window.innerHeight;
}

function startFly(toProgress) {
  const max = scrollMax();
  flyAuto.from = window.scrollY;
  flyAuto.toProgress = toProgress;
  flyAuto.to = Math.round(toProgress * max);
  flyAuto.t0 = performance.now();
  flyAuto.dur = reduceMotionMQ.matches ? 0 : 3.6;
  flyAuto.active = true;
  if (flyAuto.dur > 0) sound.whoosh(flyAuto.dur + 1.2); // scrub lag: the camera lands ~1 s after the page
  requestAnimationFrame(stepFly);
}

/** Jump the auto fly-through to its end (used when a part is opened mid-flight). */
function finishFlyNow() {
  if (!flyAuto.active) return;
  flyAuto.active = false;
  const y = Math.round(flyAuto.toProgress * scrollMax());
  window.scrollTo(0, y);
  flyLastP = flyAuto.toProgress;
  ratchetY = y; // the jump is not a scroll the ratchet should click for
}

function stepFly(now) {
  if (!flyAuto.active) return;
  // target in pixels from the stored progress: a resize mid-flight still lands on the card (M2)
  flyAuto.to = Math.round(flyAuto.toProgress * scrollMax());
  const t = flyAuto.dur > 0 ? Math.min(1, (now - flyAuto.t0) / (flyAuto.dur * 1000)) : 1;
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease in and out
  window.scrollTo(0, Math.round(flyAuto.from + (flyAuto.to - flyAuto.from) * e));
  if (t < 1) requestAnimationFrame(stepFly);
  else {
    flyAuto.active = false;
    flyLastP = flyAuto.to / Math.max(1, scrollMax());
  }
}

window.addEventListener('scroll', () => {
  const max = scrollMax();
  const p = max > 0 ? window.scrollY / max : 0;
  const lastP = flyLastP;
  flyLastP = p;
  if (flySuppressed && window.scrollY <= 8) flySuppressed = false;
  if (flyAuto.active || partFocused || flySuppressed || !state.ready) return;
  if (performance.now() - lastUserScroll > 400) return; // not the user's own scroll
  const a = keyStops[FLY_SEG];
  const b = keyStops[FLY_SEG + 1];
  const eps = 0.004;
  if (p > a + eps && p < b - eps) {
    // entered the flight stretch: finish it in the direction of travel
    startFly(p >= lastP ? b : a);
  }
}, { passive: true });

/** Orbit settings for a focused part: zoom on, close range; back to the finale defaults after. */
function setPartControls(on, dist = 2) {
  controls.enableZoom = on;
  controls.zoomSpeed = 0.6;
  // limits only bite while zooming (rotation keeps the distance), so off-focus they stay wide;
  // the far limit is set once the fly-in lands (camFly.onDone), or the flight would be clamped
  controls.minDistance = on ? dist * 0.35 : 0.5;
  controls.maxDistance = 30;
  canvas.style.touchAction = on ? 'none' : 'pan-y'; // pinch / drag go to the part, not the page
}

/**
 * Camera pose for a focused part, for the current window (also re-used on resize).
 * Aims at the centre of the part itself (its bounding sphere, at the current explode) and steps
 * back just far enough for the whole part to fit the screen area the card leaves free: beside
 * the card on a desktop, above it on a phone or a portrait tablet (M5: long parts were cut).
 */
const _partBox = new THREE.Box3();
const _partSphere = new THREE.Sphere();
const _savedTurn = new THREE.Quaternion();
const PART_DIR = new THREE.Vector3(1.2, 1.4, 1.8).normalize();
const PART_FOV = 38;

function partPose(h) {
  const entry = layersArray.find((l) => l.name === h.layer);
  // measure the part in the watch's resting pose (a hero turn eases back while the camera flies)
  _savedTurn.copy(watchRoot.quaternion);
  watchRoot.quaternion.identity();
  watchRoot.updateMatrixWorld(true);
  _partBox.setFromObject(entry ? entry.obj : watchRoot);
  watchRoot.quaternion.copy(_savedTurn);
  watchRoot.updateMatrixWorld(true);
  _partBox.getBoundingSphere(_partSphere);
  const target = _partSphere.center.clone();
  const r = _partSphere.radius;

  const W = window.innerWidth;
  const H = window.innerHeight;
  const portrait = isPortrait();
  let fx = 0;
  let fy = 0;
  let availW; // share of the screen width / height the part may use
  let availH;
  if (portrait) {
    // card at the bottom, «Вернуться к часам» under the top bar: the part goes in between
    const cardTop = hotspotCard.hidden ? H * 0.62 : hotspotCard.getBoundingClientRect().top;
    const top = 116;
    const bottom = cardTop - 12;
    fy = (H / 2 - (top + bottom) / 2) / H;
    availW = 0.94;
    availH = Math.max(0.25, (bottom - top) / H);
  } else {
    // card on the right: the part goes in the free left part, clear of the HUD below
    const share = (Math.min(340, W - 40) + 28) / W + 0.03;
    fx = -share / 2;
    availW = 1 - share - 0.04;
    const hud = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-h')) || 70;
    availH = (H - 2 * (hud + 70)) / H + 0.3; // the part may pass behind the top bar a little
    availH = Math.min(0.85, availH);
  }
  const tanV = Math.tan((PART_FOV / 2) * DEG);
  const fit = Math.min(availH, availW * (W / H));
  const dist = (r / (tanV * fit)) * 0.92; // the sphere is loose around a flat part
  const camPos = target.clone().addScaledVector(PART_DIR, dist);
  return { camPos, target, dist, fx, fy };
}

let focusedHotspot = null;

function openHotspot(h, btn) {
  document.getElementById('hotspot-kicker').textContent = h.id;
  document.getElementById('hotspot-title').textContent = h.title;
  document.getElementById('hotspot-body').textContent = h.body;
  const specs = document.getElementById('hotspot-specs');
  specs.innerHTML = h.specs
    .map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`)
    .join('');
  hotspotCard.hidden = false;
  requestAnimationFrame(() => hotspotCard.classList.add('is-open'));

  // list active state + HUD button shows the chosen node
  document.querySelectorAll('.parts-list button').forEach((b) => {
    b.classList.toggle('is-active', b === btn);
  });
  btnPartsLabel.textContent = `Узел ${h.id}`;
  btnParts.classList.add('is-active');
  document.body.classList.add('part-focus'); // hide the section copy so the part is unobstructed

  // the rest of the watch fades away while the camera flies in
  isolateLayer(h.layer);

  // camera fly-to (anchor follows the layer's explode offset)
  if (!partFocused && inFinale) {
    // if the finale glide is still running, remember where it is heading, not where it is now
    savedPose = camFly.active
      ? { pos: camFly.toPos.clone(), look: camFly.toLook.clone(), fov: camFly.toFov, fx: camFly.toFx, fy: camFly.toFy }
      : { pos: camera.position.clone(), look: controls.target.clone(), fov: camera.fov, fx: frame.x, fy: frame.y };
  }
  // a part picked mid fly-through: land the flight first, so the page is not pulled two ways
  // (the flight forward, the part lock back) and the camera never ends up inside the watch
  finishFlyNow();
  partFocused = true;
  focusedHotspot = h;
  btnPartExit.tabIndex = 0;
  focusScrollY = window.scrollY;
  state.cameraMode = 'inspect';
  controls.enabled = true;
  const { camPos, target, dist, fx, fy } = partPose(h);
  setPartControls(true, dist);
  // the same rush of air as the fly-through, timed to this flight (1 / 0.75 s ≈ 1.3 s)
  if (!reduceMotionMQ.matches) sound.whoosh(1.6);
  // a slower, longer flight than the other glides: it reads as diving into the watch
  flyCamera(camPos, target, PART_FOV, fx, fy, {
    speed: 0.75,
    onDone: () => { if (partFocused) controls.maxDistance = dist * 2.6; },
  });
}

const camFly = {
  active: false,
  fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(),
  fromLook: new THREE.Vector3(), toLook: new THREE.Vector3(),
  fromFov: 40, toFov: 40,
  fromFx: 0, toFx: 0, fromFy: 0, toFy: 0,
  t: 0,
  speed: 1.6,     // 1 / duration in seconds
  follow: false,  // re-aim at the live scroll pose every frame (flying back onto the path)
};
const _followPose = newPose();

function flyCamera(pos, look, fov = camera.fov, fx = frame.x, fy = frame.y, opts = {}) {
  camFly.speed = opts.speed ?? 1.6;
  camFly.follow = !!opts.follow;
  camFly.onDone = opts.onDone || null;
  camFly.fromPos.copy(camera.position);
  camFly.toPos.copy(pos);
  camFly.fromLook.copy(controls.target);
  camFly.toLook.copy(look);
  camFly.fromFov = camera.fov;
  camFly.toFov = fov;
  camFly.fromFx = frame.x;
  camFly.toFx = fx;
  camFly.fromFy = frame.y;
  camFly.toFy = fy;
  camFly.t = reduceMotionMQ.matches ? 1 : 0; // reduced motion: jump, no flight
  camFly.active = true;
}

// ------------------------------------------------------------------
// Resize
// ------------------------------------------------------------------
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  measureKeyStops();
  setFrame(frame.x, frame.y); // re-run the view offset for the new size (updates the projection)
  renderer.setSize(w, h);
  composer.setSize(w, h);
  if (!state.ready) return;
  if (partFocused && focusedHotspot) {
    // re-aim at the part for the new layout (card beside on desktop, below on a phone)
    const pp = partPose(focusedHotspot);
    setPartControls(true, pp.dist);
    controls.maxDistance = pp.dist * 2.6;
    flyCamera(pp.camPos, pp.target, PART_FOV, pp.fx, pp.fy, { speed: 3 });
    // the finale view to return to was framed for the old window
    if (inFinale && savedPose) {
      const end = poseAt(1, newPose());
      savedPose = { pos: end.pos, look: end.look, fov: end.fov, fx: end.fx, fy: end.fy };
    }
  } else if (inFinale && state.cameraMode === 'inspect') {
    const end = poseAt(1, newPose());
    flyCamera(end.pos, end.look, end.fov, end.fx, end.fy, { speed: 3 });
  } else if (state.cameraMode === 'scroll') {
    updateCameraFromScroll(scrollProgress);
  }
}
window.addEventListener('resize', onResize);

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------
function tick() {
  requestAnimationFrame(tick);

  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);   // animation steps stay small after a hidden tab
  const reduceMotion = reduceMotionMQ.matches;
  if (!state.paused) {
    state.time += dt * state.speed * (reduceMotion ? 0.15 : 1);
    // the hands use the UNclamped delta, so they never fall behind the real time
    mechParts.clockMs += rawDt * 1000 * state.speed;
  }
  animateMechanism();

  // explode: manual overrides scroll (prefers-reduced-motion: no gliding, just set it)
  const explodeTarget =
    state.explodeManual !== null ? state.explodeManual : state.explodeScroll;
  state.explode += (explodeTarget - state.explode) * (reduceMotion ? 1 : Math.min(1, dt * 6));
  applyExplode(state.explode);
  updateFade(reduceMotion ? 1 : dt);
  if (state.explodeManual === null) {
    // HUD slider follows the actual explode value (scroll, or the glide back after the slider)
    const pct = Math.round(state.explode * 100);
    if (explodeRange.value !== String(pct)) {
      explodeRange.value = pct;
      explodeVal.textContent = pct + '%';
    }
  }

  // camera fly
  if (camFly.active) {
    if (camFly.follow) {
      poseAt(scrollProgress, _followPose);
      camFly.toPos.copy(_followPose.pos);
      camFly.toLook.copy(_followPose.look);
      camFly.toFov = _followPose.fov;
      camFly.toFx = _followPose.fx;
      camFly.toFy = _followPose.fy;
    }
    camFly.t += dt * camFly.speed;
    const t = Math.min(1, camFly.t);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
    camera.position.lerpVectors(camFly.fromPos, camFly.toPos, e);
    controls.target.lerpVectors(camFly.fromLook, camFly.toLook, e);
    camera.lookAt(controls.target);
    camera.fov = camFly.fromFov + (camFly.toFov - camFly.fromFov) * e;
    setFrame(
      camFly.fromFx + (camFly.toFx - camFly.fromFx) * e,
      camFly.fromFy + (camFly.toFy - camFly.fromFy) * e
    );
    if (t >= 1) {
      camFly.active = false;
      if (camFly.onDone) camFly.onDone();
    }
  }

  if (controls.enabled) controls.update();

  // Hero turn: once the page moves (or the camera is taken elsewhere) the watch eases back to
  // its starting pose, and the scroll choreography carries on from exactly the usual frame
  if (!heroTurn.dragging && !canTurnHero()) {
    if (reduceMotion) heroTurn.q.identity();
    else heroTurn.q.slerp(_identityQ, 1 - Math.exp(-6 * dt));
  }

  // gentle idle float — tiny, so parts don't look "crooked" while spinning
  const idle = reduceMotion ? 0 : 1;
  _idleEuler.set(0, Math.sin(state.time * 0.12) * 0.04 * idle, 0);
  watchRoot.quaternion.copy(heroTurn.q).multiply(_idleQ.setFromEuler(_idleEuler));
  watchRoot.position.y = Math.sin(state.time * 0.35) * 0.015 * idle;
  updateGlow();

  composer.render();
}

initHUD();
// First frame already uses the hero pose (watch on the right) — nothing glides in on load
updateCameraFromScroll(0);
tick();

// expose for debug
// internals for the screenshot scripts and debugging only: open the page with ?debug (QA L5)
if (DEBUG) window.__chronos = { state, layers, camera, watchRoot, THREE, scene, sound, get keyStops() { return keyStops; } };
if (DEBUG) console.log('[CHRONOS] booted');
