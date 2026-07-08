import * as THREE from 'three';
import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import { createToken } from '@/core/di/ServiceContainer';
import type { GameEventBus } from '@/core/events/GameEvents';
import type { RendererService } from '@/engine/renderer/RendererService';
import { createRng } from '@/terrain/createRng';

declare module '@/core/events/GameEvents' {
  interface GameEvents {
    'calendar:dayChanged': { day: number; month: number; year: number };
    'calendar:monthChanged': { month: number; year: number };
    'weather:changed': { weather: WeatherKind; temperature: number };
  }
}

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'snow';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** Game minutes advanced per simulation tick (30 ticks/s → 1 game day ≈ 48 s). */
const MINUTES_PER_TICK = 1;
const MINUTES_PER_DAY = 1440;
const DAYS_PER_MONTH = 4; // compressed months keep budget cycles snappy
const MONTHS_PER_YEAR = 12;

export const SEASON_BY_MONTH: Season[] = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];

/**
 * Game clock: day/night, months, seasons, weather and temperature.
 * Also drives the sun/sky so time of day is visible. All downstream
 * scheduling (budget, move-ins) hangs off its events.
 */
export class GameCalendar {
  minuteOfDay = 8 * 60; // start 08:00
  day = 1;
  month = 3; // start in spring
  year = 1;
  weather: WeatherKind = 'clear';
  temperature = 15;
  /** Wind in [0,1] — affects pollution spread (Phase 6) and looks (later). */
  wind = 0.3;

  get season(): Season {
    return SEASON_BY_MONTH[this.month - 1];
  }

  /** [0,1) fraction of the day; 0.5 = noon. */
  get dayFraction(): number {
    return this.minuteOfDay / MINUTES_PER_DAY;
  }

  get isNight(): boolean {
    return this.minuteOfDay < 6 * 60 || this.minuteOfDay >= 20 * 60;
  }

  get clockLabel(): string {
    const h = Math.floor(this.minuteOfDay / 60);
    const m = Math.floor(this.minuteOfDay % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  get dateLabel(): string {
    return `${this.year}年${this.month}月 第${this.day}天`;
  }
}

export const CalendarToken = createToken<GameCalendar>('simulation.calendar');

export class CalendarSystem extends System {
  readonly name = 'CalendarSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 0;

  private readonly rng = createRng(0xca1e0da);
  private readonly sunColor = new THREE.Color();
  private readonly skyColor = new THREE.Color();
  private readonly skyDay = new THREE.Color(0x87b5d9);
  private readonly skyNight = new THREE.Color(0x0e1626);
  private readonly skyDawn = new THREE.Color(0xd9a06a);

  constructor(
    private readonly calendar: GameCalendar,
    private readonly renderer: RendererService,
    private readonly events: GameEventBus,
  ) {
    super();
  }

  update(_world: World, _ctx: TickContext): void {
    const cal = this.calendar;
    cal.minuteOfDay += MINUTES_PER_TICK;
    if (cal.minuteOfDay >= MINUTES_PER_DAY) {
      cal.minuteOfDay -= MINUTES_PER_DAY;
      cal.day++;
      if (cal.day > DAYS_PER_MONTH) {
        cal.day = 1;
        cal.month++;
        if (cal.month > MONTHS_PER_YEAR) {
          cal.month = 1;
          cal.year++;
        }
        this.events.enqueue('calendar:monthChanged', { month: cal.month, year: cal.year });
      }
      this.rollWeather();
      this.events.enqueue('calendar:dayChanged', {
        day: cal.day,
        month: cal.month,
        year: cal.year,
      });
    }
    this.updateTemperature();
    this.updateLighting();
  }

  private rollWeather(): void {
    const cal = this.calendar;
    const roll = this.rng();
    const cold = cal.temperature < 2;
    let next: WeatherKind;
    if (roll < 0.5) next = 'clear';
    else if (roll < 0.75) next = 'cloudy';
    else next = cold ? 'snow' : 'rain';
    if (next !== cal.weather) {
      cal.weather = next;
      this.events.enqueue('weather:changed', {
        weather: next,
        temperature: cal.temperature,
      });
    }
    cal.wind = 0.15 + this.rng() * 0.6;
  }

  private updateTemperature(): void {
    const cal = this.calendar;
    const seasonBase: Record<Season, number> = {
      winter: -2,
      spring: 12,
      summer: 24,
      autumn: 13,
    };
    // Daily curve peaks mid-afternoon.
    const daily = Math.sin((cal.dayFraction - 0.29) * Math.PI * 2) * 6;
    const overcast = cal.weather === 'clear' ? 0 : -3;
    cal.temperature = seasonBase[cal.season] + daily + overcast;
  }

  private updateLighting(): void {
    const cal = this.calendar;
    const renderer = this.renderer;
    // Sun elevation: sin over the day, clamped below horizon at night.
    const solar = Math.sin((cal.dayFraction - 0.25) * Math.PI * 2);
    const elevation = Math.max(solar, -0.25);

    const dayness = THREE.MathUtils.clamp((solar + 0.15) * 2.2, 0, 1);
    const duskness = THREE.MathUtils.clamp(1 - Math.abs(solar) * 5, 0, 1);

    renderer.sun.intensity = 0.15 + dayness * 2.1;
    this.sunColor.setHex(0xfff2dd).lerp(new THREE.Color(0xff9a55), duskness);
    renderer.sun.color.copy(this.sunColor);

    const angle = (cal.dayFraction - 0.25) * Math.PI * 2;
    const target = renderer.sun.target.position;
    renderer.sun.position.set(
      target.x + Math.cos(angle) * 380,
      target.y + Math.max(elevation, 0.06) * 500,
      target.z + Math.sin(angle) * 200,
    );

    renderer.ambient.intensity = 0.25 + dayness * 0.7;

    this.skyColor.copy(this.skyNight).lerp(this.skyDay, dayness).lerp(this.skyDawn, duskness * 0.5);
    if (cal.weather !== 'clear') this.skyColor.multiplyScalar(0.75);
    (renderer.scene.background as THREE.Color).copy(this.skyColor);
    if (renderer.scene.fog) {
      (renderer.scene.fog as THREE.Fog).color.copy(this.skyColor);
    }
  }
}
