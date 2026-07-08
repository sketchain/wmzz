import type { CityStats, StatSeries } from '@/simulation/CityStats';
import { el, statRow, UiWindow, type UiShell } from '../UiShell';

function drawSeries(
  canvas: HTMLCanvasElement,
  series: StatSeries,
  color: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const values = series.values();
  if (values.length < 2) {
    ctx.fillStyle = '#5a6b80';
    ctx.font = '11px sans-serif';
    ctx.fillText('数据积累中…（每月采样）', 8, height / 2);
    return;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (max - min < 1e-6) max = min + 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  values.forEach((value, i) => {
    const x = (i / (values.length - 1)) * (width - 8) + 4;
    const y = height - 6 - ((value - min) / (max - min)) * (height - 12);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#8fa3bd';
  ctx.font = '10px sans-serif';
  ctx.fillText(max.toFixed(0), 4, 10);
  ctx.fillText(min.toFixed(0), 4, height - 2);
}

/** Charts: population / treasury / happiness history + live indicators. */
export class StatsWindow {
  readonly window: UiWindow;
  private readonly charts: [HTMLCanvasElement, () => StatSeries, string][] = [];
  private readonly values: Record<string, HTMLElement>;

  constructor(shell: UiShell, private readonly stats: CityStats) {
    this.window = new UiWindow(shell, '城市统计', 24, 120);
    const body = this.window.body;

    const addChart = (label: string, series: () => StatSeries, color: string): void => {
      body.appendChild(el('div', 'wui-section', label));
      const canvas = el('canvas', 'wui-chart');
      canvas.width = 260;
      canvas.height = 70;
      body.appendChild(canvas);
      this.charts.push([canvas, series, color]);
    };
    addChart('人口', () => this.stats.populationHistory, '#5fd08a');
    addChart('国库', () => this.stats.treasuryHistory, '#e0c06a');
    addChart('幸福度', () => this.stats.happinessHistory, '#6aa8e0');

    body.appendChild(el('div', 'wui-section', '实时指标'));
    this.values = {
      jobs: statRow(body, '就业/岗位'),
      unemployment: statRow(body, '失业率'),
      education: statRow(body, '教育覆盖'),
      health: statRow(body, '医疗覆盖'),
      power: statRow(body, '电力'),
      water: statRow(body, '供水'),
      garbage: statRow(body, '垃圾堆积'),
      pollution: statRow(body, '平均污染'),
    };
  }

  refresh(): void {
    if (!this.window.isVisible) return;
    for (const [canvas, series, color] of this.charts) {
      drawSeries(canvas, series(), color);
    }
    const stats = this.stats;
    this.values.jobs.textContent = `${stats.jobsFilled}/${stats.jobsTotal}`;
    this.values.unemployment.textContent = `${(stats.unemployment * 100).toFixed(1)}%`;
    this.values.education.textContent = `${(stats.education * 100).toFixed(0)}%`;
    this.values.health.textContent = `${(stats.health * 100).toFixed(0)}%`;
    this.values.power.textContent = `${Math.round(stats.powerDemand)}/${Math.round(stats.powerSupply)} kW`;
    this.values.water.textContent = `${Math.round(stats.waterDemand)}/${Math.round(stats.waterSupply)}`;
    this.values.garbage.textContent = `${Math.round(stats.garbageAccumulated)}`;
    this.values.pollution.textContent = stats.averagePollution.toFixed(2);
  }
}
