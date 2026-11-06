export function articulateCrawler(model, bend, twist, pitch) {
  const {front, rear} = model.pods;
  front.rotation.set(twist / 2, bend / 2, pitch / 2, 'YXZ');
  rear.rotation.set(-twist / 2, -bend / 2, -pitch / 2, 'YXZ');
}

export function easeBetween(value, start, end) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function tiltPropulsion(model, cruise, revolutions) {
  // The STEP assembly rotates around CAD +Y, which is model -Z.
  for (const pod of model.tiltPods.values()) pod.rotation.z = -Math.PI / 2 * cruise;
  for (const [name, rotor] of model.rotors) {
    rotor.rotation.y = (name === 'FR' ? -1 : 1) * revolutions * 2 * Math.PI;
  }
}

export function deflectSurfaces(model, roll, yaw, pitch) {
  for (const [name, surface] of model.controlSurfaces) {
    if (name.startsWith('P24_aileron_')) {
      // Right roll raises the right aileron and lowers the left.
      surface.rotation.z = roll * (name.endsWith('_L') ? .73 : -.73);
    } else if (name.startsWith('P31_rudder_')) {
      surface.rotation.y = -yaw * .82;
    } else {
      surface.rotation.z = -pitch * .92;
    }
  }
}
