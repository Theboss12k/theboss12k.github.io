const header = document.querySelector('.site-header');
const progress = document.querySelector('.reading-progress');
const arm = document.querySelector('.arm-render');
const shoulderJoint = arm.querySelector('[data-arm-shoulder]');
const elbowJoint = arm.querySelector('[data-arm-elbow]');
const wristJoint = arm.querySelector('[data-arm-wrist]');
const armCargo = arm.querySelector('[data-arm-cargo]');
const armFingers = [...arm.querySelectorAll('[data-arm-finger]')];
const stages = [...document.querySelectorAll('[data-scroll-stage]')];
const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
const navigation = Array.from(document.querySelectorAll('.nav a'), link => ({
  link,
  section: document.getElementById(link.hash.slice(1)),
}));
const liquidEdges = navigation.map(({ section }) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'liquid-edge');
  svg.setAttribute('viewBox', '0 0 1440 150');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const layer of ['wash', 'crest', 'surface']) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('class', layer);
    svg.append(path);
  }
  section.prepend(svg);
  return [...svg.children];
});

function liquidPath(amount, layer, index) {
  amount = Math.sqrt(amount);
  const phase = amount * Math.PI * 1.8 + index * .75;
  const lift = layer * 9 * amount;
  const a = 150 - amount * (58 + 42 * Math.sin(phase)) - lift;
  const b = 150 - amount * (70 + 65 * Math.sin(phase + 1.4)) - lift;
  const c = 150 - amount * (70 + 65 * Math.sin(phase + 3.2)) - lift;
  const d = 150 - amount * (58 + 42 * Math.sin(phase + 4.5)) - lift;
  return `M0 ${a} C180 ${a} 300 ${b} 480 ${b} S780 ${c} 960 ${c} S1260 ${d} 1440 ${d} L1440 152 H0 Z`;
}

let framePending = false;
let activeLink;

function scrollEntry(top, height, remaining, endRatio) {
  const start = height * .97;
  // A short final section can settle even if it never reaches the usual reading line.
  const end = Math.min(start - 1, Math.max(height * endRatio, top - remaining));
  const fraction = Math.max(0, Math.min(1, (start - top) / (start - end)));
  return fraction * fraction * (3 - 2 * fraction);
}

function poseArm(amount) {
  const ease = fraction => {
    const t = Math.max(0, Math.min(1, fraction));
    return t * t * (3 - 2 * t);
  };
  const reach = ease(amount / .52);
  const grip = ease((amount - .52) / .16);
  const lift = ease((amount - .68) / .32);
  const toolAngle = -33 + 123 * reach;
  const radians = Math.PI / 180;
  const homeX = 244 + 125 * Math.cos(-60 * radians) + 95 * Math.cos(-119 * radians) + 66 * Math.cos(-33 * radians);
  const homeY = 318 + 125 * Math.sin(-60 * radians) + 95 * Math.sin(-119 * radians) + 66 * Math.sin(-33 * radians);
  const cargoX = 110 + 33 * lift;
  const cargoY = 346 - 122 * lift;
  const tipX = homeX * (1 - reach) + cargoX * reach;
  const tipY = homeY * (1 - reach) + cargoY * reach;
  const dx = tipX - 66 * Math.cos(toolAngle * radians) - 244;
  const dy = tipY - 66 * Math.sin(toolAngle * radians) - 318;
  const cosine = (dx ** 2 + dy ** 2 - 125 ** 2 - 95 ** 2) / (2 * 125 * 95);
  const elbow = -Math.acos(Math.max(-1, Math.min(1, cosine)));
  const shoulder = Math.atan2(dy, dx) - Math.atan2(95 * Math.sin(elbow), 125 + 95 * Math.cos(elbow));
  shoulderJoint.setAttribute('transform', `rotate(${shoulder / radians})`);
  elbowJoint.setAttribute('transform', `rotate(${elbow / radians})`);
  wristJoint.setAttribute('transform', `rotate(${toolAngle - (shoulder + elbow) / radians})`);
  armCargo.setAttribute('transform', `translate(${cargoX} ${cargoY})`);
  for (const finger of armFingers) finger.setAttribute('transform', `translate(0 ${3 * grip * Number(finger.dataset.armFinger)})`);
}

