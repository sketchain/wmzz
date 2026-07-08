import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import type { GameEventBus } from '@/core/events/GameEvents';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import { ROAD_PROFILES } from '@/roads/RoadTypes';
import {
  ZONE_COMMERCIAL,
  ZONE_INDUSTRIAL,
  ZONE_OFFICE,
  ZONE_RESIDENTIAL,
  type ZoneId,
} from '@/data/buildingPrototypes';
import {
  Abandoned,
  Building,
  BuildingEcon,
  ServiceBuilding,
  UnderConstruction,
} from '@/buildings/components';
import type { DemandProvider } from '@/buildings/systems/GrowthSystem';
import type { CityStats } from '../CityStats';
import type { GameCalendar } from './CalendarSystem';

declare module '@/core/events/GameEvents' {
  interface GameEvents {
    'economy:spend': { amount: number; reason: string };
    'economy:monthClosed': { income: number; expenses: number; treasury: number };
    'economy:loanTaken': { amount: number };
  }
}

const DEMAND_INTERVAL = 60;
const DEMAND_PHASE = 11;
/** Loan terms: 5% monthly interest on outstanding principal, 24-month payoff. */
const LOAN_MONTHLY_RATE = 0.05;
const LOAN_TERM_MONTHS = 24;

/**
 * Treasury, taxes, upkeep, loans, the economic cycle and RCI demand.
 *
 * Monthly close (calendar months): income = occupancy-weighted taxes ×
 * economic cycle; expenses = road + service upkeep + loan payments. RCI
 * demand recomputes continuously from housing vacancy, jobs balance and
 * commerce-to-population ratio — the same numbers players reason about.
 */
export class EconomySystem extends System implements DemandProvider {
  readonly name = 'EconomySystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 30;

  private monthPending = false;

  constructor(
    private readonly stats: CityStats,
    private readonly roads: RoadNetwork,
    private readonly calendar: GameCalendar,
    private readonly events: GameEventBus,
  ) {
    super();
  }

  override init(): void {
    this.events.on('calendar:monthChanged', () => {
      this.monthPending = true;
    });
    this.events.on('road:built', ({ cost }) => this.spend(cost, 'road'));
    this.events.on('economy:spend', ({ amount }) => {
      this.stats.treasury -= amount;
    });
  }

  demand(zone: Exclude<ZoneId, 0>): number {
    switch (zone) {
      case ZONE_RESIDENTIAL:
        return this.stats.demandResidential;
      case ZONE_COMMERCIAL:
        return this.stats.demandCommercial;
      case ZONE_INDUSTRIAL:
        return this.stats.demandIndustrial;
      case ZONE_OFFICE:
        return this.stats.demandOffice;
    }
  }

  takeLoan(amount: number): void {
    this.stats.loanPrincipal += amount;
    this.stats.treasury += amount;
    this.recomputeLoanPayment();
    this.events.emit('economy:loanTaken', { amount });
  }

  update(world: World, ctx: TickContext): void {
    if (ctx.tick % DEMAND_INTERVAL === DEMAND_PHASE) this.updateDemand(world);
    if (this.monthPending) {
      this.monthPending = false;
      this.closeMonth(world);
    }
  }

  private spend(amount: number, reason: string): void {
    this.stats.treasury -= amount;
    void reason;
  }

  private updateDemand(world: World): void {
    const stats = this.stats;
    const buildings = world.soa(Building);
    const econ = world.soa(BuildingEcon);
    const query = world.query({ all: [Building, BuildingEcon], none: [UnderConstruction, Abandoned] });

    let resCapacity = 0;
    let resOccupied = 0;
    let comCapacity = 0;
    const entities = query.entities;
    for (let i = 0; i < query.size; i++) {
      const index = entities[i] & 0xffffff;
      const b = buildings.denseIndexOf(index);
      const e = econ.denseIndexOf(index);
      const zone = buildings.fields.zone[b];
      if (zone === ZONE_RESIDENTIAL) {
        resCapacity += econ.fields.capacity[e];
        resOccupied += econ.fields.occupants[e];
      } else if (zone === ZONE_COMMERCIAL) {
        comCapacity += econ.fields.capacity[e];
      }
    }

    const vacancy = resCapacity > 0 ? 1 - resOccupied / resCapacity : 0;
    const young = stats.population < 400;
    const bootstrap = young ? 0.35 : 0;

    // Housing demand: people come when jobs beat unemployment and housing
    // isn't sitting empty; high taxes suppress it. Young cities keep a
    // demand floor — otherwise "all houses empty" reads as "no demand" and
    // the city can never start.
    stats.demandResidential = clamp01(
      Math.max(
        young ? 0.6 : 0,
        0.55 + bootstrap - vacancy * 1.4 - stats.unemployment * 0.7 -
          (stats.taxRateResidential - 0.09) * 4 + stats.happiness * 0.25,
      ),
    );
    // Commerce follows population: roughly 1 commercial job per 5 residents.
    stats.demandCommercial = clamp01(
      (stats.population / 5 - comCapacity) / Math.max(120, comCapacity * 0.5) +
        bootstrap * 0.5 - (stats.taxRateCommercial - 0.09) * 4,
    );
    // Industry & office absorb unemployment (office prefers education).
    stats.demandIndustrial = clamp01(
      0.25 + stats.unemployment * 1.6 + bootstrap * 0.5 -
        (stats.taxRateIndustrial - 0.09) * 4,
    );
    stats.demandOffice = clamp01(
      stats.unemployment * 1.1 + stats.education * 0.5 - 0.1 -
        (stats.taxRateOffice - 0.09) * 4,
    );
  }

