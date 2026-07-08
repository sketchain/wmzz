import { NULL_ENTITY, type Entity, type World } from '@/core/ecs';
import { Transform } from '@/engine/components';
import {
  Abandoned,
  Building,
  BuildingEcon,
  BuildingMeta,
  OnFire,
  PowerShortage,
  UnderConstruction,
  WaterShortage,
} from '@/buildings/components';
import { ZONE_LABELS, type ZoneId } from '@/data/buildingPrototypes';
import { el, statRow, UiWindow, type UiShell } from '../UiShell';

/**
 * Building inspector. While active, clicking the map selects the nearest
 * building within 14 m of the ground hit and live-updates its details.
 */
export class InspectorWindow {
  readonly window: UiWindow;
  active = false;
  private selected: Entity = NULL_ENTITY;
  private readonly values: Record<string, HTMLElement>;
  private readonly title: HTMLElement;
  private readonly flags: HTMLElement;

  constructor(shell: UiShell, private readonly world: World) {
    this.window = new UiWindow(shell, '建筑检查器', window.innerWidth - 300, 80);
    const body = this.window.body;
    this.title = el('div', 'wui-section', '点击地图中的建筑');
    body.appendChild(this.title);
    this.values = {
      zone: statRow(body, '类型'),
      level: statRow(body, '等级'),
      occupants: statRow(body, '居民/岗位'),
      condition: statRow(body, '状况'),
      landValue: statRow(body, '地价'),
      tax: statRow(body, '税基'),
      power: statRow(body, '电力需求'),
      water: statRow(body, '用水需求'),
    };
    this.flags = el('div', '');
    this.flags.style.marginTop = '6px';
    this.flags.style.color = '#e0b06a';
    body.appendChild(this.flags);
  }

  /** Try to select a building near a world position. */
  pick(x: number, z: number): boolean {
    const transforms = this.world.soa(Transform);
    const query = this.world.query({ all: [Building, Transform] });
    let best: Entity = NULL_ENTITY;
    let bestD2 = 14 * 14;
    query.forEach((entity) => {
      const t = transforms.denseIndexOf(entity & 0xffffff);
      const d2 =
        (transforms.fields.x[t] - x) ** 2 + (transforms.fields.z[t] - z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = entity;
      }
    });
    if (best === NULL_ENTITY) return false;
    this.selected = best;
    this.window.show();
    this.refresh();
    return true;
  }

  refresh(): void {
    if (!this.window.isVisible) return;
    const entity = this.selected;
    if (entity === NULL_ENTITY || !this.world.isAlive(entity)) {
      this.title.textContent = '点击地图中的建筑';
      return;
    }
    const building = this.world.read(entity, Building);
    const econ = this.world.read(entity, BuildingEcon);
    if (!building || !econ) return;
    const meta = this.world.getObject(entity, BuildingMeta);
    this.title.textContent = meta?.name ?? '建筑';
    this.values.zone.textContent = ZONE_LABELS[building.zone as ZoneId] ?? '服务设施';
    this.values.level.textContent = `Lv.${building.level}`;
    this.values.occupants.textContent = `${econ.occupants}/${econ.capacity}`;
    this.values.condition.textContent = `${Math.round(econ.condition * 100)}%`;
    this.values.landValue.textContent = `${Math.round(econ.landValue * 100)}%`;
    this.values.tax.textContent = `$${econ.taxBase.toFixed(0)}/月`;
    this.values.power.textContent = `${econ.powerDemand.toFixed(0)} kW`;
    this.values.water.textContent = `${econ.waterDemand.toFixed(0)}`;

    const flags: string[] = [];
    if (this.world.hasComponent(entity, UnderConstruction)) flags.push('🏗 建设中');
    if (this.world.hasComponent(entity, PowerShortage)) flags.push('⚡ 缺电');
    if (this.world.hasComponent(entity, WaterShortage)) flags.push('💧 缺水');
    if (this.world.hasComponent(entity, Abandoned)) flags.push('🏚 废弃');
    if (this.world.hasComponent(entity, OnFire)) flags.push('🔥 火灾');
    this.flags.textContent = flags.join('  ');
  }
}
