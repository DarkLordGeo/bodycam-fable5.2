// Central tunables. Every camera effect can be tuned (or zeroed) independently.
export const CFG = {
  camera: {
    fov: 90, // vertical, degrees
    aimFov: 80,
    sprintFov: 94,
    height: 1.5, // chest/upper-body mount
    crouchHeight: 0.92,
    forwardOffset: 0.1,
    followFreq: 19, // Hz-ish stiffness of camera following the aim direction (lower = more inertia)
    followDamping: 0.82,
    rollStrafe: 0.014,
    rollTurn: 0.022,
    bobVertical: 0.02,
    bobLateral: 0.013,
    bobRoll: 0.006,
    sprintBobMul: 2.1,
    crouchBobMul: 0.6,
    breathing: 0.0035,
    microShake: 0.0016,
    sensitivity: 0.0021,
  },
  effects: {
    distortion: 0.11, // barrel distortion strength
    chromaticAberration: 0.0045, // edge-weighted
    vignette: 0.55,
    grain: 0.022,
    motionBlur: 0.55, // shutter fraction
    edgeSoftness: 0.004,
    bloom: 0.45,
    exposure: 1.0,
    saturation: 0.86,
    contrast: 1.06,
    autoExposureSpeed: 1.6,
  },
  player: {
    walkSpeed: 3.0,
    sprintSpeed: 5.5,
    crouchSpeed: 1.6,
    aimSpeed: 2.0,
    accel: 34,
    decel: 26,
    gravity: 22,
    radius: 0.32,
    standHalf: 0.55,
    crouchHalf: 0.24,
    health: 100,
  },
  quality: { shadowMap: 2048, msaa: 4, maxPixelRatio: 1.5 },
};
export type Config = typeof CFG;
