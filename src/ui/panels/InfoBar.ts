import type { Scheduler } from '@/core/ecs';
import { GameConfig } from '@/config/GameConfig';
import type { CityStats } from '@/simulation/CityStats';
import type { GameCalendar } from '@/simulation/systems/CalendarSystem';
import { el, type UiShell } from '../UiShell';

const WEATHER_ICONS: Record<string, string> = {
  clear: '☀',
  cloudy: '☁',
  rain: '🌧',
  snow: '❄',
};

/** Top HUD: clock, weather, population, treasury, happiness, RCI, speed. */
export class InfoBar {
  private readonly values = new Map<string, HTMLElement>();
  private readonly demandBars: HTMLDivElement[] = [];
  private readonly speedButtons: HTMLButtonElement[] = [];
  private speedIndex = 0;

  constructor(
    shell: UiShell,
    private readonly stats: CityStats,
    private readonly calendar: GameCalendar,
    private readonly scheduler: Scheduler,
  ) {
    const bar = el('div', 'wui-infobar wui-panel');

    const addStat = (key: string, label: string): void => {
      const stat = el('div', 'stat');
      const value = el('div', 'v', '—');
      stat.append(value, el('div', 'k', label));
      bar.appendChild(stat);
      this.values.set(key, value);
    };

    addStat('time', '时间');
    addStat('weather', '天气');
    addStat('population', '人口');
    addStat('treasury', '资金');
    addStat('happiness', '幸福度');
    addStat('level', '城市等级');

    // RCI demand bars.
    const demandWrap = el('div', 'stat');
    const bars = el('div', 'demand');
    for (const color of ['#3fae53', '#3f7fd8', '#d8a03f', '#3fc8c0']) {
      const bar2 = el('div');
      bar2.style.background = color;
      bars.appendChild(bar2);
      this.demandBars.push(bar2);
    }
    demandWrap.append(bars, el('div', 'k', 'RCI需求'));
    bar.appendChild(demandWrap);

    // Speed controls.
    const speedWrap = el('div', 'stat');
    const buttons = el('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '3px';
    const pause = el('button', 'wui-btn', '⏸');
    pause.addEventListener('click', () => this.scheduler.setPaused(!this.scheduler.paused));
    buttons.appendChild(pause);
    this.speedButtons.push(pause);
    GameConfig.simulation.speedLevels.forEach((level, i) => {
      const button = el('button', 'wui-btn', `${level}×`);
      button.addEventListener('click', () => {
        this.speedIndex = i;
        this.scheduler.setPaused(false);
        this.scheduler.setTimeScale(level);
      });
      buttons.appendChild(button);
      this.speedButtons.push(button);
    });
    speedWrap.append(buttons, el('div', 'k', '速度'));
    bar.appendChild(speedWrap);

    shell.root.appendChild(bar);
  }

  refresh(): void {
    const set = (key: string, value: string): void => {
      const node = this.values.get(key);
      if (node && node.textContent !== value) node.textContent = value;
    };
    set('time', `${this.calendar.month}月${this.calendar.day}日 ${this.calendar.clockLabel}`);
    set(
      'weather',
      `${WEATHER_ICONS[this.calendar.weather] ?? ''} ${this.calendar.temperature.toFixed(0)}°C`,
    );
    set('population', this.stats.population.toLocaleString());
    set('treasury', `$${Math.round(this.stats.treasury).toLocaleString()}`);
    set('happiness', `${Math.round(this.stats.happiness * 100)}%`);
    set('level', `Lv.${this.stats.cityLevel}`);

    const demands = [
      this.stats.demandResidential,
      this.stats.demandCommercial,
      this.stats.demandIndustrial,
      this.stats.demandOffice,
    ];
    demands.forEach((demand, i) => {
      this.demandBars[i].style.height = `${Math.max(8, demand * 100)}%`;
    });

    this.speedButtons.forEach((button, i) => {
      const active = this.scheduler.paused ? i === 0 : i === this.speedIndex + 1;
      button.classList.toggle('active', active);
    });
  }
}
