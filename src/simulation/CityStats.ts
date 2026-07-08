import { createToken } from '@/core/di/ServiceContainer';

/** Ring buffer for chart history (fixed memory, O(1) push). */
export class StatSeries {
  private readonly data: Float32Array;
  private head = 0;
  private filled = 0;

  constructor(readonly capacity = 240) {
    this.data = new Float32Array(capacity);
  }

  push(value: number): void {
    this.data[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  get length(): number {
    return this.filled;
  }

  /** Oldest→newest copy for rendering. */
  values(): number[] {
    const out: number[] = [];
    const start = (this.head - this.filled + this.capacity) % this.capacity;
    for (let i = 0; i < this.filled; i++) {
      out.push(this.data[(start + i) % this.capacity]);
    }
    return out;
  }

  latest(): number {
    return this.filled === 0 ? 0 : this.data[(this.head - 1 + this.capacity) % this.capacity];
  }
}

/**
 * City-wide aggregated state. Simulation systems write; UI and the growth
 * demand model read. This is a data holder — all rules live in systems.
 */
export class CityStats {
  // Population & jobs
  population = 0;
  households = 0;
  jobsTotal = 0;
  jobsFilled = 0;
  unemployment = 0; // [0,1]

  // Wellbeing composites [0,1]
  happiness = 0.5;
  education = 0;
  health = 0;
  safety = 1;

  // Environment
  averagePollution = 0;
  averageLandValue = 0.4;
  garbageAccumulated = 0;
  garbageCapacity = 0;

  // Utilities
  powerSupply = 0;
  powerDemand = 0;
  waterSupply = 0;
  waterDemand = 0;
  poweredRatio = 1;
  wateredRatio = 1;

  // Economy
  treasury = 50_000;
  monthlyIncome = 0;
  monthlyExpenses = 0;
  taxRateResidential = 0.09;
  taxRateCommercial = 0.09;
  taxRateIndustrial = 0.09;
  taxRateOffice = 0.09;
  loanPrincipal = 0;
  loanMonthlyPayment = 0;
  economicCycle = 1; // multiplier around 1

  // Demand (RCI) in [0,1]
  demandResidential = 0.6;
  demandCommercial = 0.4;
  demandIndustrial = 0.5;
  demandOffice = 0.3;

  // Progression
  cityLevel = 1;

  // Chart history (sampled once per game day)
  readonly populationHistory = new StatSeries();
  readonly treasuryHistory = new StatSeries();
  readonly happinessHistory = new StatSeries();

  /** Milestone thresholds for city levels. */
  static readonly LEVEL_THRESHOLDS = [0, 200, 800, 2400, 6000, 15000, 40000, 100000];

  levelForPopulation(): number {
    let level = 1;
    for (let i = 0; i < CityStats.LEVEL_THRESHOLDS.length; i++) {
      if (this.population >= CityStats.LEVEL_THRESHOLDS[i]) level = i + 1;
    }
    return level;
  }
}

export const CityStatsToken = createToken<CityStats>('simulation.cityStats');
