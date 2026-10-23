// Magnate design system. Import from '@/ui/components'.
// Every component reads colours/sizes from the CSS custom properties generated
// from theme/tokens.ts; see the UiKit page (?dev=ui) for every state.

export { Button, IconButton, Spinner, type ButtonProps, type ButtonSize, type ButtonVariant, type IconButtonProps } from './Button';
export { Kbd, KeyChord, keyLabel } from './Kbd';
export { Tooltip, type TooltipProps, type TooltipSide } from './Tooltip';
export { Panel, SectionTitle, Divider, type PanelProps } from './Panel';
export { DrawerFrame, OverlayFrame, PanelChromeProvider, usePanelChrome, type PanelChrome, type DrawerFrameProps, type OverlayFrameProps } from './PanelFrame';
export { Tabs, type TabItem, type TabsProps } from './Tabs';
export { Table, type Column, type SortDir, type TableProps } from './Table';
export { Stat, Money, Delta, Percent, Progress, Meter, type StatProps, type ProgressTone } from './Data';
export { Slider, type SliderBand, type SliderMark, type SliderProps, type SliderTone } from './Slider';
export { Select, type SelectOption, type SelectProps } from './Select';
export { Badge, Toggle, Segmented, Field, TextInput, EmptyState, Skeleton, type Tone, type SegmentOption } from './Controls';
export { ToastCard, SEVERITY_ICON, type ToastCardProps } from './Toast';
export { Modal, ConfirmDialog, type ModalProps, type ConfirmChoice } from './Modal';
export { ContextMenu, ContextMenuHost } from './ContextMenu';
export { Emblem, type EmblemProps } from './Emblem';
export { Sparkline, type SparklineProps } from './charts/Sparkline';
export { LineChart, type LineSeries, type LineChartProps } from './charts/LineChart';
export { BarChart, StackedBar, type BarDatum, type StackSegment } from './charts/BarChart';
export { Row, Stack, Grid, Text } from './Layout';
