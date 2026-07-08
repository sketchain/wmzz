import type { CityStats } from '@/simulation/CityStats';
import type { EconomySystem } from '@/simulation/systems/EconomySystem';
import { el, statRow, UiWindow, type UiShell } from '../UiShell';

/** Budget: income/expense breakdown, per-zone tax sliders, loans. */
export class BudgetWindow {
  readonly window: UiWindow;
  private readonly values: Record<string, HTMLElement>;
  private readonly sliders: HTMLInputElement[] = [];

  constructor(
    shell: UiShell,
    private readonly stats: CityStats,
    private readonly economy: EconomySystem,
  ) {
    this.window = new UiWindow(shell, '城市预算', 24, 80);
    const body = this.window.body;

    body.appendChild(el('div', 'wui-section', '月度收支'));
    this.values = {
      income: statRow(body, '税收收入'),
      expenses: statRow(body, '维护支出'),
      net: statRow(body, '净收益'),
      treasury: statRow(body, '国库'),
      cycle: statRow(body, '经济周期'),
    };

    body.appendChild(el('div', 'wui-section', '税率'));
    const taxes: ['taxRateResidential' | 'taxRateCommercial' | 'taxRateIndustrial' | 'taxRateOffice', string][] = [
      ['taxRateResidential', '住宅'],
      ['taxRateCommercial', '商业'],
      ['taxRateIndustrial', '工业'],
      ['taxRateOffice', '办公'],
    ];
    for (const [field, label] of taxes) {
      const row = el('div', 'wui-row');
      const labelNode = el('span', 'k', `${label} 9%`);
      row.appendChild(labelNode);
      body.appendChild(row);
      const slider = el('input', 'wui-slider') as HTMLInputElement;
      slider.type = 'range';
      slider.min = '1';
      slider.max = '20';
      slider.value = String(Math.round(this.stats[field] * 100));
      slider.addEventListener('input', () => {
        const rate = Number(slider.value) / 100;
        this.stats[field] = rate;
        labelNode.textContent = `${label} ${slider.value}%`;
      });
      labelNode.textContent = `${label} ${slider.value}%`;
      body.appendChild(slider);
      this.sliders.push(slider);
    }

    body.appendChild(el('div', 'wui-section', '贷款'));
    this.values.loan = statRow(body, '未偿本金');
    this.values.payment = statRow(body, '月供');
    const loanButton = el('button', 'wui-btn', '贷款 $25,000');
    loanButton.style.marginTop = '6px';
    loanButton.addEventListener('click', () => this.economy.takeLoan(25000));
    body.appendChild(loanButton);
  }

  refresh(): void {
    const stats = this.stats;
    const money = (v: number): string => `$${Math.round(v).toLocaleString()}`;
    this.values.income.textContent = money(stats.monthlyIncome);
    this.values.expenses.textContent = money(stats.monthlyExpenses);
    const net = stats.monthlyIncome - stats.monthlyExpenses;
    this.values.net.textContent = `${net >= 0 ? '+' : ''}${money(net)}`;
    this.values.net.style.color = net >= 0 ? '#5fd08a' : '#e07a6a';
    this.values.treasury.textContent = money(stats.treasury);
    this.values.cycle.textContent = `${(stats.economicCycle * 100).toFixed(0)}%`;
    this.values.loan.textContent = money(stats.loanPrincipal);
    this.values.payment.textContent = money(stats.loanMonthlyPayment);
  }
}
