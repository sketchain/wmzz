import { defineComponent, defineTag } from '@/core/ecs';

/**
 * Shared spatial components — buildings, vehicles, citizens and props all
 * carry Transform; renderers read it, simulation systems write it.
 */
export const Transform = defineComponent('spatial.Transform', {
  x: 'f32',
  y: 'f32',
  z: 'f32',
  /** Yaw in radians. */
  rot: 'f32',
  /** Uniform footprint scale. */
  scale: 'f32',
}, { scale: 1 });

export const Selected = defineTag('spatial.Selected');
export const Hidden = defineTag('spatial.Hidden');