  private closeMonth(world: World): void {
    const stats = this.stats;
    // Economic cycle: slow wave + calendar-seeded jitter, stays in [0.8, 1.2].
    const phase = (this.calendar.year * 12 + this.calendar.month) / 30;
    stats.economicCycle =
      1 + 0.14 * Math.sin(phase * Math.PI * 2) + 0.05 * Math.sin(phase * Math.PI * 7.3);

    // Income: taxes from occupied buildings.
    const buildings = world.soa(Building);
    const econ = world.soa(BuildingEcon);
    const query = world.query({ all: [Building, BuildingEcon], none: [UnderConstruction, Abandoned] });
    let income = 0;
    const entities = query.entities;
    for (let i = 0; i < query.size; i++) {
      const index = entities[i] & 0xffffff;
      const b = buildings.denseIndexOf(index);
      const e = econ.denseIndexOf(index);
      const capacity = econ.fields.capacity[e];
      if (capacity === 0) continue;
      const occupancy = econ.fields.occupants[e] / capacity;
      const rate = this.taxRateFor(buildings.fields.zone[b] as ZoneId);
      income += econ.fields.taxBase[e] * occupancy * (rate / 0.09);
    }
    income *= stats.economicCycle;

    // Expenses: road upkeep + service upkeep + loan payment.
    let expenses = 0;
    for (const edge of this.roads.edges.values()) {
      expenses += edge.length * ROAD_PROFILES[edge.kind].upkeepPerMeter;
    }
    const services = world.soa(ServiceBuilding);
    const serviceQuery = world.query({ all: [ServiceBuilding] });
    const serviceEntities = serviceQuery.entities;
    for (let i = 0; i < serviceQuery.size; i++) {
      const s = services.denseIndexOf(serviceEntities[i] & 0xffffff);
      expenses += services.fields.upkeep[s];
    }
    if (stats.loanPrincipal > 0) {
      const payment = Math.min(
        stats.loanMonthlyPayment,
        stats.loanPrincipal * (1 + LOAN_MONTHLY_RATE),
      );
      stats.loanPrincipal = Math.max(
        0,
        stats.loanPrincipal * (1 + LOAN_MONTHLY_RATE) - payment,
      );
      expenses += payment;
      if (stats.loanPrincipal === 0) stats.loanMonthlyPayment = 0;
    }

    stats.monthlyIncome = income;
    stats.monthlyExpenses = expenses;
    stats.treasury += income - expenses;

    stats.populationHistory.push(stats.population);
    stats.treasuryHistory.push(stats.treasury);
    stats.happinessHistory.push(stats.happiness);

    this.events.enqueue('economy:monthClosed', {
      income,
      expenses,
      treasury: stats.treasury,
    });
  }

  private taxRateFor(zone: ZoneId): number {
    switch (zone) {
      case ZONE_RESIDENTIAL:
        return this.stats.taxRateResidential;
      case ZONE_COMMERCIAL:
        return this.stats.taxRateCommercial;
      case ZONE_INDUSTRIAL:
        return this.stats.taxRateIndustrial;
      case ZONE_OFFICE:
        return this.stats.taxRateOffice;
      default:
        return 0;
    }
  }

  private recomputeLoanPayment(): void {
    // Even principal+interest amortization.
    const p = this.stats.loanPrincipal;
    this.stats.loanMonthlyPayment =
      (p * LOAN_MONTHLY_RATE) / (1 - (1 + LOAN_MONTHLY_RATE) ** -LOAN_TERM_MONTHS);
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