function updateScrollState() {
  framePending = false;
  const height = window.innerHeight;
  const scrollRange = document.documentElement.scrollHeight - height;
  const position = Math.max(0, window.scrollY);
  const portion = scrollRange > 0 ? Math.min(1, position / scrollRange) : 0;
  const remaining = Math.max(0, scrollRange - position);
  const readingLine = header.offsetHeight + 54;
  const sectionTops = navigation.map(({ section }) => section.getBoundingClientRect().top);
  const stageTops = motion.matches ? stages.map(stage => stage.getBoundingClientRect().top) : [];

  const armBounds = arm.getBoundingClientRect();

  progress.style.transform = `scaleX(${portion})`;
  if (motion.matches) {
    const handoff = scrollEntry(armBounds.top, height, remaining, .48);
    poseArm(handoff);
    for (const [index, top] of sectionTops.entries()) {
      const amount = scrollEntry(top, height, remaining, .34);
      navigation[index].section.style.setProperty('--cut', amount.toFixed(4));
      liquidEdges[index].forEach((path, layer) => path.setAttribute('d', liquidPath(amount, 2 - layer, index)));
    }
    for (const [index, top] of stageTops.entries()) {
      stages[index].style.setProperty('--entry', scrollEntry(top, height, remaining, .57).toFixed(4));
    }
  } else {
    poseArm(0);
  }

  let current;
  for (const [index, top] of sectionTops.entries()) {
    if (top <= readingLine) current = navigation[index].link;
  }
  if (portion >= .995) current = navigation.at(-1).link;
  if (current === activeLink) return;
  activeLink?.removeAttribute('aria-current');
  current?.setAttribute('aria-current', 'location');
  activeLink = current;
}

function scheduleScrollUpdate() {
  if (framePending) return;
  framePending = true;
  window.requestAnimationFrame(updateScrollState);
}

window.addEventListener('scroll', scheduleScrollUpdate, { passive: true });
window.addEventListener('resize', scheduleScrollUpdate);
window.addEventListener('pageshow', scheduleScrollUpdate);
document.addEventListener('toggle', scheduleScrollUpdate, true);
motion.addEventListener('change', scheduleScrollUpdate);
scheduleScrollUpdate();

const demos = [...document.querySelectorAll('.player video')];
for (const demo of demos) {
  demo.addEventListener('play', () => {
    for (const other of demos) {
      if (other !== demo && !other.paused) other.pause();
    }
  });
}

const welcome = document.querySelector('.welcome');
const demoVisibility = new Map();
let autoplayTarget = null;

function syncDemoPlayback() {
  let next = null;
  let bestRatio = .55;
  if (motion.matches && !document.hidden && !welcome.open) {
    for (const demo of demos) {
      const ratio = demoVisibility.get(demo) ?? 0;
      if (ratio >= bestRatio) {
        bestRatio = ratio;
        next = demo;
      }
    }
  }

  if (next === autoplayTarget) return;
  autoplayTarget?.pause();
  autoplayTarget = next;
  if (next?.paused) {
    next.muted = true;
    // Native controls remain available if the browser blocks autoplay.
    next.play().catch(() => {});
  }
}

const demoObserver = new IntersectionObserver(entries => {
  for (const entry of entries) demoVisibility.set(entry.target, entry.intersectionRatio);
  syncDemoPlayback();
}, {threshold: [0, .55, .75, 1]});
for (const demo of demos) demoObserver.observe(demo);
document.addEventListener('visibilitychange', syncDemoPlayback);
motion.addEventListener('change', syncDemoPlayback);
welcome.addEventListener('close', syncDemoPlayback);

let exitTimer;
let returnFocus;

function finishWelcome() {
  clearTimeout(exitTimer);
  welcome.close();
  welcome.classList.remove('leaving');
  document.documentElement.classList.remove('welcome-open');
  returnFocus?.focus({ preventScroll: true });
  scheduleScrollUpdate();
}

function enterPortfolio() {
  if (!welcome.open || welcome.classList.contains('leaving')) return;
  if (!motion.matches) {
    finishWelcome();
    return;
  }
  welcome.classList.add('leaving');
  // The timeout also handles a preference change during the exit transition.
  exitTimer = setTimeout(finishWelcome, 1350);
}

function showWelcome() {
  returnFocus = document.activeElement;
  welcome.classList.remove('leaving');
  document.documentElement.classList.add('welcome-open');
  welcome.showModal();
  syncDemoPlayback();
}

welcome.addEventListener('cancel', event => {
  event.preventDefault();
  enterPortfolio();
});
welcome.querySelector('[data-enter]').addEventListener('click', enterPortfolio);

if (typeof welcome.showModal === 'function') showWelcome();
