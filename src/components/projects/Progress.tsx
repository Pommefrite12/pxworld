/** The bar of a project: how much of the goal is paid. (A file of its own: the map card, a client component, uses it too.) */
export function Progress({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label} className="h-3 w-full overflow-hidden rounded-[4px] bg-paper-2 shadow-[inset_0_0_0_1.5px_var(--color-line)]">
      <div className="h-full bg-signal" style={{ width: `${percent}%` }} />
    </div>
  );
}
