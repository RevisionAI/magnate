// Layout primitives so panels compose without ad-hoc inline styles.
//
//   <Row gap={2} align="center"><Emblem …/> LocalCo</Row>
//   <Stack gap={3}>…</Stack>     <Grid cols={3} gap={4}>…</Grid>     <Text tone="muted" size="sm">…</Text>

import clsx from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Layout.module.css';

type Gap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8;

interface FlexProps extends HTMLAttributes<HTMLDivElement> {
  gap?: Gap;
  align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
  /** Children share the width equally. */
  grow?: boolean;
  inline?: boolean;
}

export function Row({ gap = 2, align = 'center', justify, wrap, grow, inline, className, ...rest }: FlexProps) {
  return (
    <div
      className={clsx(
        styles.row,
        styles[`gap-${gap}`],
        styles[`align-${align}`],
        justify && styles[`justify-${justify}`],
        wrap && styles.wrap,
        grow && styles.grow,
        inline && styles.inline,
        className,
      )}
      {...rest}
    />
  );
}

export function Stack({ gap = 2, align = 'stretch', justify, className, ...rest }: Omit<FlexProps, 'wrap' | 'grow' | 'inline'>) {
  return <div className={clsx(styles.stack, styles[`gap-${gap}`], styles[`align-${align}`], justify && styles[`justify-${justify}`], className)} {...rest} />;
}

export function Grid({ cols = 2, gap = 3, className, ...rest }: HTMLAttributes<HTMLDivElement> & { cols?: 2 | 3 | 4; gap?: Gap }) {
  return <div className={clsx(styles.grid, styles[`cols-${cols}`], styles[`gap-${gap}`], className)} {...rest} />;
}

export function Text({ tone, size, children, className }: { tone?: 'muted' | 'dim'; size?: 'sm' | 'xs'; children: ReactNode; className?: string }) {
  return <span className={clsx(tone && styles[`text-${tone}`], size && styles[`text-${size}`], className)}>{children}</span>;
}
