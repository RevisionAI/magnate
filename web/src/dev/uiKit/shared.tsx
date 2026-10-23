// Small layout helpers shared by the UiKit sections.

import type { ReactNode } from 'react';
import styles from './UiKit.module.css';

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>{title}</div>
      {children}
    </div>
  );
}

export function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={`kit-${id}`} className={styles.section} data-uikit-section={id}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {note && <span className={styles.sectionNote}>{note}</span>}
      </div>
      {children}
    </section>
  );
}
