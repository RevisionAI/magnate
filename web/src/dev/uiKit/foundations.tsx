// UiKit — foundations: colour tokens, owner palette + emblems, chart series,
// profit/loss per colour-vision mode, type scale, spacing, radii and elevation.
// Everything is read from theme/tokens.ts (the single source, MASTER-PLAN §4.8).

import { Emblem } from '@/ui/components';
import { CHART, ELEVATION, FONT_SIZE, OWNER_COLORS, OWNER_EMBLEMS, PROFIT_LOSS, RADIUS, SEVERITY, SPACE, UI, UI_EXT, NEUTRAL_OWNER } from '@/theme/tokens';
import styles from './UiKit.module.css';
import { Group } from './shared';

function Swatch({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div className={styles.swatch}>
      <div className={styles.swatchChip} style={{ background: value }} />
      <div className={styles.swatchMeta}>
        <b>{name}</b>
        <span>{value}</span>
        {note && <div className={styles.caption}>{note}</div>}
      </div>
    </div>
  );
}

const UI_NOTES: Partial<Record<keyof typeof UI, string>> = {
  gold: 'Selection, “yours”, money',
  blue: 'Information',
  green: 'Profit, valid',
  red: 'Loss, invalid',
  amber: 'Warning',
};

export function Foundations() {
  return (
    <>
      <Group title="Semantic UI colours">
        <div className={styles.swatches}>
          {(Object.keys(UI) as (keyof typeof UI)[]).map((k) => (
            <Swatch key={k} name={k} value={UI[k]} note={UI_NOTES[k]} />
          ))}
        </div>
      </Group>
      <Group title="Glass, washes and accents">
        <div className={styles.swatches}>
          {(Object.keys(UI_EXT) as (keyof typeof UI_EXT)[]).map((k) => (
            <Swatch key={k} name={k} value={UI_EXT[k]} />
          ))}
        </div>
      </Group>
      <Group title="Alert severities (UX §6.21)">
        <div className={styles.swatches}>
          {(Object.keys(SEVERITY) as (keyof typeof SEVERITY)[]).map((k) => (
            <Swatch key={k} name={k} value={SEVERITY[k]} />
          ))}
        </div>
      </Group>
      <Group title="Owner colours and emblems (art §3.4 · D15: index 0 is always the player)">
        <div className={styles.grid4}>
          {OWNER_COLORS.map((c, i) => (
            <div key={c} className={styles.owner}>
              <Emblem shape={OWNER_EMBLEMS[i]!} color={c} size={28} ring={i === 0} />
              <div>
                <b>{i === 0 ? 'Player' : `Rival ${i}`}</b>
                <div className={styles.typeMeta}>
                  {c} · {OWNER_EMBLEMS[i]}
                </div>
              </div>
            </div>
          ))}
          <div className={styles.owner}>
            <Emblem shape="circle" color={NEUTRAL_OWNER} size={28} />
            <div>
              <b>Neutral</b>
              <div className={styles.typeMeta}>{NEUTRAL_OWNER} · civic / local shops</div>
            </div>
          </div>
        </div>
      </Group>
      <Group title="Chart series">
        <div className={styles.row}>
          {CHART.series.map((c, i) => (
            <div key={c} className={styles.owner}>
              <span style={{ width: 22, height: 10, borderRadius: 3, background: c, display: 'inline-block' }} />
              <span className={styles.typeMeta}>
                {i} · {c}
              </span>
            </div>
          ))}
        </div>
      </Group>
      <Group title="Profit / loss per colour-vision setting (Settings → Accessibility)">
        <div className={styles.row}>
          {(Object.keys(PROFIT_LOSS) as (keyof typeof PROFIT_LOSS)[]).map((mode) => (
            <div key={mode} className={styles.owner}>
              <b style={{ minWidth: 52 }}>{mode}</b>
              <span style={{ color: PROFIT_LOSS[mode].pos, fontWeight: 700 }}>▲ +$412K</span>
              <span style={{ color: PROFIT_LOSS[mode].neg, fontWeight: 700 }}>▼ −$135K</span>
            </div>
          ))}
        </div>
      </Group>
      <Group title="Typography — Inter Variable (UI) · Fraunces Variable (display, newspaper)">
        <div className={styles.typeRow}>
          <span className={styles.typeMeta}>display 4xl</span>
          <span className={styles.display} style={{ fontSize: FONT_SIZE['4xl'] }}>
            Magnate — own the city
          </span>
        </div>
        <div className={styles.typeRow}>
          <span className={styles.typeMeta}>display italic</span>
          <span className={styles.display} style={{ fontSize: FONT_SIZE['2xl'], fontStyle: 'italic' }}>
            “OPEC oversupply: crude −30% for nine months”
          </span>
        </div>
        {(Object.keys(FONT_SIZE) as (keyof typeof FONT_SIZE)[])
          .slice()
          .reverse()
          .map((k) => (
            <div key={k} className={styles.typeRow}>
              <span className={styles.typeMeta}>
                {k} · {FONT_SIZE[k]}
              </span>
              <span style={{ fontSize: FONT_SIZE[k] }}>
                Cash <span className="num">$13,940,000</span> · Company value ▲ 0.9%
              </span>
            </div>
          ))}
      </Group>
      <div className={styles.grid3}>
        <Group title="Spacing (rem; ×4 px at 100%)">
          {(Object.keys(SPACE) as (keyof typeof SPACE)[])
            .filter((k) => k !== 0 && k !== 'px')
            .map((k) => (
              <div key={String(k)} className={styles.row} style={{ marginBottom: 6 }}>
                <span className={styles.typeMeta} style={{ width: 70 }}>
                  {String(k)} · {SPACE[k]}
                </span>
                <span className={styles.spaceBar} style={{ width: SPACE[k] }} />
              </div>
            ))}
        </Group>
        <Group title="Radii">
          <div className={styles.row}>
            {(Object.keys(RADIUS) as (keyof typeof RADIUS)[]).map((k) => (
              <div key={k} style={{ textAlign: 'center' }}>
                <div style={{ width: 54, height: 54, borderRadius: RADIUS[k], border: '1px solid var(--c-hairline-strong)', background: 'var(--c-panel2)' }} />
                <div className={styles.typeMeta}>{k}</div>
              </div>
            ))}
          </div>
        </Group>
        <Group title="Elevation">
          <div className={styles.grid2}>
            {(Object.keys(ELEVATION) as (keyof typeof ELEVATION)[]).map((k) => (
              <div key={String(k)} className={styles.elevation} style={{ boxShadow: ELEVATION[k] }}>
                e-{String(k)}
              </div>
            ))}
          </div>
        </Group>
      </div>
    </>
  );
}
